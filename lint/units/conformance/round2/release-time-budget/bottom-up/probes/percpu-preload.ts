// A preload for `bun test`: per test, the wall time, the CPU time of the main thread, its wait for a CPU, and the CPU time of the whole process.
// Writes PERCPU_OUT (JSON) at exit. What runs before the first test (the imports and the bodies of describe) is the entry "(before the first test)".
import { afterEach, beforeAll, beforeEach, expect } from "bun:test";
import { writeFileSync } from "node:fs";
import { delta, sample, type Sample } from "./meter.ts";
const start = sample();
const open = new Map<string, Sample>();
const rows: any[] = [];
let first = true;
beforeAll(() => {
  if (!first) return;
  first = false;
  rows.push({ name: "(before the first test)", ...delta(start, sample()) });
});
beforeEach(() => {
  open.set(expect.getState().currentTestName ?? "?", sample());
});
afterEach(() => {
  const name = expect.getState().currentTestName ?? "?";
  const s = open.get(name);
  if (s !== undefined) rows.push({ name, ...delta(s, sample()) });
});
process.on("exit", () => {
  rows.push({ name: "(whole process)", ...delta(start, sample()) });
  writeFileSync(process.env.PERCPU_OUT ?? "/tmp/rtb1a/out/percpu.json", JSON.stringify(rows, null, 1));
});
