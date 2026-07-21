const tls = require("node:tls");
const fs = require("node:fs");
const path = require("node:path");
const fixtures = path.join(__dirname, "..", "test", "js", "node", "test", "fixtures", "keys");
const key = fs.readFileSync(path.join(fixtures, "agent1-key.pem"));
const cert = fs.readFileSync(path.join(fixtures, "agent1-cert.pem"));
const server = tls.createServer({ key, cert, maxVersion: "TLSv1.2", minVersion: "TLSv1.2" }, s => {
  console.log("server sees:", s.getProtocol());
  s.end();
});
server.listen(0, "127.0.0.1", () => {
  const c = tls.connect({ port: server.address().port, host: "127.0.0.1", rejectUnauthorized: false, maxVersion: "TLSv1.2" }, () => {
    console.log("client sees:", c.getProtocol());
  });
  c.on("close", () => { server.close(); });
});
