const http = require("node:http");
http.ServerResponse.prototype._maxListeners = 5;
const a = new http.ServerResponse(new http.IncomingMessage(null));
console.log(a.getMaxListeners(), Object.hasOwn(a, "_maxListeners"));
delete http.ServerResponse.prototype._maxListeners;
http.OutgoingMessage.prototype._maxListeners = 6;
const b = new http.ServerResponse(new http.IncomingMessage(null));
console.log(b.getMaxListeners(), Object.hasOwn(b, "_maxListeners"));
