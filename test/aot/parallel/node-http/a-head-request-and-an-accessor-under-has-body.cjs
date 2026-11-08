const http = require("node:http"), stored = [];
Object.defineProperty(http.ServerResponse.prototype, "_hasBody", { configurable: true, get() { return stored.at(-1); }, set(value) { stored.push(value); } });
const server = http.createServer(() => { console.log(stored.join()); process.exit(0); });
server.listen(0, () => http.request({ port: server.address().port, method: "HEAD" }).end());
