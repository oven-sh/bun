// What lies under two private names of a response, the state of its head and the function called at its close, is read and called as without compilation; one row lays a function there at 'finish' and needs no accessor.
import http from "node:http";
let line = [],
  way = "",
  open = true;
const find = (res, description) => Object.getOwnPropertySymbols(res).find(found => found.description === description);
function trace(res, symbol) {
  let value = res[symbol];
  Object.defineProperty(res, symbol, {
    configurable: true,
    enumerable: true,
    get() {
      if (open) line.push("get");
      return value;
    },
    set(next) {
      if (open) line.push("set " + typeof next);
      value = next;
    },
  });
}
const server = http.createServer((req, res) => {
  const close = find(res, "closeCallback");
  if (way === "headersSent is asked") {
    trace(res, find(res, "headerState"));
    line.push(String(res.headersSent));
    open = false;
  } else if (way === "a function is laid at finish")
    res.on("finish", () => {
      res[close] = () => line.push("called");
    });
  else trace(res, close);
  if (way === "ended later") setImmediate(() => res.end("k"));
  else res.end("k");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
for (way of ["headersSent is asked", "ended in the listener", "ended later", "a function is laid at finish"]) {
  line = [];
  open = true;
  const body = await (await fetch(url)).text();
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
  console.log(way + ": " + body + " | " + line.join(" . "));
}
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
