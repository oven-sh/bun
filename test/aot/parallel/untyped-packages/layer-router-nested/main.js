// An untyped package and a program of it (nested): routes as layers over a compiled expression; exec's groups become parameters
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var top = new lib.Router(), api = new lib.Router(), seen = [];
api.get('/items/:item', function getItem(req, res, next) { seen.push(req.params.version + ':' + req.params.item); next(); });
api.get('/items/:item', function second(req, res) { res.body = 'second ' + Object.keys(req.params).sort().join(); });
top.use('/api/:version', function (req, res, next) { var old = req.url; req.url = req.url.slice(req.matched.length) || '/'; api.handle(req, res, function (e) { req.url = old; next(e); }); });
top.all('/:anything', function (req, res) { res.body = 'any ' + req.params.anything; });
for (var i = 0; i < 24; i++) { var res = {}, req = { method: i % 2 ? 'GET' : 'get', url: i % 4 === 3 ? '/plain' + i : '/api/v' + i % 3 + '/items/' + (i * 37 % 11) }; top.handle(req, res, function (e) { res.body = 'end ' + e; }); say(i, req.url, res.body); }
say(seen.join(' '));
