// The same under a name that the class does not declare: each request is looked at once, and hears its own close.
const http = require("node:http"), net = require("node:net"), util = require("node:util");
process.noDeprecation = true;
const GET = "GET / HTTP/1.1\r\nHost: a\r\n\r\n", seen = new WeakSet(), log = [];
function look() { let t = 0; for (let i = 0; i < 2; i++) t = (t + i) | 0; if (!seen.has(this)) { seen.add(this); this.on("close", function closed() { log.push("closed"); }); } return undefined; }
Object.defineProperty(http.IncomingMessage.prototype, "writable", { configurable: true, get: util.deprecate(look, "made up") });
const server = http.createServer(function answer(q, r) { let t = 0; for (let i = 0; i < 2; i++) t = (t + i) | 0; r.end("x"); });
server.listen(0, "127.0.0.1", function ask() {
  const c = net.connect(server.address().port, "127.0.0.1"); let n = 0;
  c.on("data", function got() { if (++n < 3) setTimeout(function again() { c.write(GET); }, 20); else setTimeout(function done() { console.log(`${log.join()}`); process.exit(0); }, 40); });
  c.write(GET);
});
