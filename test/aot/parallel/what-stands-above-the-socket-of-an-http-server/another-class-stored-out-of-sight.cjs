const say = (...words) => console.log(words.join(" "));
function nameOf(value) {
  if (value === null) return "null";
  if (value === Object.prototype) return "Object.prototype";
  if (value === Function.prototype) return "Function.prototype";
  if (typeof value === "function") return "function " + value.name;
  const own = Object.getOwnPropertyDescriptor(value, "constructor");
  return "prototype of " + (own && typeof own.value === "function" ? own.value.name : "?");
}
function chainOf(value) {
  const names = [];
  for (let at = value, steps = 0; at !== null && steps < 12; at = Object.getPrototypeOf(at), steps++) names.push(nameOf(at));
  return names.join(" > ");
}
const net = require("node:net");
const Real = net.Socket;
const calls = {};
function Other(options) { calls.Other = 1; Real.call(this, options); }
Object.setPrototypeOf(Other.prototype, Real.prototype);
Object.setPrototypeOf(Other, Real);
for (const name of ["emit", "on", "once", "write", "end", "resume", "pause", "setTimeout", "removeListener", "destroy"]) Other.prototype[name] = function (...rest) { calls[name] = 1; return Real.prototype[name].apply(this, rest); };
Other.prototype.other = function () { return "stored"; };
Reflect.set(net, ["Soc", "ket"].join(""), Other);
const http = require("node:http");
const server = http.createServer((request, response) => {
  const socket = request.socket;
  say("the socket:", chainOf(socket));
  say("its class:", chainOf(socket.constructor));
  say("instanceof Other", String(socket instanceof Other), "Real", String(socket instanceof Real), "other", typeof socket.other, typeof socket.other === "function" ? socket.other() : "-");
  say("states", typeof socket._readableState, typeof socket._writableState, typeof socket._events);
  socket.once("made-up", () => say("heard"));
  socket.emit("made-up");
  response.end("ok");
});
server.listen(0, () => {
  http.get({ port: server.address().port, agent: false }, answer => {
    let text = "";
    answer.on("data", chunk => { text += chunk; });
    answer.on("end", () => { say("answered", text); server.close(() => say("overrides that ran on some socket:", Object.keys(calls).sort().join(","))); });
  });
});
