const http = require("node:http"), net = require("node:net");
// Runs the event loop that many times: jobs, errors that nobody handles and what has arrived run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const GET = "GET / HTTP/1.1\r\nHost: a\r\n\r\n";
const server = new (class Mine extends http.Server {})((q, r) => r.end("x"));
Object.defineProperty(server, "maxRequestsPerSocket", { configurable: true, get: () => 2, set() {} });
// Longer than a program may run: nothing but the limit of requests closes the socket.
Object.defineProperty(server, "keepAliveTimeout", { configurable: true, get: () => 700000, set() {} });
server.listen(0, "127.0.0.1", () => {
  const s = net.connect(server.address().port, "127.0.0.1");
  let n = 0;
  s.on("data", bytes => {
    console.log(String(bytes).split("\r\n").filter(line => /^(HTTP\/|connection:|keep-alive:)/i.test(line)).join(";").toLowerCase());
    if (++n < 3) spinEventLoop().then(() => s.write(GET));
  });
  s.on("error", error => console.log(error.code));
  s.on("close", () => { console.log("closed"); spinEventLoop().then(() => process.exit(0)); });
  s.write(GET);
});
