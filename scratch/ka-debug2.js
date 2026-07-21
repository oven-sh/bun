const tls = require("node:tls");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
tls.DEFAULT_MAX_VERSION = "TLSv1.2";
const fixtures = path.join(__dirname, "..", "test", "js", "node", "test", "fixtures", "keys");
const key = fs.readFileSync(path.join(fixtures, "agent1-key.pem"));
const cert = fs.readFileSync(path.join(fixtures, "agent1-cert.pem"));

const server = tls.createServer({ key, cert }, conn => {
  conn.on("data", d => console.log("S: data", JSON.stringify(String(d))));
  conn.on("end", () => console.log("S: end"));
  conn.on("error", e => console.log("S: error", e.code));
  conn.on("close", () => console.log("S: close"));
  conn.end();
}).listen(0, () => {
  const netSocket = new net.Socket({ allowHalfOpen: true });
  const ow = netSocket.write.bind(netSocket);
  netSocket.write = (chunk, ...a) => {
    const r = ow(chunk, ...a);
    console.log(`NS: write len=${chunk.length} ret=${r} wl=${netSocket.writableLength}`);
    return r;
  };
  const oe = netSocket.end.bind(netSocket);
  netSocket.end = (...a) => { console.log("NS: end() called, wl=" + netSocket.writableLength); return oe(...a); };
  netSocket.on("end", () => console.log("NS: end(peer FIN)"));
  netSocket.on("finish", () => console.log("NS: finish"));
  netSocket.on("drain", () => console.log("NS: drain"));
  netSocket.on("error", e => console.log("NS: error", e.code));
  netSocket.on("close", () => console.log("NS: close"));
  netSocket.on("connect", () => console.log("NS: connect"));

  const socket = tls.connect({ socket: netSocket, rejectUnauthorized: false });
  const { port, address } = server.address();
  netSocket.connect({ port, address });
  socket.on("secureConnect", () => console.log("C: secureConnect"));
  socket.on("end", () => console.log("C: end"));
  socket.on("data", d => console.log("C: data", JSON.stringify(String(d))));
  socket.on("error", e => console.log("C: error", e.code));
  socket.on("close", () => { console.log("C: close"); server.close(); });
  socket.write("hello");
  socket.end();
});
setTimeout(() => { console.log("TIMEOUT"); process.exit(2); }, 6000);
