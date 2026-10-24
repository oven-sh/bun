// The dictionary is handed to code that nobody sees, walked by Object.keys, for-in and Object.entries, copied and frozen.
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
const unseen = new Function("events", "make", "events.tick = function (a) { make('stored by evaluated text', a); }; const kept = events.request; events.request = events.failure; events.failure = kept; return Object.keys(events).join();");
lines.push(unseen(server.events, (text, a) => lines.push(text + ": " + describe(a))));
server.emit("request", new Request("/swapped"), new Response());
server.emit("failure", new Failure(1));
server.emit("tick", 2);
for (const name of Object.keys(server.events)) server.events[name].call(server, name.length, name);
for (const name in server.events) lines.push(name + " " + server.events[name].length);
for (const [name, listener] of Object.entries(server.events)) listener.call(null, new Failure(name.length));
const copy = { ...server.events };
copy.request(new Response(), 1);
Object.freeze(server.events);
try {
  server.on("tick", () => lines.push("never stored"));
} catch (error) {
  lines.push(error.constructor.name);
}
server.emit("tick", 3);
console.log(lines.join("\n"));
