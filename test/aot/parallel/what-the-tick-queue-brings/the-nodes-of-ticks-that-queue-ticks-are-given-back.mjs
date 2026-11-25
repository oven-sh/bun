// 100,000 ticks queue one more tick each. Once they have run the queue keeps a few thousand free nodes and gives the others back.
import { heapStats } from "bun:jsc";
const turns = async count => {
  for (let turn = 0; turn < count; turn++) await new Promise(resolve => setImmediate(resolve));
};
const countObjects = () => {
  Bun.gc(true);
  Bun.gc(true);
  return heapStats().objectCount;
};
const nothing = () => {};
await turns(3);
const before = countObjects();
const burst = 100_000;
for (let tick = 0; tick < burst; tick++) process.nextTick(() => process.nextTick(nothing));
await turns(20);
const kept = countObjects() - before;
console.log(kept < burst / 4 ? "given back" : `kept: ${kept} objects`);
