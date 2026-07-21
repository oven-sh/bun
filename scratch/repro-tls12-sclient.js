// TLS1.2 server under test; N sequential `openssl s_client` connections.
// For each: did the server send close_notify? s_client -msg prints
// "<<< TLS 1.2 [...] Alert" on receipt; exit code 0 = clean shutdown.
const tls = require("node:tls");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const fixtures = path.join(__dirname, "..", "test", "js", "node", "test", "fixtures", "keys");
const key = fs.readFileSync(path.join(fixtures, "agent1-key.pem"));
const cert = fs.readFileSync(path.join(fixtures, "agent1-cert.pem"));
const certPath = path.join(fixtures, "agent1-cert.pem");

const N = parseInt(process.argv[2] || "5", 10);
const useTicketFile = process.argv[3] === "sess"; // reuse session like the real test

const server = tls.createServer({ key, cert, maxVersion: "TLSv1.2", minVersion: "TLSv1.2" }, s => {
  s.on("error", () => {});
  s.end();
});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  const sessFile = path.join(__dirname, "sess-ticket.txt");
  try { fs.unlinkSync(sessFile); } catch {}
  let bad = [];
  for (let i = 1; i <= N; i++) {
    const flags = ["s_client", "-connect", `127.0.0.1:${port}`, "-CAfile", certPath, "-msg", "-tls1_2"];
    if (useTicketFile) {
      if (fs.existsSync(sessFile)) flags.push("-sess_in", sessFile);
      flags.push("-sess_out", sessFile);
    }
    const r = spawnSync("openssl", flags, { input: "", timeout: 8000, encoding: "utf8" });
    const gotAlert = /<<<.*Alert/.test(r.stdout + r.stderr);
    const reused = /Reused,/.test(r.stdout);
    console.log(`conn ${i}: exit=${r.status} close_notify_alert_received=${gotAlert} reused=${reused}`);
    if (!gotAlert || r.status !== 0) bad.push(i);
  }
  console.log(bad.length ? `BAD conns: ${bad.join(",")}` : "ALL_OK");
  server.close();
  process.exit(0);
});
