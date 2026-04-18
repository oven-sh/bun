// node:http2 + AbortSignal stress
// h2_frame_parser.zig uses signal.detach() which calls cleanNativeBindings + unref

const http2 = require("node:http2");

const server = http2.createServer();
server.on("stream", (stream, headers) => {
  stream.respond({ ":status": 200, "content-type": "text/plain" });
  let i = 0;
  const iv = setInterval(() => {
    if (i++ > 5 || stream.destroyed) {
      clearInterval(iv);
      try { stream.end("done"); } catch {}
      return;
    }
    try { stream.write(`chunk${i}\n`); } catch {}
  }, 2);
});

server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  console.error("h2 server on", port);

  const DURATION = parseInt(process.env.DURATION || "120000", 10);
  let iter = 0;

  async function doH2Request(abortAfterMs) {
    return new Promise((resolve) => {
      const client = http2.connect(`http://127.0.0.1:${port}`);
      client.on("error", () => {});
      const sig = AbortSignal.timeout(abortAfterMs);
      const req = client.request({ ":path": "/" }, { signal: sig });
      req.on("error", () => {});
      req.on("data", () => {});
      req.on("end", () => { try { client.close(); } catch {} resolve(); });
      req.on("close", () => { try { client.close(); } catch {} resolve(); });
      setTimeout(() => { try { client.close(); } catch {} resolve(); }, 100);
    });
  }

  const start = Date.now();
  while (Date.now() - start < DURATION) {
    const batch = [];
    for (let i = 0; i < 10; i++) {
      batch.push(doH2Request(1 + Math.floor(Math.random() * 30)));
    }
    await Promise.allSettled(batch);
    iter++;
    if (iter % 3 === 0) Bun.gc(true);
    if (iter % 100 === 0)
      console.error(`iter=${iter} rss=${(process.memoryUsage().rss/1024/1024).toFixed(1)}MB`);
  }

  server.close();
  console.log("OK", iter);
});
