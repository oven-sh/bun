const http = require("node:http"), net = require("node:net");
const GET = "GET / HTTP/1.1\r\nHost: a\r\n\r\n";
const server = new (class Mine extends http.Server {})((q, r) => r.end("x"));
Object.defineProperty(server, "maxRequestsPerSocket", { configurable: true, get: () => 2, set() {} });
Object.defineProperty(server, "keepAliveTimeout", { configurable: true, get: () => 7000, set() {} });
server.listen(0, "127.0.0.1", () => {
  const s = net.connect(server.address().port, "127.0.0.1");
  const said = [];
  let n = 0;
  s.on("data", bytes => {
    said.push(String(bytes).split("\r\n").filter(line => /^(connection|keep-alive):/i.test(line)).join(";").toLowerCase());
    if (++n < 3) setTimeout(() => s.write(GET), 30);
  });
  s.on("close", () => said.push("closed"));
  s.on("error", () => {});
  setTimeout(() => { console.log(said.join(" | ")); process.exit(0); }, 400);
  s.write(GET);
});
