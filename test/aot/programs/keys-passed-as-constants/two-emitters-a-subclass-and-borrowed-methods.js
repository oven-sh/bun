// Two emitters with the same names, a subclass that overrides emit, emit.call and apply on another object, bound methods, methods read into variables.
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
const client = new Emitter();
listen(server);
client.on("request", function (text) {
  lines.push("the client's request: " + describe(text));
});
client.on("tick", function (a, b) {
  lines.push("the client's tick: " + describe(a) + ", " + describe(b));
});
server.emit("request", new Request("/server"), new Response());
client.emit("request", "text");
client.emit("tick", new Failure(1), new Request("/client"));
server.emit("tick", 2);

class Loud extends Emitter {
  emit(type, a, b) {
    lines.push("loud " + String(type));
    return super.emit(type === "alias" ? "request" : type, b, a);
  }
}
const loud = new Loud();
listen(loud);
loud.emit("request", new Response(), new Request("/loud"));
loud.emit("alias", 1, 2);
loud.emit("tick", "swapped away", 3);

const other = { events: { request: (a, b) => lines.push("another object: " + describe(a) + ", " + describe(b)) } };
Emitter.prototype.emit.call(other, "request", new Failure(4), 5);
Emitter.prototype.emit.apply(other, ["request", "six"]);
Reflect.apply(Emitter.prototype.emit, other, ["request", 7n, new Response()]);
Emitter.prototype.on.call(other, "tick", a => lines.push("another object's tick: " + describe(a)));
other.events.tick(8);
const bound = server.emit.bind(server, "failure");
bound(new Failure(9));
const boundLater = server.emit.bind(server);
boundLater("tick", 10);
const { emit, on } = Emitter.prototype;
on.call(client, "failure", a => lines.push("the client's failure: " + describe(a)));
emit.call(client, "failure", new Failure(11));
[["tick", 12], ["failure", new Failure(13)]].forEach(([type, a]) => server.emit(type, a));
console.log(lines.join("\n"));
