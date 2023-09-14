// https://github.com/nodejs/node/issues/34493
import { AsyncLocalStorage } from "async_hooks";
const asyncLocalStorage = new AsyncLocalStorage();

// let fn = () => Promise.resolve(2).then(() => new Promise(resolve => queueMicrotask(resolve)));
let fn = () => /test/.test("test");

let runWithExpiry = async (expiry, fn) => {
  let iterations = 0;
  while (Date.now() < expiry) {
    await fn();
    iterations++;
  }
  return iterations;
};

console.log(`Performed ${await runWithExpiry(Date.now() + 1000, fn)} iterations to warmup`);

let withAls;
await asyncLocalStorage.run(123, async () => {
  withAls = await runWithExpiry(Date.now() + 45000, fn);
  console.log(`Performed ${withAls} iterations (with ALS enabled)`);
});

asyncLocalStorage.disable();

let withoutAls = await runWithExpiry(Date.now() + 45000, fn);
console.log(`Performed ${withoutAls} iterations (with ALS disabled)`);

console.log("ALS penalty: " + Math.round((1 - withAls / withoutAls) * 10000) / 100 + "%");
