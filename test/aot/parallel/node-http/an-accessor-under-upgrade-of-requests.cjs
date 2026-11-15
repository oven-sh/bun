const http = require("node:http"), net = require("node:net"), stored = []; let requests = 0;
Object.defineProperty(http.IncomingMessage.prototype, "upgrade", { configurable: true, get() { return false; }, set(value) { stored.push(value); } });
const server = http.createServer((req, res) => { console.log(JSON.stringify(stored.splice(0))); res.end("x"); if (requests++ === 1) process.exit(0); });
server.listen(0, () => { const socket = net.connect(server.address().port); const ask = () => socket.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n"); socket.on("data", () => setTimeout(ask, 5)); ask(); });
