// An accessor laid on the socket in place of its parser throws at its first read. The error is heard, whether the handler resumed the request or left it alone.
const http = require("node:http");
const net = require("node:net");
let heard = [];
process.on("uncaughtException", error => heard.push(error.message));
const text = "GET / HTTP/1.1\r\nHost: a\r\n\r\n";
async function run(resumes) {
  heard = [];
  let turn = 0;
  let reads = 0;
  const { promise, resolve } = Promise.withResolvers();
  const server = http.createServer((req, res) => {
    if (turn++ === 1) {
      const parser = req.socket.parser;
      Object.defineProperty(req.socket, "parser", {
        configurable: true,
        get() {
          if (reads++ === 0) throw new Error("made up: parser");
          return parser;
        },
        set() {},
      });
      setImmediate(() => setImmediate(resolve));
    }
    if (resumes) req.resume();
    res.end("ok");
  });
  await new Promise(listened => server.listen(0, "127.0.0.1", listened));
  const client = net.connect(server.address().port, "127.0.0.1");
  let answers = 0;
  client.on("error", () => {});
  client.on("data", () => {
    if (++answers === 1) client.write(text);
  });
  client.write(text);
  await promise;
  console.log(resumes ? "resumed" : "left alone", "heard", heard.join(), "read", reads > 0);
  client.destroy();
  server.close();
  server.closeAllConnections();
}
run(false).then(() => run(true));
