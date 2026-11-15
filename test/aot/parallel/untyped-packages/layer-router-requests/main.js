// An untyped package and a program of it (requests): routes as layers over a compiled expression; exec's groups become parameters
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var r = new lib.Router();
r.use(function logger(req, res, next) { res.log.push('log ' + req.method); next(); });
r.get('/users/:id', function (req, res) { res.end('user ' + req.params.id); });
r.get('/users/:id/books/:book?', function (req, res) { res.end('books ' + req.params.id + ' ' + req.params.book); });
r.post('/files/*', function (req, res) { res.end('file ' + JSON.stringify(req.params)); });
r.get('/n/:year(\\d{4})-:month(\\d\\d)', function (req, res) { res.end('never ' + JSON.stringify(req.params)); });
r.get('/fail/:x', function (req) { throw new Error('bad ' + req.params.x); });
r.use(function (err, req, res, next) { res.end('error ' + err.message); });
var urls = [['GET', '/users/1'], ['GET', '/users/2/'], ['GET', '/users/a%20b'], ['GET', '/users/7/books'], ['GET', '/users/8/books/ulysses?x=1'], ['POST', '/files/a/b/c.txt'], ['GET', '/nope'], ['GET', '/fail/now'], ['GET', '/USERS/Nine'], ['GET', '/users/%zz']];
for (var round = 0; round < 5; round++) urls.forEach(function (u, i) {
  var res = { log: [], end: function (t) { this.body = t; } }, req = { method: u[0], url: u[1].replace(/\d+/, function (d) { return +d + round * 10 + i; }) };
  r.handle(req, res, function (err) { res.end(err ? 'done ' + err.message + ' ' + err.status : 'not found'); });
  say(round, req.url, res.body, res.log.length, JSON.stringify(req.params));
});
say(r.calls);
