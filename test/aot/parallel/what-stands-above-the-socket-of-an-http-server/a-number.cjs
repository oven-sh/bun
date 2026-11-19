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
function heirOf(Base, label) {
  function Made(options) { Base.call(this, options); }
  Object.defineProperty(Made, "name", { value: label });
  Object.setPrototypeOf(Made.prototype, Base.prototype);
  Object.setPrototypeOf(Made, Base);
  Made.prototype.label = function () { return label; };
  return Made;
}
const corner = "a-number";
const http = require("node:http");
let reads = 0;
if (corner === "stored-behind-the-load") net.Socket = heirOf(Real, "Late");
if (corner === "an-accessor-that-answers-otherwise") {
  const answers = [heirOf(Real, "First"), heirOf(Real, "Second"), heirOf(Real, "Third")];
  Object.defineProperty(net, "Socket", { configurable: true, get() { return answers[Math.min(reads++, 2)]; } });
}
if (corner === "a-number") net.Socket = 5;
if (corner === "an-arrow") net.Socket = () => {};
if (corner === "null") net.Socket = null;
process.on("uncaughtException", error => { say("uncaught", error && error.name, String(error && error.message).slice(0, 70)); process.exit(0); });
const server = http.createServer((request, response) => {
  const socket = request.socket;
  say("the socket:", chainOf(socket));
  say("label", typeof socket.label === "function" ? socket.label() : "-", "Real", String(socket instanceof Real));
  response.end("ok");
});
try {
  server.listen(0, () => {
    say("listening");
    http.get({ port: server.address().port, agent: false, createConnection: options => new Real().connect(options) }, answer => {
      answer.resume();
      answer.on("end", () => server.close(() => say("closed; some read of the accessor", String(reads > 0))));
    }).on("error", error => { say("the request fails", error && error.code); server.close(); });
  });
} catch (error) { say("listen throws", error && error.name, String(error && error.message).slice(0, 70)); }
