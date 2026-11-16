// The private name under which a response holds that end() sent its head lies on the prototype of responses: a head sent by writeHead() is framed by it, as without compilation. The program finds the name on a response whose writeHead() is its own.
import http from "node:http";
const NAME = "kImplicitHeaderFromEnd";
const kept = [];
const names = {};
let armed = false;
let connections = 0;
let seen = "";
let last = [];
const above = http.ServerResponse.prototype;
const server = http.createServer((req, res) => {
  kept.push(res);
  if (!armed) {
    if (req.url === "/head") res.writeHead(200);
    if (req.url === "/write") res.write("x");
    if (req.url === "/close") res.setHeader("connection", "close");
    if (req.url === "/observed") {
      res.writeHead = function (...list) {
        return http.ServerResponse.prototype.writeHead.apply(this, list);
      };
    }
    return res.end("first");
  }
  if (req.url === "/again") return res.end("again");
  if (NAME !== "none") above[names[NAME]] = true;
  if (req.url === "/explicit") res.writeHead(200);
  last = [req, res, req.socket];
  res.on("close", () => {
    seen =
      String(res.socket === null) + " " + String(req.socket._httpMessage === res) + " " + String(req.socket.destroyed);
  });
  res.end("body");
});
server.on("connection", () => connections++);
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
for (const path of ["/plain", "/head", "/write", "/close", "/observed"]) await (await fetch(url + path)).text();
await new Promise(resolve => setTimeout(resolve, 20));
for (const res of kept) for (const symbol of Object.getOwnPropertySymbols(res)) names[symbol.description] = symbol;
armed = true;
const before = connections;
const got = await fetch(url + "/explicit");
const body = await got.text();
await new Promise(resolve => setTimeout(resolve, 20));
await (await fetch(url + "/again")).text();
console.log(
  [
    NAME === "none" || typeof names[NAME] === "symbol",
    got.status + " " + got.statusText,
    got.headers.get("content-length") +
      " " +
      got.headers.get("transfer-encoding") +
      " " +
      got.headers.get("connection"),
    body,
    seen,
    "later " +
      [
        last[2]._httpMessage === last[1],
        last[2]._httpMessage === null,
        last[1].socket === null,
        last[1].socket === last[2],
        last[1].destroyed,
        last[2].listenerCount("close"),
        last[2].listenerCount("drain"),
      ].join(" "),
    "new connections " + (connections - before),
  ].join(" | "),
);
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
