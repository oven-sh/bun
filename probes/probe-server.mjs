// A node:quic HTTP/3 server for an external client (curl). Every request gets a 103 with one `link`
// field, then a 200 and the body "hello".
// usage: <bun> probe-server.mjs [linkBytes=3000] [maxStreams=100]
// Prints {"port": n} when it listens, and {"refused": n, "requests": n} on SIGTERM.
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listen } from "node:quic";

const keysDir = join(process.env.BUN_REPO ?? "/workspace/bun", "test/js/node/test/fixtures/keys");
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));
const linkBytes = Number(process.argv[2] ?? 3000);
const maxStreams = Number(process.argv[3] ?? 100);
const link = Buffer.alloc(linkBytes, "~").toString();
const encoder = new TextEncoder();
const sent = [];

const server = await listen(
  async session => {
    session.onstream = stream => {
      stream.closed.catch(() => {});
    };
    await session.closed.catch(() => {});
  },
  {
    sni: { "*": { keys: [key], certs: [cert] } },
    transportParams: { maxIdleTimeout: 30, initialMaxStreamsBidi: maxStreams },
    onheaders() {
      sent.push(this.sendInformationalHeaders({ ":status": "103", link }), this.sendHeaders({ ":status": "200" }));
      this.writer.writeSync(encoder.encode("hello"));
      this.writer.endSync();
    },
  },
);
console.log(JSON.stringify({ port: server.address.port }));
process.on("SIGTERM", () => {
  console.log(JSON.stringify({ refused: sent.filter(taken => !taken).length, requests: sent.length / 2 }));
  process.exit(0);
});
setInterval(() => {}, 1 << 30);
