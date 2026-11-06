// Ways to register a listener: as the only argument, after options, as a method read from its object, bound, through new Server(), through on("request").
// The program also calls one of them with two numbers.
const http = require("node:http");
const log = [];
function describe(req, res) {
  return `${req.method} ${req.url} ${res.statusCode} ${typeof res.end}`;
}
function first(req, res) {
  log.push(`first ${describe(req, res)}`);
  res.end("first");
}
const holder = {
  second(req, res) {
    log.push(`second ${describe(req, res)} ${this === server}`);
    res.end("second");
  },
};
const bound = function (tag, req, res) {
  log.push(`bound ${tag} ${describe(req, res)}`);
  res.end("bound");
}.bind(null, "tag");
// The same function is a listener and an ordinary function of two numbers.
function both(a, b) {
  if (typeof a === "number") return a + b;
  log.push(`both ${describe(a, b)}`);
  b.end("both");
}
log.push(both(1, 2));
const listeners = [first, holder.second, bound, both];
let server;
async function ask(listener, options) {
  server = options ? http.createServer(options, listener) : http.createServer(listener);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/x`, { method: "POST", body: "b" });
  log.push(`${response.status} ${await response.text()}`);
  await new Promise(resolve => server.close(resolve));
}
(async () => {
  for (const listener of listeners) await ask(listener);
  for (const listener of listeners) await ask(listener, {});
  server = new http.Server(first);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  server.removeAllListeners("request");
  server.on("request", both);
  log.push(await (await fetch(`http://127.0.0.1:${server.address().port}/y`)).text());
  await new Promise(resolve => server.close(resolve));
  log.push(both(3, 4));
  console.log(log.join("\n"));
})();
