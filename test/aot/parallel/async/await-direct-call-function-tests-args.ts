// A thousand calls of an async function that awaits another async function by name, all suspended. The argument is read from an object that came through `any`, so the callee tests it at its head, and the caller takes those tests in: the awaited call behind them makes no promise all the same.
// The expected text is that of compiled code: an engine that makes a promise for every call holds three thousand.
import { heapStats } from "bun:jsc";
type Pair = { a: number; b: number };
let waiting: (() => void)[] = [];
function gate(): Promise<void> {
  return new Promise<void>(resolve => waiting.push(resolve));
}
async function double(value: number): Promise<number> {
  await gate();
  return value * 2;
}
async function doubleOfFirst(pair: Pair): Promise<number> {
  return await double(pair.a);
}
function livePromises(): number {
  Bun.gc(true);
  return heapStats().objectTypeCounts.Promise ?? 0;
}

const pairs: any[] = [];
for (let i = 0; i < 1000; i++) pairs.push({ extra: "x", b: 0, a: i });
console.log(await Promise.all([doubleOfFirst({ a: 1, b: 2 }), (waiting.shift()!(), 0)]));
const before = livePromises();
const results: Promise<number>[] = [];
for (const pair of pairs) results.push(doubleOfFirst(pair));
const suspended = livePromises() - before;
console.log(suspended < 2500 ? "a call holds the gate's promise and its own" : "too many promises: " + suspended);
// The collector takes every word of the stack for a reference: a promise from before the calls that such a word held at the first count may be gone at the second.
console.log(suspended >= 1990 ? "the promises that are kept are there" : "too few promises: " + suspended);
for (const resume of waiting) resume();
const values = await Promise.all(results);
console.log(values.length, values[0], values[999], values.reduce((a, b) => a + b, 0));
/* Output:
[ 2, 0 ]
a call holds the gate's promise and its own
the promises that are kept are there
1000 0 1998 999000
*/
