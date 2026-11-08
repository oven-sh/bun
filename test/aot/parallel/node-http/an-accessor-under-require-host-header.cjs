const http = require("node:http");
let reads = 0, before = 0, requests = 0;
const server = http.createServer((req, res) => {
  if (requests++ === 1) { console.log(reads - before); process.exit(0); }
  before = reads; res.end("x");
});
Object.defineProperty(server, "requireHostHeader", { configurable: true, get() { reads++; return true; } });
const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
const ask = () => http.get({ port: server.address().port, agent }, res => { res.resume(); res.on("end", () => setTimeout(ask, 5)); });
server.listen(0, ask);
