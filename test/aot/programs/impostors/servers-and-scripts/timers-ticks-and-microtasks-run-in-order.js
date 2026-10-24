import { setImmediate as immediately, setInterval as every, setTimeout as wait } from "node:timers/promises";

const order = [];
setTimeout(() => order.push("timeout 0"), 0);
setImmediate(() => order.push("immediate"));
process.nextTick(value => order.push("tick " + value), 1);
queueMicrotask(() => order.push("microtask"));
Promise.resolve().then(() => order.push("promise"));
order.push("sync");
await wait(20);
console.log(order);

console.log(await wait(1, "value after a wait"), await immediately("value at once"));
let rounds = 0;
for await (const value of every(2, "tick")) if (++rounds === 3) break;
console.log(rounds);

const cancelled = setTimeout(() => console.log("WRONG: a cleared timer ran"), 5);
clearTimeout(cancelled);
let count = 0;
await new Promise(resolve => {
  const timer = setInterval((a, b) => {
    count += a + b;
    if (count >= 9) {
      clearInterval(timer);
      resolve();
    }
  }, 1, 1, 2);
});
console.log(count, typeof cancelled.ref, typeof cancelled.unref, cancelled.hasRef?.(), typeof cancelled[Symbol.toPrimitive]?.());
const controller = new AbortController();
const aborted = wait(1000, null, { signal: controller.signal }).catch(error => error.name + " " + error.code);
controller.abort();
console.log(await aborted);
const unreferenced = setTimeout(() => console.log("WRONG: an unreferenced timer kept the process alive"), 60000);
unreferenced.unref();
const started = performance.now();
await Bun.sleep(5);
console.log(performance.now() - started >= 4, typeof process.hrtime.bigint(), process.hrtime().length, process.uptime() > 0);
