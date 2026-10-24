// node:timers and node:timers/promises: the order of timeouts, immediates, ticks and microtasks; clear, ref, unref, hasRef, refresh and Symbol.toPrimitive of a timer; promised timeouts with a value, with an abort, and an interval as an async iterator; scheduler.wait and yield.
import timers from "node:timers";
import { setTimeout as sleep, setImmediate as immediately, setInterval as every, scheduler } from "node:timers/promises";

const order = [];
await new Promise(resolve => {
  setTimeout(() => { order.push("timeout 2"); resolve(); }, 2);
  setTimeout(() => order.push("timeout 0"), 0);
  setImmediate(() => order.push("immediate"));
  process.nextTick(() => order.push("tick"));
  queueMicrotask(() => order.push("microtask"));
  Promise.resolve().then(() => order.push("promise"));
  order.push("sync");
});
console.log(order.filter(name => name !== "immediate" && name !== "timeout 0").join(), order.includes("immediate"), order.includes("timeout 0"));

const cleared = [];
clearTimeout(setTimeout(() => cleared.push("timeout"), 0));
clearImmediate(setImmediate(() => cleared.push("immediate")));
clearInterval(setInterval(() => cleared.push("interval"), 0));
timers.clearTimeout(timers.setTimeout(() => cleared.push("module"), 0));
await sleep(5);
console.log(cleared.length, timers.setTimeout === setTimeout);

const timer = setTimeout(() => {}, 10_000);
console.log(timer.hasRef(), timer.unref() === timer, timer.hasRef(), timer.ref().hasRef(), typeof timer[Symbol.toPrimitive](), timer.refresh() === timer);
clearTimeout(+timer);
let runs = 0;
await new Promise(resolve => { const interval = setInterval(() => { if (++runs === 3) { clearInterval(interval); resolve(); } }, 1); });
console.log(runs, await new Promise(resolve => setTimeout((a, b) => resolve(a + b), 0, "argu", "ments")));

console.log(await sleep(1, "value"), await immediately("at once"));
const controller = new AbortController();
const pending = sleep(10_000, null, { signal: controller.signal });
controller.abort();
console.log(await pending.catch(error => [error.name, error.code].join()));
console.log(await sleep(1, null, { signal: AbortSignal.abort() }).catch(error => error.code));
let beats = 0;
for await (const value of every(1, "beat")) if (++beats === 3) { console.log(value, beats); break; }
console.log(await scheduler.wait(1), await scheduler.yield());
