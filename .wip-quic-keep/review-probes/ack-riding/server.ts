// Scratch probe (round 5): the server half, in its own process so that the
// lsquic debug log of the client process holds the client's connection only.
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listen } from "node:quic";

const keysDir = "/workspace/bun/test/js/node/test/fixtures/keys";
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));
const sni = { "*": { keys: [key], certs: [cert] } };
const abs = () => performance.timeOrigin + performance.now();
const DGRAM_MS = Number(process.env.SERVER_DGRAM_MS ?? 20);
const DOWNLOAD = Number(process.env.DOWNLOAD ?? 0); // bytes per chunk the server pushes on the stream, forever
const PUMP_MS = Number(process.env.PUMP_MS ?? 2);
const PUMP_N = Number(process.env.PUMP_N ?? 64);
const out = (o: any) => process.stdout.write(JSON.stringify(o) + "\n");

const server = await listen(
  (session: any) => {
    session.onerror = () => {};
    session.onstream = async (stream: any) => {
      stream.closed.catch(() => {});
      if (DOWNLOAD > 0) {
        // A download: the first chunk from the client starts it.
        const chunk = new Uint8Array(DOWNLOAD);
        let sent = 0;
        const pump = () => {
          try {
            // writeSync returns false when the stream buffer is full.
            for (let i = 0; i < PUMP_N; i++) {
              if (stream.writer.desiredSize !== null && stream.writer.desiredSize <= 0) break;
              if (!stream.writer.writeSync(chunk)) break;
              sent += chunk.byteLength;
            }
          } catch {}
        };
        let t: any = null;
        const start = () => {
          if (t === null) {
            out({ ev: "pump", t: abs() });
            t = setInterval(pump, PUMP_MS);
          }
        };
        if (process.env.TRIGGER === "stdin") {
          (async () => {
            for await (const chunk of Bun.stdin.stream()) {
              if (new TextDecoder().decode(chunk).includes("go")) start();
            }
          })();
        } else start();
        stream.closed.finally(() => t !== null && clearInterval(t));
        try {
          for await (const _ of stream) {
          }
        } catch {}
        return;
      }
      try {
        for await (const batch of stream)
          for (const chunk of [batch].flat()) {
            out({ ev: "stream", n: chunk.byteLength, t: abs() });
            stream.writer.writeSync(chunk);
          }
      } catch {}
    };
    if (DGRAM_MS > 0)
      setInterval(() => {
        try {
          session.sendDatagram(new Uint8Array(200));
        } catch {}
      }, DGRAM_MS);
  },
  {
    sni,
    alpn: ["quic-test"],
    transportParams: { maxIdleTimeout: 30 },
    ondatagram(d: Uint8Array) {
      out({ ev: "dg", id: d[0] | (d[1] << 8), t: abs() });
    },
  },
);
out({ ev: "listening", port: server.address.port });
