// node:http declares that a listener receives a request and a response, but that is only a prediction. The program calls the listener itself with a plain object,
// a proxy, null, a number, a symbol and a subclass of IncomingMessage, and makes the server emit "request" with its own objects.
const http = require("node:http");
const log = [];
function route(req) {
  try {
    return `${req.method} ${req.url}`;
  } catch (error) {
    return error.constructor.name;
  }
}
function send(res, text) {
  try {
    res.statusCode = 201;
    res.setHeader("X-A", "b");
    res.end(text);
    return `sent ${res.statusCode}`;
  } catch (error) {
    return error.constructor.name;
  }
}
function listener(req, res) {
  log.push(route(req));
  log.push(send(res, "ok"));
}
const server = http.createServer(listener);

const mock = {
  headers: {},
  setHeader(name, value) {
    this.headers[name] = value;
  },
  end(text) {
    this.body = text;
  },
};
listener({ method: "MOCK", url: "/mock" }, mock);
log.push(JSON.stringify(mock));
listener(
  new Proxy({}, { get: (target, key) => `proxy:${String(key)}` }),
  new Proxy({}, { get: (target, key) => (key === "statusCode" ? 7 : () => log.push(`called ${String(key)}`)), set: (target, key, value) => (log.push(`set ${String(key)} ${value}`), true) }),
);
listener(null, undefined);
listener(1, "text");
listener(Symbol.iterator, () => {});
class Request extends http.IncomingMessage {
  get method() {
    return "SUBCLASS";
  }
  set method(value) {}
}
const below = Object.create(Request.prototype);
below.url = "/below";
listener(below, Object.create(mock));
server.emit("request", { method: "EMITTED", url: "/emitted" }, Object.create(mock));

server.listen(0, "127.0.0.1", async () => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/real`);
  log.push(`${response.status} ${response.headers.get("x-a")} ${await response.text()}`);
  console.log(log.join("\n"));
  server.close();
});
