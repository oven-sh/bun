// A listener is replaced, removed by delete and by undefined, and the dictionary holds arrays of listeners.
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
server.emit("tick", 1);
server.on("tick", function (count) {
  lines.push("the second tick listener: " + describe(count));
});
server.emit("tick", new Failure(2));
delete server.events.tick;
lines.push(String(server.emit("tick", 3)));
server.on("failure", undefined);
lines.push(String(server.emit("failure", new Failure(4))));
server.events["request"] = function (only) {
  lines.push("stored without on: " + describe(only));
};
server.emit("request", "five");

function Many() {
  this.events = Object.create(null);
}
Many.prototype.on = function (type, listener) {
  const list = this.events[type];
  if (list === undefined) this.events[type] = [listener];
  else list.push(listener);
  return this;
};
Many.prototype.off = function (type, listener) {
  const list = this.events[type];
  if (list === undefined) return this;
  const index = list.indexOf(listener);
  if (index >= 0) list.splice(index, 1);
  return this;
};
Many.prototype.emit = function (type, a, b) {
  const list = this.events[type];
  if (list === undefined) return 0;
  for (const listener of list.slice()) listener.call(this, a, b);
  return list.length;
};
const many = new Many();
const first = a => lines.push("first: " + describe(a));
const second = (a, b) => lines.push("second: " + describe(a) + ", " + describe(b));
many.on("request", first).on("request", second).on("failure", first);
lines.push(String(many.emit("request", new Request("/many"), new Response())));
lines.push(String(many.emit("failure", new Failure(6))));
many.off("request", first);
lines.push(String(many.emit("request", 7, 8)));
many.off("nothing", first).off("failure", second);
lines.push(String(many.emit("failure", "nine")));
console.log(lines.join("\n"));
