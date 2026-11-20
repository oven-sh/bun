// As it-lays-an-accessor-on-the-response.mjs, with the function on ServerResponse.prototype.
import http from "node:http";
const holder = http.ServerResponse.prototype,
  original = holder.writeHead;
const server = http.createServer((req, res) => {
  holder.writeHead = function (code, message) {
    Object.defineProperty(this, "madeUp", { configurable: true, get: () => 1 });
    Reflect.apply(original, this, [code, message]);
    this.statusCode = 503;
    return this;
  };
  res.end("body");
  holder.writeHead = original;
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const response = await fetch("http://127.0.0.1:" + server.address().port),
  body = await response.text();
console.log(response.status + " " + response.statusText + " " + body);
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
