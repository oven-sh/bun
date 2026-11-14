// socket._writableState is replaced by a copy with a mark of 1: write() answers by the copy, as without compilation.
import http from "node:http";
import net from "node:net";
const log = [];
const server = http.createServer((req, res) => {
  if (req.url === "/second") {
    const state = req.socket._writableState;
    const copy = Object.create(Object.getPrototypeOf(state), Object.getOwnPropertyDescriptors(state));
    copy.highWaterMark = 1;
    req.socket._writableState = copy;
  }
  res.setHeader("Content-Length", 2);
  log.push(`${req.url} ${res.write("ok")} ${res.writableHighWaterMark === 1}`);
  res.end();
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  const asks = ["/first", "/second", "/third"];
  const ask = () => client.write(`GET ${asks.shift()} HTTP/1.1\r\nHost: a\r\n\r\n`);
  client.on("connect", ask);
  client.on("data", (bytes) => {
    if (!String(bytes).endsWith("ok")) return;
    if (asks.length) return void ask();
    client.destroy(); server.close(); console.log(log.join(" | "));
  });
});
