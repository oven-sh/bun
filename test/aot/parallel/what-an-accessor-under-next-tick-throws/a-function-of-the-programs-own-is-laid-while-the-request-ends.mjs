// A tick of the program's own lays a function under process.nextTick while a request without a body goes its way to its end. From there on the function is handed what the library hands it: the same callbacks, by name and number of arguments.
import http from "node:http";
import net from "node:net";
const original = process.nextTick;
const pause = ms => new Promise(done => setTimeout(done, ms));
const server = http.createServer((req, res) => {
  if (req.url === "/warm") return void res.end("warm");
  const handed = [];
  req.on("close", () => {
    process.nextTick = original;
    console.log(req.url, "closes, handed:", handed.join(" "));
  });
  res.end("ok");
  if (req.url === "/laid") {
    process.nextTick(() => {
      process.nextTick = function (callback, ...rest) {
        handed.push(callback.name + "/" + rest.length);
        return original(callback, ...rest);
      };
    });
  }
});
server.listen(0, "127.0.0.1", async () => {
  for (const path of ["/control", "/laid"]) {
    const socket = net
      .connect(server.address().port, "127.0.0.1")
      .on("error", () => {})
      .on("data", () => {});
    for (const url of ["/warm", path]) {
      socket.write(`GET ${url} HTTP/1.1\r\nHost: a\r\n\r\n`);
      await pause(80);
    }
    socket.destroy();
  }
  server.closeAllConnections();
  server.close();
});
