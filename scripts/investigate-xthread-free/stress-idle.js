// Burst + idle stress: mimics interactive tool-use session.
// Burst of fetch/spawn/crypto, then 11s idle (triggers ThreadPool
// mimalloc_cleanup), then Bun.gc, repeat.

const crypto = require("node:crypto");

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const t = await req.text();
    await Bun.sleep(Math.random() * 3);
    return new Response("x".repeat(128 + (t.length & 0xff)));
  },
});
const url = `http://localhost:${server.port}/`;
console.error("idle server on", server.port);

async function burst() {
  const b = [];
  for (let i = 0; i < 40; i++) {
    const sig = AbortSignal.timeout(1 + Math.floor(Math.random() * 30));
    b.push(fetch(url, { method: "POST", body: "x".repeat(1024), signal: sig })
      .then(r => r.text()).catch(() => {}));
  }
  for (let i = 0; i < 8; i++) {
    b.push(new Promise(r => crypto.pbkdf2("p", "s", 5, 32, "sha256", () => r())));
  }
  b.push(
    Bun.spawn({
      cmd: [process.execPath, "-e", "process.stdout.write('x'.repeat(256))"],
      stdout: "pipe", stderr: "ignore",
    }).stdout.text().catch(() => {})
  );
  await Promise.allSettled(b);
}

const DURATION = parseInt(process.env.DURATION || "600000", 10);
const IDLE = parseInt(process.env.IDLE || "11000", 10);
let iter = 0;
const start = Date.now();
(async () => {
  while (Date.now() - start < DURATION) {
    await burst();
    await burst();
    Bun.gc(true);
    // Idle: ThreadPool workers will timeout after 10s and run mimalloc_cleanup
    await Bun.sleep(IDLE);
    Bun.gc(true);
    iter++;
    console.error(`cycle=${iter} rss=${(process.memoryUsage().rss/1024/1024).toFixed(1)}MB`);
  }
  server.stop(true);
  console.log("OK", iter);
})();
