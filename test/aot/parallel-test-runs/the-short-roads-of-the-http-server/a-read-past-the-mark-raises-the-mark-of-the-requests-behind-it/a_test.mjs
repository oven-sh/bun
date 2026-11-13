// socket.read(n) with n over the mark raises the mark of the socket. Each request takes the mark that its socket has when the request comes.
import { test, expect } from "bun:test";
import http from "node:http";
import net from "node:net";
test("each request has the mark of its socket", async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(`${req.url} ${req.readableHighWaterMark === req.socket.readableHighWaterMark}`);
    if (req.url === "/first") req.socket.read(req.socket.readableHighWaterMark + 1);
    res.end("ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => {
    const client = net.connect(server.address().port, "127.0.0.1");
    const asks = ["/first", "/second", "/third"];
    const ask = () => client.write(`GET ${asks.shift()} HTTP/1.1\r\nHost: a\r\n\r\n`);
    client.on("connect", ask);
    client.on("data", (bytes) => {
      if (!String(bytes).endsWith("ok")) return;
      if (asks.length) return void ask();
      client.destroy();
      server.close(resolve);
    });
  });
  console.log(seen.join(" | "));
  expect(seen).toEqual(["/first true", "/second true", "/third true"]);
});
