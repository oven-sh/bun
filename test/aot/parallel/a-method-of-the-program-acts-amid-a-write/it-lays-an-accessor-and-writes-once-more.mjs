// write() calls getHeader() and _callPendingCallbacks(). One of the program's own lays an accessor on the response and writes once more. How many bytes the response says it holds is as without compilation.
import http from "node:http";
let way = "",
  seen = "";
const server = http.createServer((req, res) => {
  const original = res[way];
  let acted = false;
  res[way] = function (...values) {
    if (!acted) {
      acted = true;
      Object.defineProperty(this, "madeUp", { configurable: true, get: () => 1 });
      this.write("in");
    }
    return Reflect.apply(original, this, values);
  };
  res.write("out");
  seen = String(res.writableLength);
  res.end();
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
for (way of ["getHeader", "_callPendingCallbacks"]) {
  const body = await (await fetch(url)).text();
  console.log(way + ": " + body + " | writableLength " + seen);
}
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
