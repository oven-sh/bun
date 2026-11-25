// end() and write() call a writeHead() of the program's own where no head was taken. That function lays an accessor on the response, calls the library's writeHead() and then stores another status code, which comes too late for the wire. The status and the body that the client gets are as without compilation.
import http from "node:http";
const original = http.ServerResponse.prototype.writeHead;
let way = "";
function ownWriteHead(code, message) {
  Object.defineProperty(this, "madeUp", { configurable: true, get: () => 1 });
  Reflect.apply(original, this, [code, message]);
  this.statusCode = 503;
  return this;
}
const server = http.createServer((req, res) => {
  res.writeHead = ownWriteHead;
  if (way === "end") res.end("body");
  else {
    res.write("bo");
    res.end("dy");
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port;
for (way of ["end", "write, end"]) {
  const response = await fetch(url),
    body = await response.text();
  console.log(way + ": " + response.status + " " + response.statusText + " " + body);
}
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
