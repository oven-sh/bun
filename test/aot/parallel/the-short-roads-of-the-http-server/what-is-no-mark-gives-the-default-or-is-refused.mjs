// A socket whose mark is null or undefined gives its requests and responses the default, and a mark that no stream takes is refused when the next request comes.
import http from "node:http";
import net from "node:net";
const log = [];
let client;
let readableAtFirst;
let writableAtFirst;
function finish() {
  client.destroy();
  server.close();
  console.log(log.join(" | "));
}
process.on("uncaughtException", (error) => {
  log.push("uncaught " + error.code);
  finish();
});
const server = http.createServer((req, res) => {
  readableAtFirst ??= req.readableHighWaterMark;
  writableAtFirst ??= res.writableHighWaterMark;
  res.setHeader("Content-Length", 2);
  const took = res.write("ok");
  log.push(`${req.url} ${req.readableHighWaterMark === readableAtFirst} ${res.writableHighWaterMark === writableAtFirst} ${took}`);
  if (req.url === "/second") req.socket._readableState.highWaterMark = null;
  if (req.url === "/third") req.socket._writableState.highWaterMark = undefined;
  if (req.url === "/fourth") req.socket._readableState.highWaterMark = 1.5;
  res.end();
});
server.listen(0, "127.0.0.1", () => {
  client = net.connect(server.address().port, "127.0.0.1");
  const asks = ["/first", "/second", "/third", "/fourth", "/fifth"];
  const ask = () => client.write(`GET ${asks.shift()} HTTP/1.1\r\nHost: a\r\n\r\n`);
  client.on("connect", ask);
  client.on("data", (bytes) => {
    if (!String(bytes).endsWith("ok")) return;
    if (asks.length) return void ask();
    finish();
  });
});
