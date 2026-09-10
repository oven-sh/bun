// HTTP/3 echo server used by both the client and server benchmarks.
//
// node:quic is the same API on both runtimes, so this file runs unmodified on
// bun and on a node built with --experimental-quic. Prints a READY line with
// the port it bound, then answers every request with 200 + a fixed body.
//
//   node --experimental-quic --no-warnings server.mjs
//   bun server.mjs
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listen } from "node:quic";

const here = new URL(".", import.meta.url).pathname;
const key = createPrivateKey(readFileSync(join(here, "key.pem")));
const cert = readFileSync(join(here, "cert.pem"));

const bodySize = Number(process.env.BODY_SIZE ?? 0);
const body = new TextEncoder().encode("x".repeat(bodySize));

const endpoint = await listen(
  session => {
    // Streams settle themselves; just don't let a peer reset reject anything.
    session.onstream = stream => stream.closed.catch(() => {});
    session.closed.catch(() => {});
  },
  {
    sni: { "*": { keys: [key], certs: [cert] } },
    transportParams: { maxIdleTimeout: 30 },
    // Applied to incoming streams before onstream fires; `this` is the stream.
    onheaders: function () {
      this.sendHeaders({ ":status": "200" });
      if (bodySize > 0) this.writer.writeSync(body);
      this.writer.endSync();
    },
  },
);

console.log(`READY ${endpoint.address.port}`);
