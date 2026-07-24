#!/usr/bin/env bun
// Simple HTTP load generator. Usage: loadgen.ts <port> <duration_s> <concurrency>
const port = parseInt(process.argv[2], 10);
const durS = parseFloat(process.argv[3] ?? "15");
const conc = parseInt(process.argv[4] ?? "64", 10);
const base = `http://127.0.0.1:${port}`;

let done = 0, errs = 0, bytes = 0;
const deadline = performance.now() + durS * 1000;

async function worker(seed: number) {
  let i = seed;
  while (performance.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/${i % 100000}?k=v&n=${i}`);
      const b = await r.arrayBuffer();
      bytes += b.byteLength;
      done++;
    } catch { errs++; }
    i += conc;
  }
}

const t0 = performance.now();
await Promise.all(Array.from({ length: conc }, (_, k) => worker(k)));
const dt = (performance.now() - t0) / 1000;
console.error(JSON.stringify({ reqs: done, errs, rps: Math.round(done / dt), mb: Math.round(bytes / 1048576) }));
