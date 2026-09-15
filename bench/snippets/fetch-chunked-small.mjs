// Benchmark fetch() decoding small Transfer-Encoding: chunked bodies that
// arrive with their headers in a single read. Exercises the <=16 KiB
// dispatch in the HTTP client's chunked-body handler for both identity and
// gzip Content-Encoding.
import { bench, group, run } from "../runner.mjs";
import net from "node:net";
import zlib from "node:zlib";

function chunked(buf) {
  return Buffer.concat([
    Buffer.from(buf.length.toString(16) + "\r\n"),
    buf,
    Buffer.from("\r\n0\r\n\r\n"),
  ]);
}

function makeReply(body, gzip) {
  const payload = gzip ? zlib.gzipSync(body, { level: 6 }) : body;
  return Buffer.concat([
    Buffer.from(
      "HTTP/1.1 200 OK\r\n" +
        "Transfer-Encoding: chunked\r\n" +
        (gzip ? "Content-Encoding: gzip\r\n" : "") +
        "Connection: keep-alive\r\n" +
        "\r\n",
    ),
    chunked(payload),
  ]);
}

const sizes = [256, 4096, 15 * 1024];
const bodies = Object.fromEntries(sizes.map(n => [n, Buffer.alloc(n, "x")]));
const replies = {};
for (const n of sizes) {
  replies[`i${n}`] = makeReply(bodies[n], false);
  replies[`g${n}`] = makeReply(bodies[n], true);
}

const server = net.createServer(sock => {
  sock.setNoDelay(true);
  let pending = Buffer.alloc(0);
  sock.on("data", chunk => {
    pending = Buffer.concat([pending, chunk]);
    while (true) {
      const end = pending.indexOf("\r\n\r\n");
      if (end < 0) break;
      const head = pending.subarray(0, end).toString("latin1");
      pending = pending.subarray(end + 4);
      const m = head.match(/^GET \/(\w+)/);
      sock.write(replies[m[1]]);
    }
  });
});

await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

// Warm the keep-alive connection so the first iteration doesn't pay connect.
for (const key of Object.keys(replies)) await fetch(`${base}/${key}`).then(r => r.arrayBuffer());

for (const n of sizes) {
  group(`chunked ${n}B`, () => {
    bench("identity → arrayBuffer()", async () => {
      const r = await fetch(`${base}/i${n}`);
      await r.arrayBuffer();
    });
    bench("gzip → arrayBuffer()", async () => {
      const r = await fetch(`${base}/g${n}`);
      await r.arrayBuffer();
    });
  });
}

await run();
server.close();
process.exit(0);
