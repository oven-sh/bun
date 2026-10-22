// The cost of HeapProfiler.startSampling (node:inspector) on allocation-heavy loops. Runs on bun and node.
import { Session } from "node:inspector";
import { bench, group, run } from "../runner.mjs";

let keep;
function objects(n) {
  const values = new Array(1000);
  for (let i = 0; i < n; ++i) values[i % 1000] = { index: i, a: i + 1, b: i + 2 };
  keep = values;
}
function arrays(n) {
  const values = new Array(1000);
  for (let i = 0; i < n; ++i) values[i % 1000] = [i, i + 1, i + 2, i + 3];
  keep = values;
}
function strings(n) {
  const values = new Array(1000);
  for (let i = 0; i < n; ++i) values[i % 1000] = (i + "").repeat(4);
  keep = values;
}
const document = JSON.stringify(
  Array.from({ length: 2000 }, (_, i) => ({ id: i, name: "item" + i, tags: ["a", "b", "c"], nested: { x: i, y: String(i) } })),
);
function json(n) {
  for (let i = 0; i < n; ++i) keep = JSON.parse(document);
}

// One process per mode, so the timed loops hold no sampler lifecycle work (and no forced collection):
//   bun heap-profiler-sampling.mjs                                sampling off
//   HEAP_SAMPLING_INTERVAL=32768 bun heap-profiler-sampling.mjs   the default interval
//   HEAP_SAMPLING_INTERVAL=1024 bun heap-profiler-sampling.mjs
const interval = Number(process.env.HEAP_SAMPLING_INTERVAL ?? 0);
const session = new Session();
session.connect();
if (interval > 0) session.post("HeapProfiler.startSampling", { samplingInterval: interval });
const mode = interval > 0 ? `sampling at ${interval}` : "sampling off";

for (const [name, fn, count] of [
  ["objects", objects, 200_000],
  ["arrays", arrays, 200_000],
  ["strings", strings, 200_000],
  ["JSON.parse", json, 20],
]) {
  group(name, () => {
    bench(mode, () => fn(count));
  });
}

await run();
if (interval > 0) session.post("HeapProfiler.stopSampling");
