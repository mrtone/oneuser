var OAuth2Provider = require('oauth2-provider').OAuth2Provider,
    passport = require('passport'),
    mongoose = require('mongoose'),
    LocalStrategy = require('passport-local').Strategy,
    GithubStrategy = require('passport-github').Strategy
    QQStrategy = require('passport-qq').Strategy;

var User = mongoose.model('user');
var Client = mongoose.model('client');

// ---------- ---------- | Provider | ---------- ---------- //
var grants = {};

var provider = new OAuth2Provider({crypt_key: 'oneuser encryption secret', sign_key: 'oneuser signing secret', access_token_uri: '/oauth/token'});

provider.on('enforce_login', function(req, res, authorizeUrl, next) {
    if(req.isAuthenticated()) {
        next(req.user._id);
    } else {
        res.redirect('/login?next=' + encodeURIComponent(authorizeUrl));
    }
});
provider.on('authorize_form', function(req, res, clientAppkey, authorizeUrl) {
    res.render('authorize.jade', {
        authorizeUrl: authorizeUrl
    });
});
provider.on('save_grant', function(req, clientAppkey, code, next) {
    var userID = req.user._id;
    if(!(userID in grants))
        grants[userID] = {};

    grants[userID][clientAppkey] = code;
    next();
});
provider.on('remove_grant', function(userID, clientAppkey, code) {
    if(grants[userID] && grants[userID][clientAppkey])
        delete grants[userID][clientAppkey];
});
provider.on('lookup_grant', function(clientAppkey, clientSecret, code, next) {
    Client.findOne({
        appkey: clientAppkey,
        secret: clientSecret
    }, function (err, user) {
        if(!err && user){
            for(var userID in grants) {
                var clients = grants[userID];
                if(clients[clientAppkey] && clients[clientAppkey] == code){
                    return next(null, userID);
                }
            }
        }else{
            next(new Error('应用未授权！'));
        }
    });
});
provider.on('create_access_token', function(userID, clientAppkey, next) {
    var extra_data = 'blah';
    var oauth_params = {token_type: 'bearer'};
    next(extra_data/*, oauth_params*/);
});
provider.on('save_access_token', function(userID, clientAppkey, accessToken) {
    var token = accessToken.access_token;
    User.findOneAndUpdate({
        '_id': userID,
        'clients.appkey': {$ne: clientAppkey}
    }, {
        $push: {clients: {'appkey': clientAppkey, token: token}}
    }, function(err, user){
        if(!err && !user){
            User.findOneAndUpdate({
                '_id': userID,
                'clients.appkey': clientAppkey
            }, {
                $set: {'clients.$.token': token}
            }, function(err, user){});
        }
    });
});
provider.on('access_token', function(req, token, next) {
    var TOKEN_TTL = 3 * 24 * 60 * 60 * 1000; // 10 minutes

    if(token.grant_date.getTime() + TOKEN_TTL < Date.now()) {
        return next(new Error('授权已过期'));
    } else {
        User.findById(token.user_id, function(err, user){
            if(!err && user){
                req.login(user, function(){
                    req.session.data = token.extra_data;
                    next();
                });
            }else{
                return next(new Error('用户未找到'));
            }
        });
    }
});
//provider.on('client_auth', function(clientAppkey, clientSecret, username, password, next) {
//    if(clientAppkey == '1' && username == 'guest') {
//        var user_id = '1337';
//        return next(null, user_id);
//    }
//    return next(new Error('client authentication denied'));
//});

// ---------- ---------- | Passport | ---------- ---------- //
passport.serializeUser(function(user, done) {
    done(null, user);
});

passport.deserializeUser(function(user, done) {
    User.findById(user._id, done);
});
// Local
passport.use(new LocalStrategy({
        usernameField: 'username',
        passwordField: 'password'
    }, function(username, password, done) {
        var conditions = {};
        conditions.username = username;
        User.findOne(conditions, function (err, user) {
            if (err) {return done(err)}
            if (!user) {
                return done(null, false, {message:'Unknown user'});
            }
            if (!user.authenticate(password)) {
                return done(null, false, {message: 'Invalid password'})
            }
            return done(null, user);
        } );
    })
);
// 第三方
function auth(accessToken, refreshToken, profile, done) {
    profile.accessToken = accessToken;
    profile.refreshToken = refreshToken;
    if(!accessToken || !profile.id) return;
    User.authUser(profile.id, profile, function(err, result, isNew){
        done(err, result);
    });
}
// Github
passport.use(new GithubStrategy({
    clientID: CONFIG.AUTH.GITHUB.CLIENT_ID,
    clientSecret: CONFIG.AUTH.GITHUB.CLIENT_SECRET
}, auth));
// QQ
passport.use(new QQStrategy({
    clientID: CONFIG.AUTH.QQ.CLIENT_ID,
    clientSecret: CONFIG.AUTH.QQ.CLIENT_SECRET
}, auth));

exports.provider = provider;
exports.passport = passport;
