// Prints the own keys, in order and with their attributes, of the objects of one node:http server through several exchanges,
// of responses made by hand, of ServerResponse.prototype, and of emitters and streams that capture rejections.
const http = require("node:http");
const net = require("node:net");
const stream = require("node:stream");
const events = require("node:events");

const lines = [];
function word(object, key) {
  const d = Reflect.getOwnPropertyDescriptor(object, key);
  let flags = "value" in d ? (d.writable ? "" : "-w") : (d.get ? "G" : "") + (d.set ? "S" : "");
  if (!d.enumerable) flags += "-e";
  if (!d.configurable) flags += "-c";
  return (typeof key === "symbol" ? `@${key.description}` : key) + (flags ? `{${flags}}` : "");
}
function list(label, object) {
  lines.push(`${label}: ${Reflect.ownKeys(object).map(key => word(object, key)).join(" ")}`);
}
function enumerate(label, object) {
  const names = [];
  for (const name in object) names.push(name);
  lines.push(`${label}, for-in: ${names.join(" ")}`);
}

list("ServerResponse.prototype", http.ServerResponse.prototype);
for (const name of ["detachSocket", "_implicitHeader", "writeHead", "emit", "end", "write"])
  lines.push(`ServerResponse.prototype.${name}.name: ${JSON.stringify(http.ServerResponse.prototype[name].name)}`);

const byHand = () => new http.ServerResponse({});
list("a response made by hand", byHand());
enumerate("a response made by hand", byHand());
lines.push(`Object.keys: ${Object.keys(byHand()).join(" ")}`);
list("for HTTP/1.0", new http.ServerResponse({ httpVersionMajor: 1, httpVersionMinor: 0, headers: {} }));
list("of a subclass", new (class extends http.ServerResponse {})({}));
for (const [label, use] of [
  ["socket is read", r => r.socket],
  ["setHeader", r => r.setHeader("a", "b")],
  ["writeHead", r => r.writeHead(201, { a: "b" })],
  ["write", r => r.write("x")],
  ["end", r => r.end("x")],
  ["destroy", r => r.destroy()],
  ["assignSocket", r => r.assignSocket(new net.Socket())],
]) {
  const r = byHand();
  use(r);
  list(`by hand, after ${label}`, r);
}
{
  const r = byHand();
  r.writable = false;
  r.chunkedEncoding = true;
  r.shouldKeepAlive = false;
  lines.push(`after stores: writable ${r.writable}, chunkedEncoding ${r.chunkedEncoding}, shouldKeepAlive ${r.shouldKeepAlive}`);
  list("after stores", r);
}

for (const [label, make] of [
  ["EventEmitter", options => new events.EventEmitter(options)],
  ["a subclass with an emit of its own", options => new (class extends events.EventEmitter { emit() { return "of the subclass"; } })(options)],
  ["EventEmitterAsyncResource", options => new events.EventEmitterAsyncResource({ name: "n", ...options })],
  ["Readable", options => new stream.Readable(options)],
  ["Writable", options => new stream.Writable(options)],
  ["Duplex", options => new stream.Duplex(options)],
  ["net.Socket", options => new net.Socket(options)],
  ["ServerResponse", () => byHand()],
  ["IncomingMessage", () => new http.IncomingMessage(new net.Socket())],
]) {
  const asked = make({ captureRejections: true });
  lines.push(`${label}, captureRejections: own emit ${Object.hasOwn(asked, "emit")}`);
  events.captureRejections = true;
  let byDefault;
  try {
    byDefault = make();
  } finally {
    events.captureRejections = false;
  }
  lines.push(`${label}, while the default captures: own emit ${Object.hasOwn(byDefault, "emit")}`);
}
{
  const e = new events.EventEmitter({ captureRejections: true });
  list("an emitter that captures rejections", e);
  enumerate("an emitter that captures rejections", e);
  lines.push(`its emit: ${e.emit.name}, the prototype's ${e.emit === events.EventEmitter.prototype.emit}`);
  e.on("a", () => ({ then() { lines.push("then() of what a listener returned is called"); } }));
  e.emit("a");
  const sub = new (class extends events.EventEmitter { emit() { return "of the subclass"; } })({ captureRejections: true });
  lines.push(`emit() of a subclass that captures: ${sub.emit("a")}`);
}

const server = http.createServer((req, res) => {
  const at = req.url;
  list(`${at} req`, req);
  list(`${at} res`, res);
  list(`${at} socket`, req.socket);
  enumerate(`${at} res`, res);
  res.on("finish", () => {
    list(`${at} res at finish`, res);
    list(`${at} req at finish`, req);
    list(`${at} socket at finish`, req.socket);
  });
  res.on("close", () => {
    list(`${at} res at close`, res);
    list(`${at} req at the close of res`, req);
    lines.push(`${at} Object.keys(res) at close: ${Object.keys(res).join(" ")}`);
  });
  const answer = () => {
    if (at === "/end") res.end("hello");
    else if (at === "/empty") res.end();
    else if (at === "/write") (res.write("a"), list(`${at} res after write`, res), res.end());
    else if (at === "/head") (res.writeHead(200, { "content-length": 2 }), list(`${at} res after writeHead`, res), res.end("ok"));
    else if (at === "/length") (res.setHeader("content-length", 2), res.write("ok"), list(`${at} res after write`, res), res.end());
    else if (at === "/callback") (res.write("a", () => {}), list(`${at} res after write`, res), res.end("b", () => {}));
    else if (at === "/flush") (res.flushHeaders(), list(`${at} res after flushHeaders`, res), res.end("b"));
    else res.end("late");
    list(`${at} res after end`, res);
    process.nextTick(() => list(`${at} res a tick after end`, res));
  };
  if (at === "/late" || req.method === "POST") req.on("data", () => {}).on("end", answer);
  else answer();
});
server.on("connection", socket => list("a socket at connection", socket));
server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  const kept = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const once = new http.Agent({ keepAlive: false });
  const exchanges = [["/end", kept], ["/end", kept], ["/empty", kept], ["/write", kept], ["/head", kept], ["/length", kept], ["/callback", kept], ["/flush", kept], ["/late", kept], ["/post", kept, "POST"], ["/end", once], ["/late", once]];
  const next = () => {
    const exchange = exchanges.shift();
    if (exchange === undefined) {
      kept.destroy();
      server.close(() => console.log(lines.join("\n")));
      return;
    }
    const [path, agent, method = "GET"] = exchange;
    const request = http.request({ port, host: "127.0.0.1", path, agent, method }, response => {
      response.resume();
      response.on("close", () => {
        list(`${path} a client's response at close`, response);
        setTimeout(next, 5);
      });
    });
    request.end(method === "POST" ? "body" : undefined);
  };
  next();
});
