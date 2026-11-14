const http = require("node:http");
Object.defineProperty(http.IncomingMessage.prototype, "method", { configurable: true, get() { return "HEAD"; }, set() {} });
const server = http.createServer((req, res) => { console.log(req.method, res._hasBody); process.exit(0); });
server.listen(0, () => http.get({ port: server.address().port }));
