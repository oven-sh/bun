const http = require("node:http"); let reads = 0;
Object.defineProperty(http.IncomingMessage.prototype, "httpVersionMinor", { configurable: true, get() { reads++; return 0; }, set() {} });
const server = http.createServer((req, res) => { console.log(reads, res.shouldKeepAlive, res.useChunkedEncodingByDefault); process.exit(0); });
server.listen(0, () => http.get({ port: server.address().port }));
