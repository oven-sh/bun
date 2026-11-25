// A handler writes the marks of its socket: the write behind the store goes by the new mark, and so does the next request on the connection.
import http from "node:http";
import net from "node:net";
const log = [];
let requests = 0;
const server = http.createServer((req, res) => {
  requests++;
  if (requests === 2) {
    req.socket._readableState.highWaterMark = 1234;
    req.socket._writableState.highWaterMark = 1;
  }
  res.setHeader("Content-Length", 2);
  const took = res.write("ok");
  log.push(`${requests}: ${req.readableHighWaterMark === 1234} ${res.writableHighWaterMark === 1} ${took}`);
  res.end();
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1");
  let answers = 0;
  const ask = () => client.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  client.on("connect", ask);
  client.on("data", (bytes) => {
    if (!String(bytes).endsWith("ok")) return;
    if (++answers < 3) return void ask();
    client.destroy();
    server.close();
    console.log(log.join(" | "));
  });
});
