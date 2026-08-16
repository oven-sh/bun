// Measures retained memory of Promise-heavy workloads (not a mitata benchmark).
// Run directly: `bun bench/snippets/promise-memory.mjs`
import { heapStats } from "bun:jsc";

function gc() {
  Bun.gc(true);
}

function snapshot() {
  gc();
  return {
    rss: process.memoryUsage().rss,
    heapSize: heapStats().heapSize,
    objectCount: heapStats().objectCount,
  };
}

function fmtMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

function measure(label, count, fn) {
  const before = snapshot();
  const retained = fn(count);
  const after = snapshot();
  const heapDelta = after.heapSize - before.heapSize;
  const rssDelta = after.rss - before.rss;
  console.log(
    `${label.padEnd(48)} heap +${fmtMB(heapDelta)} (${(heapDelta / count).toFixed(1)} bytes/item)  rss +${fmtMB(rssDelta)}`,
  );
  return retained;
}

const COUNT = parseInt(process.env.PROMISE_MEMORY_COUNT || "1000000", 10);
console.log(`Bun ${Bun.version} — ${COUNT.toLocaleString()} items per workload\n`);

const keep = [];

keep.push(
  measure("pending Promise (no handler)", COUNT, n => {
    const arr = new Array(n);
    for (let i = 0; i < n; i++) arr[i] = new Promise(() => {});
    return arr;
  }),
);

keep.push(
  measure("pending Promise + one .then(handler)", COUNT, n => {
    const arr = new Array(n);
    const handler = v => v;
    for (let i = 0; i < n; i++) {
      const p = new Promise(() => {});
      p.then(handler);
      // retaining the base promise keeps its reaction + derived promise alive
      arr[i] = p;
    }
    return arr;
  }),
);

keep.push(
  measure("pending Promise + .then(onFulfilled, onRejected)", COUNT, n => {
    const arr = new Array(n);
    const onFulfilled = v => v;
    const onRejected = e => e;
    for (let i = 0; i < n; i++) {
      const p = new Promise(() => {});
      p.then(onFulfilled, onRejected);
      arr[i] = p;
    }
    return arr;
  }),
);

// kept alive at module scope so every suspended async function frame stays reachable
const neverSettled = new Promise(() => {});

keep.push(
  measure("async function suspended at single await", Math.floor(COUNT / 2), n => {
    async function suspend() {
      await neverSettled;
    }
    const arr = new Array(n);
    for (let i = 0; i < n; i++) arr[i] = suspend();
    return arr;
  }),
);

keep.push(
  measure("resolved Promise retained", COUNT, n => {
    const arr = new Array(n);
    for (let i = 0; i < n; i++) arr[i] = Promise.resolve(i);
    return arr;
  }),
);

// keep references alive so the GC cannot reclaim the workloads early
if (keep.length === 0) console.log("unreachable");
