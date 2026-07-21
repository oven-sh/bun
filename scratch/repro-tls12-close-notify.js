// Repro: does a TLS1.2 server send close_notify on every sequential connection?
// A TCP sniffer proxy sits between client and server and records, per
// connection, whether the server->client byte stream contains a TLS alert
// record (content type 21). TLS1.2 encrypts alerts but the record-header type
// byte stays visible on the wire.
const tls = require("node:tls");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

const fixtures = path.join(__dirname, "..", "test", "js", "node", "test", "fixtures", "keys");
const key = fs.readFileSync(path.join(fixtures, "agent1-key.pem"));
const cert = fs.readFileSync(path.join(fixtures, "agent1-cert.pem"));

const N = parseInt(process.argv[2] || "6", 10);

const server = tls.createServer({ key, cert, maxVersion: "TLSv1.2", minVersion: "TLSv1.2" }, s => {
  s.on("data", () => {});
  s.on("error", () => {});
  s.end("hello");
});

function parseRecords(buf) {
  const types = [];
  let off = 0;
  while (off + 5 <= buf.length) {
    const type = buf[off];
    const len = buf.readUInt16BE(off + 3);
    types.push(type);
    off += 5 + len;
  }
  return types;
}

server.listen(0, "127.0.0.1", async () => {
  const serverPort = server.address().port;
  const results = [];

  for (let i = 0; i < N; i++) {
    const r = await new Promise(outerResolve => {
      let resolved = false;
      const resolve = v => {
        if (!resolved) { resolved = true; outerResolve(v); }
      };
      const fromServer = [];
      const proxy = net.createServer(clientSock => {
        const up = net.connect(serverPort, "127.0.0.1");
        clientSock.pipe(up);
        up.on("data", d => { fromServer.push(d); clientSock.write(d); });
        up.on("end", () => clientSock.end());
        up.on("error", () => clientSock.destroy());
        clientSock.on("error", () => up.destroy());
      });
      proxy.listen(0, "127.0.0.1", () => {
        const c = tls.connect(
          { port: proxy.address().port, host: "127.0.0.1", rejectUnauthorized: false, maxVersion: "TLSv1.2" },
          () => { c.write("hi"); },
        );
        c.on("data", () => {});
        const done = () => {
          setTimeout(() => {
            proxy.close();
            const all = Buffer.concat(fromServer);
            const types = parseRecords(all);
            resolve({ conn: i + 1, types, gotCloseNotify: types.includes(21) });
          }, 150);
        };
        c.on("end", done);
        c.on("error", done);
        c.on("close", done);
        setTimeout(done, 3000);
      });
    });
    results.push(r);
    console.log(`conn ${r.conn}: close_notify=${r.gotCloseNotify} records=[${r.types.join(",")}]`);
  }
  server.close();
  const bad = results.filter(r => !r.gotCloseNotify);
  console.log(bad.length === 0 ? "ALL_OK" : `MISSING_CLOSE_NOTIFY on conns: ${bad.map(r => r.conn).join(",")}`);
  process.exit(0);
});
