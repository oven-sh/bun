// Symbols, "__proto__", "constructor", "toString", an index, the empty text, undefined and null as names.
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
const mark = Symbol("mark");
const odd = [mark, Symbol.iterator, Symbol.for("shared"), "__proto__", "constructor", "toString", "0", 0, "", undefined, null, "hasOwnProperty"];
server.on(mark, a => lines.push("mark: " + describe(a)));
server.on(Symbol.iterator, a => lines.push("iterator: " + describe(a)));
server.on(Symbol.for("shared"), a => lines.push("shared: " + describe(a)));
server.on("__proto__", a => lines.push("__proto__: " + describe(a)));
server.on("constructor", a => lines.push("constructor: " + describe(a)));
server.on("toString", a => lines.push("toString: " + describe(a)));
server.on("0", a => lines.push("zero: " + describe(a)));
server.on("", a => lines.push("empty: " + describe(a)));
server.on(undefined, a => lines.push("undefined: " + describe(a)));
server.on(null, a => lines.push("null: " + describe(a)));
server.emit(mark, new Request("/mark"));
server.emit(Symbol.iterator, new Response());
server.emit(Symbol.for("shared"), new Failure(1));
server.emit("__proto__", 1);
server.emit("constructor", "two");
server.emit("toString", 3n);
server.emit(0, new Failure(0));
server.emit("", false);
server.emit("undefined", new Request("/undefined"));
server.emit("null", new Response());
lines.push(String(server.emit("hasOwnProperty", 1)), String(server.emit("valueOf")));
for (const name of odd) lines.push(typeof server.events[name]);

// The same names on a dictionary that inherits from Object.prototype.
function Ordinary() {
  this.events = {};
}
Ordinary.prototype.on = Emitter.prototype.on;
Ordinary.prototype.emit = Emitter.prototype.emit;
const ordinary = new Ordinary();
try {
  lines.push(String(ordinary.emit("hasOwnProperty", "events")));
  lines.push(String(ordinary.emit("toString")));
  ordinary.on("__proto__", { inherited: a => lines.push("inherited: " + describe(a)) });
  lines.push(String(ordinary.emit("inherited", new Failure(9))));
  lines.push(String(ordinary.emit("__proto__", 1)));
} catch (error) {
  lines.push(error.constructor.name);
}
console.log(lines.join("\n"));
