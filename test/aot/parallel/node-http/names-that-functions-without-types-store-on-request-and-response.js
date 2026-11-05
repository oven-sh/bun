// A listener hands the request and the response on to functions without types, which store names on them that the library never stores, as frameworks do: some on every
// request, some on every other one, one removed and stored again, one made an accessor, under another prototype. What a program can ask about those names is asked.
const http = require("node:http");
const requestPrototype = Object.create(http.IncomingMessage.prototype, {
  label: {
    get() {
      return `${this.method} ${this.originalUrl}`;
    },
    configurable: true,
  },
});
function prepare(req, res, next) {
  req.res = res;
  res.req = req;
  req.next = next;
  Object.setPrototypeOf(req, requestPrototype);
  res.locals = Object.create(null);
}
function route(req, turn) {
  req.baseUrl = "";
  req.originalUrl = req.originalUrl || req.url;
  if (turn % 2) req.params = { turn };
  req.route = turn;
  delete req.route;
  req.route = `r${turn}`;
  if (turn % 3 === 0) Object.defineProperty(req, "query", { get: () => turn, enumerable: true, configurable: true });
}
const late = ["res", "req", "next", "locals", "baseUrl", "originalUrl", "params", "route", "query", "label", "absent"];
function describe(object) {
  const keys = Object.keys(object).filter(key => late.includes(key));
  const inLoop = [];
  for (const key in object) if (late.includes(key)) inLoop.push(key);
  const lines = [keys.join(), inLoop.join()];
  for (const name of late) {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    lines.push(
      `${name} ${name in object} ${Object.hasOwn(object, name)} ${descriptor ? `${"value" in descriptor ? "value" : "accessor"} ${descriptor.writable} ${descriptor.enumerable} ${descriptor.configurable}` : "none"}`,
    );
  }
  lines.push(
    JSON.stringify(object, (key, value) =>
      key === "" || (late.includes(key) && typeof value !== "object" && typeof value !== "function")
        ? value
        : undefined,
    ),
  );
  return lines.join("\n  ");
}
let turn = 0;
const printed = [];
function listener(req, res) {
  const now = turn++;
  prepare(req, res, () => now);
  route(req, now);
  printed.push(
    `${now} ${req.label} ${req.next()} ${req.res === res} ${res.req === req}\n  ${describe(req)}\n  ${describe(res)}`,
  );
  res.end("ok");
}
const server = http.createServer(listener);
server.listen(0, "127.0.0.1", async () => {
  for (let i = 0; i < 7; i++) await (await fetch(`http://127.0.0.1:${server.address().port}/p${i}`)).text();
  for (const text of printed) console.log(text);
  server.close();
});
