// Full-fingerprint stress: fetch+AbortSignal.timeout, spawn, yaml, Bun.gc
// plus node:crypto (WorkPool via ConcurrentCppTask), stdin/out/err
// Tries to reproduce xthread_free corruption.

const { aborted } = require("util");
const crypto = require("node:crypto");

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    await Bun.sleep(Math.random() * 2);
    return new Response("x".repeat(128 + Math.floor(Math.random() * 512)));
  },
});

const url = `http://localhost:${server.port}/`;
console.error("server on", server.port);

let iter = 0;
const DURATION = parseInt(process.env.DURATION || "120000", 10);

function yaml() {
  Bun.YAML.parse("foo: bar\nbaz:\n  - 1\n  - 2\n  - abcdefghij\nmeta:\n  k: v\n  n: 42\n");
}

async function doFetch(timeoutMs) {
  const sig = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetch(url, { signal: sig });
    await res.text();
  } catch {}
}

async function doFetchAny(timeoutMs) {
  const ctrl = new AbortController();
  const tsig = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([ctrl.signal, tsig]);
  try {
    const res = await fetch(url, { signal });
    await res.text();
  } catch {}
  if (Math.random() < 0.5) ctrl.abort();
}

async function doFetchAddRemove() {
  const sig = AbortSignal.timeout(1_000_000);
  function l() {}
  sig.addEventListener("abort", l);
  aborted(sig, {});
  try {
    const res = await fetch(url, { signal: sig });
    await res.text();
  } catch {}
  sig.removeEventListener("abort", l);
}

async function doSpawn(withTimeout) {
  const opts = {
    cmd: [process.execPath, "-e", "process.stdout.write('x'.repeat(256))"],
    stdout: "pipe",
    stderr: "ignore",
  };
  if (withTimeout) opts.signal = AbortSignal.timeout(1 + Math.floor(Math.random() * 100));
  try {
    const proc = Bun.spawn(opts);
    await proc.stdout.text();
    await proc.exited;
  } catch {}
}

async function doCrypto() {
  return new Promise((res) => {
    crypto.pbkdf2("pass", "salt", 10, 32, "sha256", () => res());
  });
}

const start = Date.now();
(async () => {
  while (Date.now() - start < DURATION) {
    const batch = [];
    for (let i = 0; i < 15; i++) {
      const t = 1 + Math.floor(Math.random() * 50);
      batch.push(doFetch(t));
      batch.push(doFetchAny(t));
      batch.push(doFetchAddRemove());
    }
    for (let i = 0; i < 4; i++) batch.push(doCrypto());
    batch.push(doSpawn(true));
    batch.push(doSpawn(false));
    yaml(); yaml(); yaml();
    Bun.stdout; Bun.stderr; Bun.stdin;

    await Promise.allSettled(batch);
    iter++;
    if (iter % 3 === 0) Bun.gc(true);
    if (iter % 200 === 0)
      console.error(`iter=${iter} rss=${(process.memoryUsage().rss/1024/1024).toFixed(1)}MB`);
  }
  server.stop(true);
  console.log("OK", iter);
})();
