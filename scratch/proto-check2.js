const tls = require("node:tls");
const fs = require("node:fs");
const path = require("node:path");
const fixtures = path.join(__dirname, "..", "test", "js", "node", "test", "fixtures", "keys");
const key = fs.readFileSync(path.join(fixtures, "agent1-key.pem"));
const cert = fs.readFileSync(path.join(fixtures, "agent1-cert.pem"));
const server = tls.createServer({ key, cert, secureProtocol: "TLSv1_2_server_method" }, s => {
  console.log("server sees:", s.getProtocol());
  s.end();
});
server.listen(0, "127.0.0.1", () => {
  const c = tls.connect({ port: server.address().port, host: "127.0.0.1", rejectUnauthorized: false }, () => {
    console.log("client sees:", c.getProtocol());
  });
  c.on("error", e => { console.log("client err:", e.message); server.close(); });
  c.on("close", () => { server.close(); });
});
