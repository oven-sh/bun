// Scratch server for the coverage-gap probe: reports what it receives on stdout.
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { listen } from "node:quic";

const keysDir = "/workspace/bun/test/js/node/test/fixtures/keys";
const key = createPrivateKey(readFileSync(keysDir + "/agent1-key.pem"));
const cert = readFileSync(keysDir + "/agent1-cert.pem");
const idle = Number(process.argv[2] ?? 30);
const echo = process.argv[3] === "echo";
const out = (o: any) => process.stdout.write(JSON.stringify(o) + "\n");

const server = await listen(
  (session: any) => {
    session.onerror = () => {};
    session.closed.then(
      () => out({ closed: true }),
      () => out({ closed: true }),
    );
    session.onstream = async (stream: any) => {
      stream.closed.catch(() => {});
      let n = 0;
      try {
        for await (const batch of stream)
          for (const chunk of [batch].flat()) {
            n += chunk.byteLength;
            out({ stream: n });
            if (echo) stream.writer.writeSync(chunk);
          }
      } catch {}
      out({ streamEnd: n });
    };
  },
  {
    sni: { "*": { keys: [key], certs: [cert] } },
    alpn: ["quic-test"],
    transportParams: { maxIdleTimeout: idle },
    ondatagram(d: Uint8Array) {
      out({ dg: d[0] });
    },
  },
);
out({ port: server.address.port });
process.stdin.on("data", () => {});
process.stdin.on("end", () => process.exit(0));
