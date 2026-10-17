// What a program may do to req, res and their prototypes, one request each. Prints a log that must be the same with and without --aot.
const http = require("node:http");
const { EventEmitter } = require("node:events");
const { Readable, Duplex } = require("node:stream");
const net = require("node:net");
const log = [];
const say = (...words) => log.push(words.join(" "));
let scenario = () => {};
const server = http.createServer((req, res) => scenario(req, res));
const wait = () => new Promise(done => setImmediate(() => setImmediate(done)));
function ask(port, method = "GET", body) {
  return new Promise((resolve, reject) => {
    const request = http.request({ port, host: "127.0.0.1", path: "/x", method, agent }, response => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", piece => (text += piece));
      response.on("end", () => resolve(response.statusCode + " " + JSON.stringify(response.headers["x-a"] ?? null) + " " + text));
    });
    request.on("error", reject);
    request.end(body);
  });
}
const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
const answer = res => { res.writeHead(200, { "x-a": "1", "Content-Length": 2 }); res.end("ok"); };
const wrap = (holder, name, label) => {
  const original = holder[name];
  const wasOwn = Object.prototype.hasOwnProperty.call(holder, name);
  holder[name] = function (...list) {
    say(label, name, typeof list[0] === "string" ? list[0] : typeof list[0]);
    return original.apply(this, list);
  };
  return () => { if (wasOwn) holder[name] = original; else delete holder[name]; };
};
const wrapGetter = (holder, from, name, label) => {
  const before = Object.getOwnPropertyDescriptor(holder, name);
  const found = Object.getOwnPropertyDescriptor(from, name);
  if (before && !before.configurable) { say(label, name, "cannot be redefined"); return () => {}; }
  Object.defineProperty(holder, name, { get() { say(label, "get", name); return found.get.call(this); }, set: found.set, configurable: true, enumerable: found.enumerable });
  return () => { if (before) Object.defineProperty(holder, name, before); else delete holder[name]; };
};
const scenarios = {
  plain(req, res) { answer(res); },
  listeners(req, res) {
    for (const name of ["socket", "prefinish", "finish", "close"]) res.on(name, () => say("res", name, res.finished, res.writableEnded, res.destroyed));
    for (const name of ["resume", "readable", "end", "close"]) req.on(name, () => say("req", name, req.complete, req.readableEnded, req.destroyed));
    answer(res);
  },
  ownEmit(req, res) { wrap(res, "emit", "own res"); wrap(req, "emit", "own req"); answer(res); },
  ownMethods(req, res) {
    for (const name of ["setHeader", "hasHeader", "detachSocket", "_callPendingCallbacks", "writeHead", "_implicitHeader", "end"]) wrap(res, name, "own res");
    for (const name of ["read", "push", "resume", "destroy", "_read", "_destroy", "_dump", "removeAllListeners", "listenerCount"]) wrap(req, name, "own req");
    answer(res);
  },
  implicitHeader(req, res) { wrap(res, "writeHead", "own res"); res.setHeader("x-a", "2"); res.end("ok"); },
  extras(req, res) { res.locals = { a: 1 }; req.params = {}; req.res = res; res.req2 = req; answer(res); say(Object.keys(res).includes("locals"), Object.keys(req).includes("params")); },
  otherPrototype(req, res) {
    const response = Object.create(http.ServerResponse.prototype, { send: { value(text) { this.setHeader("x-a", "3"); this.end(text); } } });
    const request = Object.create(http.IncomingMessage.prototype, { get: { value(name) { return this.headers[name]; } } });
    Object.setPrototypeOf(res, response); Object.setPrototypeOf(req, request);
    say(req.get("host") !== undefined, res instanceof http.ServerResponse, req instanceof http.IncomingMessage);
    res.send("ok");
  },
  otherPrototypeThatOverrides(req, res) {
    const response = Object.create(http.ServerResponse.prototype);
    wrap(response, "emit", "heir"); wrap(response, "setHeader", "heir"); wrap(response, "detachSocket", "heir");
    Object.setPrototypeOf(res, response);
    answer(res);
  },
  fieldsFromOutside(req, res) {
    res.statusCode = 201; res.statusMessage = "Made"; res.sendDate = false; res.shouldKeepAlive = true;
    say(res.statusCode, res.statusMessage, res.finished, res.headersSent, res._header, res.writable, res.destroyed, req.url, req.method, req.complete, req.upgrade, typeof req.socket, req.socket === res.socket);
    delete res.statusMessage; say("statusMessage" in res, res.statusMessage);
    Object.defineProperty(res, "sendDate", { get() { say("get sendDate"); return false; }, set() {}, configurable: true });
    say(res.sendDate);
    res.end("ok");
  },
  ownSocketMethods(req, res) {
    const undo = [wrap(req.socket, "resume", "own socket"), wrap(req.socket, "setTimeout", "own socket"), wrap(req.socket, "emit", "own socket")];
    res.on("close", () => setImmediate(() => undo.forEach(run => run())));
    answer(res);
  },
  ownSocketAccessors(req, res) {
    const undo = [wrapGetter(req.socket, Duplex.prototype, "destroyed", "own socket"), wrapGetter(req.socket, Readable.prototype, "readable", "own socket"), wrapGetter(req.socket, Duplex.prototype, "writableHighWaterMark", "own socket"), wrapGetter(req.socket, Readable.prototype, "readableHighWaterMark", "own socket")];
    res.on("close", () => setImmediate(() => undo.forEach(run => run())));
    answer(res);
  },
  socketExtras(req, res) { req.socket.mine = (req.socket.mine ?? 0) + 1; say("socket.mine", req.socket.mine, req.socket.destroyed, req.socket.readable, req.socket.writableHighWaterMark, req.socket.readableHighWaterMark, typeof req.socket.parser, req.socket._httpMessage === res); answer(res); },
  bodyWithOwnSocketResume(req, res) {
    const undo = wrap(req.socket, "resume", "own socket");
    let text = ""; req.on("data", piece => (text += piece)); req.on("end", () => { say("body", text); undo(); answer(res); });
  },
  body(req, res) { let text = ""; req.on("data", piece => (text += piece)); req.on("end", () => { say("body", text); answer(res); }); },
};
const patches = {
  responseEmit: () => wrap(http.ServerResponse.prototype, "emit", "patched"),
  emitterEmit: () => wrap(EventEmitter.prototype, "emit", "patched emitter"),
  setHeader: () => wrap(http.ServerResponse.prototype, "setHeader", "patched"),
  outgoingHasHeader: () => wrap(http.OutgoingMessage.prototype, "hasHeader", "patched"),
  readableRead: () => wrap(Readable.prototype, "read", "patched"),
  readablePush: () => wrap(Readable.prototype, "push", "patched"),
  incomingDump: () => wrap(http.IncomingMessage.prototype, "_dump", "patched"),
  statusCodeAccessor() {
    let held = 0;
    Object.defineProperty(http.ServerResponse.prototype, "statusCode", { get() { return held; }, set(value) { say("set statusCode", value); held = value; }, configurable: true });
    return () => { delete http.ServerResponse.prototype.statusCode; };
  },
  urlAccessor() {
    const before = Object.getOwnPropertyDescriptor(http.IncomingMessage.prototype, "url");
    let held = "";
    Object.defineProperty(http.IncomingMessage.prototype, "url", { get() { return held; }, set(value) { say("set url", value); held = value; }, configurable: true });
    return () => { Object.defineProperty(http.IncomingMessage.prototype, "url", before); };
  },
  newMethodOnPrototype() { http.ServerResponse.prototype.extraMethod = function () {}; return () => { delete http.ServerResponse.prototype.extraMethod; }; },
  nextTick: () => wrap(process, "nextTick", "patched"),
  readableResume: () => wrap(Readable.prototype, "resume", "patched"),
  duplexResume: () => wrap(Duplex.prototype, "resume", "patched duplex"),
  netSocketResume: () => wrap(net.Socket.prototype, "resume", "patched net"),
  netSocketSetTimeout: () => wrap(net.Socket.prototype, "setTimeout", "patched net"),
  duplexDestroyed: () => wrapGetter(Duplex.prototype, Duplex.prototype, "destroyed", "patched"),
  readableReadable: () => wrapGetter(Readable.prototype, Readable.prototype, "readable", "patched"),
  highWaterMarks() { const undo = [wrapGetter(Duplex.prototype, Duplex.prototype, "writableHighWaterMark", "patched"), wrapGetter(Readable.prototype, Readable.prototype, "readableHighWaterMark", "patched")]; return () => undo.forEach(run => run()); },
};
server.listen(0, "127.0.0.1", async () => {
  const { port } = server.address();
  for (let round = 0; round < 2; round++) {
    for (const [name, run] of Object.entries(scenarios)) {
      scenario = run;
      say("==", name, await ask(port, name.startsWith("body") ? "POST" : "GET", name.startsWith("body") ? "sent" : undefined));
      await wait();
      scenario = scenarios.plain;
      say("   then plain", await ask(port));
      await wait();
    }
    for (const [name, patch] of Object.entries(patches)) {
      scenario = scenarios.plain;
      const undo = patch();
      const got = await ask(port);
      await wait();
      undo();
      say("== patch", name, got);
      say("   then plain", await ask(port));
      await wait();
    }
    if (typeof Bun !== "undefined") Bun.gc(true);
  }
  console.log(log.join("\n"));
  agent.destroy();
  server.close();
});
