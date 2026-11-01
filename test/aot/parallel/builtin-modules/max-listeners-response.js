require("node:events").EventEmitter.prototype._maxListeners = Number(process.argv[2] ?? 100);
const http = require("node:http");
const res = new http.ServerResponse(new http.IncomingMessage(null));
console.log(res.getMaxListeners(), Object.hasOwn(res, "_maxListeners"));
