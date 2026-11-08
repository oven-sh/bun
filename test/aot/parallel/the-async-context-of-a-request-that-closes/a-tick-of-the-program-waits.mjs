import http from "node:http";
import net from "node:net";
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage();
const seen = [];
let client;
const server = http.createServer((req, res) => {
  req.on("data", () => {
    process.nextTick(() => process.nextTick(() => seen.push("tick of 'data': " + als.getStore())));
  });
  req.on("end", () => als.enterWith("entered in 'end'"));
  req.on("close", () => {
    seen.push("'close': " + als.getStore());
    console.log(seen.join(" . "));
    res.end("ok");
  });
  setImmediate(() => client.write("hello"));
});
server.listen(0, "127.0.0.1", () => {
  client = net.connect(server.address().port, "127.0.0.1", () =>
    client.write("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\nConnection: close\r\n\r\n"),
  );
  client.resume();
  client.on("close", () => server.close());
});
