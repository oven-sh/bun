// The dictionary is a Proxy that answers under other names; the emitter is a Proxy; a getter stands under a name.
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
const real = server.events;
server.events = new Proxy(real, {
  get(target, name) {
    lines.push("get " + String(name));
    return name === "tick" ? target.failure : name === "failure" ? target.request : target[name];
  },
  set(target, name, value) {
    lines.push("set " + String(name));
    target["moved " + String(name)] = value;
    return true;
  },
});
server.emit("tick", new Failure(1));
server.emit("failure", new Request("/proxy"), new Response());
server.emit("request", 1, 2);
server.on("tick", () => lines.push("never under tick"));
lines.push(Object.keys(real).join());
server.emit("moved tick");

const wrapped = new Proxy(new Emitter(), {
  get(target, name, receiver) {
    if (name === "emit") return (type, a) => target.emit("tick", type + " through the proxy, " + describe(a));
    return Reflect.get(target, name, receiver);
  },
});
listen(wrapped);
wrapped.emit("request", new Request("/wrapped"));

const withGetter = new Emitter();
let reads = 0;
Object.defineProperty(withGetter.events, "request", {
  get() {
    reads++;
    return reads % 2 ? a => lines.push("odd read: " + describe(a)) : a => lines.push("even read: " + describe(a));
  },
});
withGetter.emit("request", new Failure(2));
withGetter.emit("request", "three");
console.log(lines.join("\n"));
