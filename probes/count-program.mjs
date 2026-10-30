// The program for count-instructions.py: a node:quic HTTP/3 server answers each request with one
// small header block and ends the stream. The client sends <requests> requests, one after the other.
// Every sendHeaders() here is on the path that lsquic accepts at once.
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen, QuicEndpoint } from "node:quic";

const keysDir = join(process.env.BUN_REPO ?? "/workspace/bun", "test/js/node/test/fixtures/keys");
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));
const requests = Number(process.argv[2] ?? 4);
// With a body, each response also runs the body loop of the stream's write event.
const body = process.argv[3] ? new TextEncoder().encode(process.argv[3]) : null;
const transportParams = { maxIdleTimeout: 600 };

const server = await listen(
  async session => {
    session.onstream = stream => {
      stream.closed.catch(() => {});
    };
    await session.closed.catch(() => {});
  },
  {
    sni: { "*": { keys: [key], certs: [cert] } },
    transportParams,
    onheaders() {
      this.sendHeaders({ ":status": "200", "content-type": "text/plain" });
      if (body) this.writer.writeSync(body);
      this.writer.endSync();
    },
  },
);
const endpoint = new QuicEndpoint();
const client = await connect(server.address, {
  endpoint,
  servername: "localhost",
  verifyPeer: "manual",
  transportParams,
  onerror() {},
});
client.closed.catch(() => {});
await client.opened;
const statuses = [];
for (let i = 0; i < requests; i++) {
  const got = Promise.withResolvers();
  const stream = await client.createBidirectionalStream({
    headers: { ":method": "GET", ":path": "/" + i, ":scheme": "https", ":authority": "localhost" },
    onheaders: headers => got.resolve(headers[":status"]),
  });
  stream.closed.catch(() => {});
  statuses.push(await got.promise);
  for await (const _ of stream);
}
console.log(JSON.stringify({ statuses }));
process.exit(0);
