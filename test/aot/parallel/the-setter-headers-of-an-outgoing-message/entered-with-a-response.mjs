import http from "node:http";
const res = new http.ServerResponse(new http.IncomingMessage(null));
const store = Object.getOwnPropertyDescriptor(http.OutgoingMessage.prototype, "headers").set;
store.call(res, { "X-A": "1" });
console.log(String(res.getHeader("x-a")), res.hasHeader("x-a"), res.getHeaderNames().join());
