// Simulates an "allocate burst → drop → idle" workload (e.g. LLM response
// handling) to compare RSS between Bun's default GC scheduling and JSC's
// opportunistic GC enabled via BUN_GC_OPPORTUNISTIC_DEADLINE_MS.
//
// Usage:
//   bun bd bench/gc/opportunistic-idle.mjs                           # baseline
//   BUN_GC_OPPORTUNISTIC_DEADLINE_MS=5 bun bd bench/gc/opportunistic-idle.mjs

const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 10);
const IDLE_MS = Number(process.env.BENCH_IDLE_MS ?? 1500);
const BURST_STRINGS = Number(process.env.BENCH_BURST_STRINGS ?? 200_000);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rssMB = () => (process.memoryUsage.rss() / 1024 / 1024).toFixed(1);
const heapMB = () => (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

const label =
  process.env.BUN_GC_OPPORTUNISTIC_DEADLINE_MS != null
    ? `opportunistic(${process.env.BUN_GC_OPPORTUNISTIC_DEADLINE_MS}ms)`
    : "baseline";

console.log(`mode=${label} iterations=${ITERATIONS} idle=${IDLE_MS}ms burst=${BURST_STRINGS}`);
console.log(`start: rss=${rssMB()}MB heap=${heapMB()}MB`);

let sink = 0;
const samples = [];

for (let i = 0; i < ITERATIONS; i++) {
  // Burst: allocate a large amount of short-lived garbage.
  let arr = [];
  for (let j = 0; j < BURST_STRINGS; j++) {
    arr.push({ id: j, text: "x".repeat(64) + j, nested: { a: j * 2, b: [j, j + 1, j + 2] } });
  }
  sink += arr.length;
  arr = null;

  // Idle: simulate waiting for user input / next request. The GC controller's
  // repeating timer (default 1s) and opportunistic tasks should run here.
  await sleep(IDLE_MS);

  const rss = process.memoryUsage.rss();
  samples.push(rss);
  console.log(`iter=${i} rss=${rssMB()}MB heap=${heapMB()}MB`);
}

const avg = samples.reduce((a, b) => a + b, 0) / samples.length / 1024 / 1024;
const max = Math.max(...samples) / 1024 / 1024;
console.log(`--- ${label} ---`);
console.log(`avg_rss=${avg.toFixed(1)}MB max_rss=${max.toFixed(1)}MB sink=${sink}`);
