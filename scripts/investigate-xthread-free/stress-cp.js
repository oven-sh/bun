// node:child_process + AbortSignal + fetch — the actual Claude Code pattern

const cp = require("node:child_process");
const crypto = require("node:crypto");

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    await Bun.sleep(Math.random() * 3);
    return new Response("x".repeat(256));
  },
});
const url = `http://localhost:${server.port}/`;
console.error("cp server on", server.port);

async function doSpawn(withSignal) {
  return new Promise((resolve) => {
    const opts = {};
    if (withSignal) opts.signal = AbortSignal.timeout(1 + Math.floor(Math.random() * 50));
    const child = cp.spawn(process.execPath, ["-e", "process.stdout.write('x'.repeat(512))"], opts);
    let out = "";
    child.stdout.on("data", d => { out += d; });
    child.on("error", () => resolve());
    child.on("close", () => resolve());
  });
}

async function doExec() {
  return new Promise((resolve) => {
    cp.exec(`${process.execPath} -e "process.stdout.write('y'.repeat(256))"`, { timeout: 2000 }, (err, stdout) => {
      resolve();
    });
  });
}

async function doFetch() {
  const sig = AbortSignal.timeout(1 + Math.floor(Math.random() * 30));
  try {
    const r = await fetch(url, { signal: sig });
    await r.text();
  } catch {}
}

const DURATION = parseInt(process.env.DURATION || "300000", 10);
let iter = 0;
const start = Date.now();
(async () => {
  while (Date.now() - start < DURATION) {
    const batch = [];
    for (let i = 0; i < 10; i++) batch.push(doFetch());
    batch.push(doSpawn(true));
    batch.push(doSpawn(false));
    batch.push(doExec());
    batch.push(new Promise(r => crypto.pbkdf2("p", "s", 5, 32, "sha256", () => r())));
    await Promise.allSettled(batch);
    iter++;
    if (iter % 3 === 0) Bun.gc(true);
    if (iter % 50 === 0)
      console.error(`iter=${iter} rss=${(process.memoryUsage().rss/1024/1024).toFixed(1)}MB`);
  }
  server.stop(true);
  console.log("OK", iter);
})();
