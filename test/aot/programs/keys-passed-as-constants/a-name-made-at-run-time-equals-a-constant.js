// "re" + "quest", a template, a slice, String(..), an object that converts to the name: each is the name "request" at run time.
function Emitter() {
  this.events = Object.create(null);
}
Emitter.prototype.on = function (type, listener) {
  this.events[type] = listener;
  return this;
};
Emitter.prototype.emit = function (type, a, b) {
  const handler = this.events[type];
  if (handler === undefined) return false;
  handler.call(this, a, b);
  return true;
};
class Request {
  constructor(url) {
    this.url = url;
    this.method = "GET";
  }
}
class Response {
  constructor() {
    this.status = 200;
    this.body = "";
  }
}
class Failure {
  constructor(code) {
    this.code = code;
  }
}
const lines = [];
function describe(value) {
  if (value === undefined) return "undefined";
  if (value instanceof Request) return "Request " + value.method + " " + value.url;
  if (value instanceof Response) return "Response " + value.status;
  if (value instanceof Failure) return "Failure " + value.code;
  return typeof value + " " + String(value);
}
function listen(emitter) {
  emitter.on("request", function (req, res) {
    lines.push("request: " + describe(req) + ", " + describe(res));
  });
  emitter.on("failure", function (failure) {
    lines.push("failure: " + describe(failure));
  });
  emitter.on("tick", function (count) {
    lines.push("tick: " + describe(count));
  });
}
const server = new Emitter();
listen(server);
const half = process.argv.length > 0 ? "re" : "fail";
server.emit(half + "quest", 1, 2);
server.emit(`${half}quest`, "template", undefined);
server.emit("xrequestx".slice(1, 8), new Failure(1), new Failure(2));
server.emit(String(["request"]), true, null);
server.emit({ toString: () => "tick" }, new Request("/object"));
server.emit(["failure"], 7n);
server.on(half + "quest", function (a, b) {
  lines.push("replaced under a name made at run time: " + describe(a) + ", " + describe(b));
});
server.emit("request", new Request("/b"), new Response());
console.log(lines.join("\n"));
