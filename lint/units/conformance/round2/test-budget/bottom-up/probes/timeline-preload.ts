// A preload for `bun test`: the time of every start and end of a test since the preload was read, the on-CPU time of the main thread and its wait for a CPU at each, written to TIMELINE_OUT at the end.
import { afterAll, afterEach, beforeAll, beforeEach } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
const events: [string, number, number, number][] = [];
const mark = (kind: string) => {
  const [on, rq] = readFileSync("/proc/thread-self/schedstat", "latin1").trim().split(" ").map(Number);
  events.push([kind, performance.now(), on / 1e6, rq / 1e6]);
};
mark("preload");
let first = true;
beforeAll(() => {
  if (first) mark("first-beforeAll");
  first = false;
});
beforeEach(() => mark("B"));
afterEach(() => mark("E"));
afterAll(() => {
  mark("afterAll");
  writeFileSync(process.env.TIMELINE_OUT ?? "/tmp/test-budget-1a/out/timeline.json", JSON.stringify({ timeOrigin: performance.timeOrigin, events }));
});
