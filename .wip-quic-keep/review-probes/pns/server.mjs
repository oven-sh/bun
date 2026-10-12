// Server half of the review probe: its own process, so the lsquic log of the client process holds only client connections.
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { listen } from "node:quic";
const keys = "/workspace/bun/test/js/node/test/fixtures/keys/";
const key = createPrivateKey(readFileSync(keys + "agent1-key.pem"));
const cert = readFileSync(keys + "agent1-cert.pem");
const out = line => process.stdout.write(line + "\n");
const server = await listen(
  session => {
    session.onerror = () => {};
    session.closed.catch(() => {});
    session.onstream = async stream => {
      stream.closed.catch(() => {});
      try {
        for await (const batch of stream) for (const chunk of [batch].flat()) out(`STREAM ${Date.now()} ${chunk.byteLength}`);
      } catch {}
    };
  },
  {
    sni: { "*": { keys: [key], certs: [cert] } },
    alpn: ["quic-test"],
    transportParams: { maxIdleTimeout: 30 },
    ondatagram(datagram, early) {
      out(`DG ${Date.now()} ${datagram[0]} ${early ? "early" : "1rtt"}`);
    },
  },
);
out(`PORT ${server.address.port}`);
process.stdin.on("data", () => {});
process.stdin.on("end", () => process.exit(0));
