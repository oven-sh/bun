// The cost of HeapProfiler.startSampling (node:inspector): allocation-heavy loops with sampling off, and on at the
// default 32 KiB interval and at 1 KiB. Runs on bun and node. Compare two bun builds with BUN=path/to/bun.
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

const session = new Session();
session.connect();

for (const [name, fn, count] of [
  ["objects", objects, 200_000],
  ["arrays", arrays, 200_000],
  ["strings", strings, 200_000],
  ["JSON.parse", json, 20],
]) {
  group(name, () => {
    bench("sampling off", () => fn(count));
    for (const samplingInterval of [32768, 1024]) {
      bench(`sampling at ${samplingInterval}`, () => {
        session.post("HeapProfiler.startSampling", { samplingInterval });
        fn(count);
        session.post("HeapProfiler.stopSampling");
      });
    }
  });
}

await run();
