// https://github.com/nodejs/node/issues/34493
import { AsyncLocalStorage } from "async_hooks";
const asyncLocalStorage = new AsyncLocalStorage();

let fn = () =>
  new Promise(resolve =>
    setTimeout(() => {
      if (asyncLocalStorage.getStore() !== 123) {
        console.log("error", asyncLocalStorage.getStore());
        process.exit(1);
      }
      console.log("pass");
      resolve();
    }, 2),
  );

let runWithExpiry = async (expiry, fn) => {
  let iterations = 0;
  while (Date.now() < expiry) {
    await fn();
    iterations++;
  }
  return iterations;
};

// console.log(`Performed ${await runWithExpiry(Date.now() + 10000, fn)} iterations to warmup`);

// let withoutAls = await runWithExpiry(Date.now() + 10000, fn);
// console.log(`Performed ${withoutAls} iterations (with ALS disabled)`);

let withAls;
await asyncLocalStorage.run(123, async () => {
  withAls = await runWithExpiry(Date.now() + 10000, fn);
  console.log(`Performed ${withAls} iterations (with ALS enabled)`);
});

asyncLocalStorage.disable();

console.log("ALS penalty: " + Math.round((1 - withAls / withoutAls) * 10000) / 100 + "%");
