// A thousand chains of async functions, five deep, each awaiting the next by name, all suspended: only the outermost call of a chain has a promise.
// The expected text is that of compiled code: an engine that makes a promise for every call holds six thousand.
import { heapStats } from "bun:jsc";
let waiting: (() => void)[] = [];
function gate(): Promise<void> {
  return new Promise<void>(resolve => waiting.push(resolve));
}
async function first(n: number): Promise<number> {
  await gate();
  return n;
}
async function second(n: number): Promise<number> {
  return (await first(n)) + 1;
}
async function third(n: number): Promise<number> {
  const value = await second(n);
  return value + 1;
}
async function fourth(n: number): Promise<number> {
  if (n < 0) return 0;
  return (await third(n)) + 1;
}
async function fifth(n: number): Promise<number> {
  try {
    return (await fourth(n)) + 1;
  } finally {
    finished++;
  }
}
let finished = 0;
function livePromises(): number {
  Bun.gc(true);
  return heapStats().objectTypeCounts.Promise ?? 0;
}

const before = livePromises();
const chains: Promise<number>[] = [];
for (let i = 0; i < 1000; i++) chains.push(fifth(i));
const suspended = livePromises() - before;
console.log(suspended < 2500 ? "a chain holds the gate's promise and its own" : "too many promises: " + suspended);
// The collector takes every word of the stack for a reference: a promise from before the calls that such a word held at the first count may be gone at the second.
console.log(suspended >= 1990 ? "the promises that are kept are there" : "too few promises: " + suspended);
for (const open of waiting) open();
const values = await Promise.all(chains);
console.log(values.length, values[0], values[999], values.reduce((a, b) => a + b, 0), finished);
