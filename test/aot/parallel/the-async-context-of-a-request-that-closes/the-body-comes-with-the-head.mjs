import http from "node:http";
import net from "node:net";
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage();
const server = http.createServer((req, res) => {
  req.on("data", () => {});
  req.on("end", () => als.enterWith("entered in 'end'"));
  req.on("close", () => {
    console.log("'close' sees:", String(als.getStore()));
    res.end("ok");
  });
});
server.listen(0, "127.0.0.1", () => {
  const client = net.connect(server.address().port, "127.0.0.1", () =>
    client.write("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello"),
  );
  client.resume();
  client.on("close", () => server.close());
});
