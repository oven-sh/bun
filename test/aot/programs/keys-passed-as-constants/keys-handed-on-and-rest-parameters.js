// The name goes through helpers; the operands come through a rest parameter, read by index, spread, changed and handed on.
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
function store(target, type, listener) {
  target.events[type] = listener;
}
function lookUp(target, type) {
  return target.events[type];
}
function Relay() {
  this.events = Object.create(null);
}
Relay.prototype.addListener = function (type, listener) {
  store(this, type, listener);
  return this;
};
Relay.prototype.on = Relay.prototype.addListener;
Relay.prototype.once = function (type, listener) {
  const self = this;
  return this.on(type, function wrapper(...operands) {
    delete self.events[type];
    return listener.apply(this, operands);
  });
};
Relay.prototype.emit = function (type, ...args) {
  const handler = lookUp(this, type);
  if (handler === undefined) return false;
  switch (args.length) {
    case 0:
      handler.call(this);
      break;
    case 1:
      handler.call(this, args[0]);
      break;
    case 2:
      handler.call(this, args[0], args[1]);
      break;
    default:
      handler.apply(this, args);
  }
  return true;
};
Relay.prototype.emitReversed = function (type, ...args) {
  args.reverse();
  const handler = lookUp(this, type);
  if (handler !== undefined) handler.call(this, args[0], args[1]);
};
Relay.prototype.emitChanged = function (type, ...args) {
  args[0] = "changed";
  args.push("pushed");
  const handler = lookUp(this, type);
  if (handler !== undefined) handler.call(this, args[0], args[1], args[2]);
};
const relay = new Relay();
listen(relay);
relay.emit("request", new Request("/relay"), new Response());
relay.emit("failure", new Failure(1));
relay.emit("tick", 2);
relay.emit("tick");
relay.emit("request", 1, 2, 3, 4);
relay.emitReversed("request", new Response(), new Request("/reversed"));
relay.emitReversed("tick", "dropped", 3);
relay.emitChanged("request", new Request("/never seen"), new Response());
relay.emitChanged("tick", 4);
relay.once("late", (a, b, c) => lines.push("late: " + describe(a) + ", " + describe(b) + ", " + describe(c)));
lines.push(String(relay.emit("late", new Failure(5), "six", 7)), String(relay.emit("late", 8)));
console.log(lines.join("\n"));
