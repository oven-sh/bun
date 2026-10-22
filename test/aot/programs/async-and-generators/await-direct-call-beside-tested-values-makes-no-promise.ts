// A thousand calls of an async function that awaits another one by name, all suspended. The result of the await and the parameter are values whose types are tested, under try and finally: the awaited call makes no promise all the same.
// The expected text is that of compiled code: an engine that makes a promise for every call holds three thousand.
// STATISTIC: AwaitedCallsResolved >= 1
import { heapStats } from "bun:jsc";
let waiting: (() => void)[] = [];
let open = 0;
function gate(): Promise<void> {
  return new Promise<void>(resolve => waiting.push(resolve));
}
async function readSmall(name: string): Promise<number> {
  await gate();
  return name.length * 2;
}
async function readGuarded(name: string): Promise<number> {
  open++;
  try {
    const size = await readSmall(name);
    if (size > 100) throw new RangeError("too large: " + name);
    return size + 1;
  } finally {
    open--;
  }
}
function livePromises(): number {
  Bun.gc(true);
  return heapStats().objectTypeCounts.Promise ?? 0;
}

const names: any[] = [];
for (let i = 0; i < 1000; i++) names.push("n" + i);
const before = livePromises();
const reads: Promise<number>[] = [];
for (const name of names) reads.push(readGuarded(name));
const suspended = livePromises() - before;
console.log(suspended < 2500 ? "a read holds the gate's promise and its own" : "too many promises: " + suspended);
console.log(suspended >= 2000 ? "the promises that are kept are there" : "too few promises: " + suspended);
console.log(open);
for (const resume of waiting) resume();
const sizes = await Promise.all(reads);
console.log(sizes.length, sizes[0], sizes[999], sizes.reduce((a, b) => a + b, 0), open);
