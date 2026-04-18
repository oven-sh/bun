// SSE streaming stress — closer to Claude Code's actual pattern:
// POST with body → streaming response → AbortSignal.timeout

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    await req.text(); // consume body
    const stream = new ReadableStream({
      async start(c) {
        for (let i = 0; i < 8; i++) {
          c.enqueue(new TextEncoder().encode(`data: chunk${i}\n\n`));
          await Bun.sleep(Math.random() * 3);
        }
        c.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
  },
});

const url = `http://localhost:${server.port}/`;
console.error("sse server on", server.port);

const DURATION = parseInt(process.env.DURATION || "120000", 10);
let iter = 0;

async function doSSE(timeoutMs) {
  const sig = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      body: JSON.stringify({ messages: Array(20).fill({ role: "user", content: "x".repeat(100) }) }),
      signal: sig,
      headers: { "Content-Type": "application/json" },
    });
    const reader = res.body.getReader();
    while (1) {
      const { done, value } = await reader.read();
      if (done) break;
    }
  } catch {}
}

async function doSSEAbort() {
  const ctrl = new AbortController();
  const sig = AbortSignal.any([ctrl.signal, AbortSignal.timeout(1000)]);
  const p = (async () => {
    try {
      const res = await fetch(url, {
        method: "POST",
        body: "x".repeat(512),
        signal: sig,
      });
      const reader = res.body.getReader();
      while (1) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {}
  })();
  await Bun.sleep(Math.random() * 15);
  ctrl.abort();
  await p;
}

const crypto = require("node:crypto");
async function doCrypto() {
  return new Promise((r) => crypto.pbkdf2("p", "s", 5, 32, "sha256", () => r()));
}

const start = Date.now();
(async () => {
  while (Date.now() - start < DURATION) {
    const batch = [];
    for (let i = 0; i < 10; i++) {
      batch.push(doSSE(5 + Math.floor(Math.random() * 50)));
      batch.push(doSSEAbort());
    }
    for (let i = 0; i < 3; i++) batch.push(doCrypto());
    await Promise.allSettled(batch);
    iter++;
    if (iter % 3 === 0) Bun.gc(true);
    if (iter % 100 === 0)
      console.error(`iter=${iter} rss=${(process.memoryUsage().rss/1024/1024).toFixed(1)}MB`);
  }
  server.stop(true);
  console.log("OK", iter);
})();
