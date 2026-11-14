const http = require("node:http"), net = require("node:net");
// Runs the event loop that many times: jobs, errors that nobody handles and what has arrived run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const GET = "GET / HTTP/1.1\r\nHost: a\r\n\r\n";
const server = http.createServer((q, r) => r.end("x"));
Object.defineProperty(server, "maxRequestsPerSocket", { configurable: true, get: () => 2, set() {} });
Object.defineProperty(server, "keepAliveTimeout", { configurable: true, get: () => 7000, set() {} });
server.listen(0, "127.0.0.1", () => {
  const s = net.connect(server.address().port, "127.0.0.1");
  const said = [];
  let n = 0;
  s.on("data", bytes => {
    said.push(String(bytes).split("\r\n").filter(line => /^(connection|keep-alive):/i.test(line)).join(";").toLowerCase());
    if (++n < 3) spinEventLoop().then(() => s.write(GET));
  });
  s.on("close", () => { said.push("closed"); console.log(said.join(" | ")); process.exit(0); });
  s.on("error", () => {});
  s.write(GET);
});
