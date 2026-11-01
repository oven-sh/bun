let reads = 0;
Object.defineProperty(require("node:events").EventEmitter.prototype, "_maxListeners", { get() { reads++; return 42; }, set(v) { console.log("set", v); }, configurable: true });
const http = require("node:http");
const res = new http.ServerResponse(new http.IncomingMessage(null));
console.log(res.getMaxListeners(), Object.hasOwn(res, "_maxListeners"), reads > 0);
