const http = require("node:http"), EventEmitter = require("node:events");
let reads = 0, before = 0, requests = 0;
const server = http.createServer((req, res) => {
  if (requests++ === 1) { console.log(reads - before); process.exit(0); }
  before = reads; res.end("x");
});
function mine(...given) { return EventEmitter.prototype.emit.apply(this, given); }
Object.defineProperty(server, "emit", { configurable: true, get() { reads++; return mine; } });
const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
const ask = () => http.get({ port: server.address().port, agent }, res => { res.resume(); res.on("end", () => setTimeout(ask, 5)); });
server.listen(0, ask);
