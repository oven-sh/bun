// An object is laid between a response and its prototype, as express lays app.response. Under one name it holds a getter, a setter, a value that is not writable or a function.
// The names are those that the short roads of node:http spare behind a question by name: with every such question answering yes these rows differ from plain.
// A row a name, a deed and a moment; a connection of its own with two requests. Printed: whether what was laid was touched, what came over the wire, what was thrown. No counts.
const http = require("node:http");
const net = require("node:net");
const names = { response: "_callPendingCallbacks detachSocket getHeader socket" };
const deeds = ["a getter", "a setter", "not writable", "a function"];
const define = (object, name, value) => Object.defineProperty(object, name, { value, writable: true, enumerable: true, configurable: true });
function lay(object, name, deed, note) {
  const above = Object.getPrototypeOf(object);
  let descriptor;
  if (deed === "a getter")
    descriptor = { configurable: true, get() { note(); return Reflect.get(above, name, this); }, set(value) { define(this, name, value); } };
  else if (deed === "a setter")
    descriptor = { configurable: true, get() { return Reflect.get(above, name, this); }, set(value) { note(); define(this, name, value); } };
  else if (deed === "not writable") descriptor = { configurable: true, writable: false, value: Reflect.get(above, name, object) };
  else {
    const found = Reflect.get(above, name, object);
    descriptor = { configurable: true, writable: true, value: function (...all) { note(); return found.apply(this, all); } };
  }
  Object.setPrototypeOf(object, Object.create(above, { [name]: descriptor }));
}
const rows = [];
for (const object in names) {
  for (const name of names[object].split(" "))
    for (const deed of deeds)
      for (const moment of ["in the handler, which ends at once", "in the handler", "amid the response"]) rows.push({ object, name, deed, moment });
}
const tell = error => (error?.name ?? "thrown") + " " + String(error?.code ?? error?.message ?? error).slice(0, 60);
let said = [];
process.on("uncaughtException", error => said.push("uncaught " + tell(error)));
function run(row, done) {
  said = [];
  let touched = false;
  const laidOn = new WeakSet();
  const note = () => void (touched = true);
  const isCallable = object => typeof Reflect.get(Object.getPrototypeOf(object), row.name, object) === "function";
  const act = object => {
    if (laidOn.has(object) || ((row.deed === "a function") !== isCallable(object) && row.deed === "a function")) return;
    laidOn.add(object);
    lay(object, row.name, row.deed, note);
  };
  const endsAtOnce = row.moment === "in the handler, which ends at once";
  const server = http.createServer((req, res) => {
    const target = { server, response: res, request: req, socket: req.socket }[row.object];
    try {
      if (row.moment !== "amid the response") act(target);
      if (endsAtOnce) return void res.end("x");
      res.write("a");
      if (row.moment === "amid the response") act(target);
      res.end("b");
    } catch (error) {
      said.push("handler threw " + tell(error));
      try {
        if (!res.finished) res.end();
      } catch {}
    }
  });
  server.on("error", error => said.push("server error " + tell(error)));
  server.on("clientError", error => said.push("client error " + tell(error)));
  try {
    server.listen(0, "127.0.0.1", ask);
  } catch (error) {
    said.push("listen threw " + tell(error));
    return void finish();
  }
  let isFinished = false;
  let client;
  const timer = setTimeout(() => (said.push("no end"), finish()), 900);
  function finish() {
    if (isFinished) return;
    isFinished = true;
    clearTimeout(timer);
    client?.destroy();
    http.Server.prototype.close.call(server);
    http.Server.prototype.closeAllConnections.call(server);
    console.log([row.object, row.name, row.deed, row.moment].join(" . ") + ": touched " + touched + " | " + said.join(" | "));
    setTimeout(done, 2);
  }
  function ask() {
    const port = http.Server.prototype.address.call(server).port;
    client = net.connect(port, "127.0.0.1");
    const text = "GET / HTTP/1.1\r\nHost: a\r\n\r\n";
    let got = "";
    let answers = 0;
    client.on("data", bytes => {
      got += bytes;
      if (!got.endsWith(endsAtOnce ? "\r\n\r\nx" : "0\r\n\r\n")) return;
      said.push(got.split("\r\n")[0].slice(9) + " " + JSON.stringify(got.split("\r\n\r\n").slice(1).join("")));
      got = "";
      ++answers < 2 ? setTimeout(() => client.write(text), 4) : setTimeout(finish, 12);
    });
    client.on("error", () => {});
    client.on("close", () => (said.push("closed"), setTimeout(finish, 12)));
    client.write(text);
  }
}
(function next() {
  const row = rows.shift();
  if (row) run(row, next);
})();
