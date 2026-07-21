const tls = require("node:tls");
const fs = require("node:fs");
const path = require("node:path");
const fixtures = path.join(__dirname, "..", "test", "js", "node", "test", "fixtures", "keys");
const key = fs.readFileSync(path.join(fixtures, "agent1-key.pem"));
const cert = fs.readFileSync(path.join(fixtures, "agent1-cert.pem"));
const server = tls.createServer({ key, cert }, s => {  // default versions (1.3 allowed)
  s.on("error", () => {});
  s.end();
});
server.listen(0, "127.0.0.1", () => { console.log("PORT=" + server.address().port); });
setTimeout(() => process.exit(0), 20000);
