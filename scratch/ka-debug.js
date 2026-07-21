const tls = require("node:tls");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
tls.DEFAULT_MAX_VERSION = "TLSv1.2";
const fixtures = path.join(__dirname, "..", "test", "js", "node", "test", "fixtures", "keys");
const key = fs.readFileSync(path.join(fixtures, "agent1-key.pem"));
const cert = fs.readFileSync(path.join(fixtures, "agent1-cert.pem"));

const server = tls.createServer({ key, cert }, conn => {
  console.log("S: secureConnection");
  conn.write("hello", err => console.log("S: write cb", err ? String(err) : "ok"));
  conn.on("data", d => console.log("S: data", String(d)));
  conn.on("end", () => console.log("S: end"));
  conn.on("error", e => console.log("S: error", e.code));
  conn.on("close", () => { console.log("S: close"); });
  conn.end();
  console.log("S: end() called");
}).listen(0, () => {
  const netSocket = new net.Socket({ allowHalfOpen: true });
  const socket = tls.connect({ socket: netSocket, rejectUnauthorized: false });
  const { port, address } = server.address();
  netSocket.connect({ port, address });
  socket.on("secureConnect", () => console.log("C: secureConnect"));
  socket.on("end", () => console.log("C: end"));
  socket.on("data", d => console.log("C: data", String(d)));
  socket.on("error", e => console.log("C: error", e.code));
  socket.on("close", () => { console.log("C: close"); server.close(); });
  socket.write("hello");
  socket.end();
});
setTimeout(() => { console.log("TIMEOUT"); process.exit(2); }, 8000);
