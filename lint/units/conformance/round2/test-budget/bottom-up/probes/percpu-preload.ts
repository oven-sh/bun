// A preload for `bun test`: per test in the order in which the tests end, the wall time, the CPU time of the main thread, its wait for a CPU, and the CPU time of the whole process.
// Writes PERCPU_OUT (JSON) at exit. What runs before the first test (the imports and the bodies of describe) is the row "(before the first test)".
// The rows have no names: percpu-show.ts takes them from the lines "(pass)" of the runner's output, which are in the same order for tests that run one after the other.
import { afterAll, afterEach, beforeAll, beforeEach } from "bun:test";
import { writeFileSync } from "node:fs";
import { delta, sample, type Sample } from "./meter.ts";
const start = sample();
const open: Sample[] = [];
const rows: any[] = [];
let first = true;
beforeAll(() => {
  if (!first) return;
  first = false;
  rows.push({ name: "(before the first test)", ...delta(start, sample()) });
});
beforeEach(() => {
  open.push(sample());
});
afterEach(() => {
  const s = open.pop();
  if (s !== undefined) rows.push({ name: "", ...delta(s, sample()) });
});
afterAll(() => {
  const all = [...rows, { name: "(whole process, up to the end of the tests)", ...delta(start, sample()) }];
  writeFileSync(process.env.PERCPU_OUT ?? "/tmp/test-budget-1a/out/percpu.json", JSON.stringify(all, null, 1));
});
