const tls = require("node:tls");
const fs = require("node:fs");
const path = require("node:path");
const fixtures = path.join(__dirname, "..", "test", "js", "node", "test", "fixtures", "keys");
const key = fs.readFileSync(path.join(fixtures, "agent1-key.pem"));
const cert = fs.readFileSync(path.join(fixtures, "agent1-cert.pem"));
let n = 0;
const server = tls.createServer({ key, cert, maxVersion: "TLSv1.2", minVersion: "TLSv1.2" }, s => {
  const id = ++n;
  console.error(`srv conn ${id}: secureConnection proto=${s.getProtocol()}`);
  s.on("error", e => console.error(`srv conn ${id}: error ${e.code || e.message}`));
  s.on("close", () => console.error(`srv conn ${id}: close`));
  s.on("end", () => console.error(`srv conn ${id}: end(peer)`));
  s.end();
  console.error(`srv conn ${id}: end() called`);
});
server.listen(0, "127.0.0.1", () => { console.log("PORT=" + server.address().port); });
setTimeout(() => process.exit(0), 25000);
