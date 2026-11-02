// req.headers is built natively where a read of req.rawHeaders would reach IncomingMessage.prototype's own accessor. Whatever stands in front of that accessor (an own property, a class below, a prototype put in between, a proxy) is read instead, and the traps of a proxy run in the order of a lookup.
const http = require("node:http");
const lines = [];
const show = (label, value) => lines.push(label + ": " + JSON.stringify(value));
const pick = headers => ({ "x-one": headers["x-one"], "x-two": headers["x-two"], cookie: headers.cookie, "set-cookie": headers["set-cookie"] });
class Below extends http.IncomingMessage {
  get rawHeaders() { return ["X-One", "from the class below", "X-Two", "b"]; }
  set rawHeaders(value) {}
}
const cases = {
  plain(req) { show("plain", pick(req.headers)); show("plain raw", req.rawHeaders.filter((_, i) => i % 2 === 0).map(name => name.toLowerCase()).filter(name => name.startsWith("x-"))); },
  rawFirst(req) { const raw = req.rawHeaders; show("raw first", [raw.length > 0, pick(req.headers)]); },
  assigned(req) { req.rawHeaders = ["X-One", "assigned", "X-Two", "2"]; show("assigned", pick(req.headers)); },
  own(req) { Object.defineProperty(req, "rawHeaders", { value: ["X-One", "own", "X-One", "again"], configurable: true }); show("own", pick(req.headers)); },
  ownGetter(req) { Object.defineProperty(req, "rawHeaders", { get() { return ["X-Two", "own getter"]; }, configurable: true }); show("own getter", pick(req.headers)); },
  sameGetter(req) { Object.defineProperty(req, "rawHeaders", Object.getOwnPropertyDescriptor(http.IncomingMessage.prototype, "rawHeaders")); show("same getter", pick(req.headers)); },
  between(req) { Object.setPrototypeOf(req, Object.create(Object.create(http.IncomingMessage.prototype))); show("between", pick(req.headers)); },
  betweenWithName(req) { const middle = Object.create(http.IncomingMessage.prototype, { rawHeaders: { value: ["X-One", "in between"] } }); Object.setPrototypeOf(req, Object.create(middle)); show("between with the name", pick(req.headers)); },
  otherFold(req) { req._addHeaderLine = function (field, value, dest) { dest[field.toLowerCase()] = "folded " + value; }; show("other fold", pick(req.headers)); },
  twice(req) { show("twice", [req.headers === req.headers, pick(req.headers)]); },
  stored(req) { req.headers = { "x-one": "stored" }; show("stored", pick(req.headers)); },
  proxy(req) {
    const seen = [];
    const note = (trap, key) => { if (typeof key !== "symbol") seen.push(key === undefined ? trap : trap + " " + key); };
    const proxy = new Proxy(req, {
      get(target, key, receiver) { note("get", key); return Reflect.get(target, key, typeof key === "symbol" ? target : receiver); },
      set(target, key, value) { note("set", key); target[key] = value; return true; },
      has(target, key) { note("has", key); return key in target; },
      getOwnPropertyDescriptor(target, key) { note("getOwnPropertyDescriptor", key); return Reflect.getOwnPropertyDescriptor(target, key); },
      getPrototypeOf(target) { note("getPrototypeOf"); return Reflect.getPrototypeOf(target); },
    });
    show("proxy", pick(proxy.headers)); show("proxy traps", seen);
  },
  onPrototype() { let answer; try { answer = pick(http.IncomingMessage.prototype.headers); } catch (error) { answer = error.name; } show("on the prototype", answer); },
  withoutParent(req) { const get = Object.getOwnPropertyDescriptor(http.IncomingMessage.prototype, "headers").get; let answer; try { answer = Object.keys(get.call(Object.create(null))); } catch (error) { answer = error.name; } show("without a parent", answer); },
};
const names = Object.keys(cases);
function serve(options, list, done) {
  const server = http.createServer(options, (req, res) => { cases[req.url.slice(1)](req); res.end("ok"); });
  server.listen(0, "127.0.0.1", async () => {
    for (const name of list) for (let round = 0; round < 3; round++) {
      const before = lines.length;
      await new Promise(resolve => http.get({ port: server.address().port, host: "127.0.0.1", path: "/" + name, agent: false, headers: { "X-One": "1", "X-Two": ["a", "b"], Cookie: ["c=1", "d=2"] } }, res => { res.resume(); res.on("end", resolve); }));
      if (round) lines.length = before;
    }
    server.close(done);
  });
}
serve({}, names, () => { lines.push("-- a class below"); serve({ IncomingMessage: Below }, ["plain", "twice", "own", "between"], () => console.log(lines.join("\n"))); });
