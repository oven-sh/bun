import { bench, run } from "mitata";

bench("noop", function () {});
bench("async function(){}", async function () {});
bench("await 1", async function () {
  return await 1;
});

function callnextTick(resolve) {
  process.nextTick(resolve);
}

function awaitNextTick() {
  return new Promise(callnextTick);
}

bench("promise.nextTick", async function () {
  return awaitNextTick();
});

bench("await new Promise(resolve => resolve())", async function () {
  await new Promise(resolve => resolve());
});
bench("Promise.all(Array.from({length: 100}, () => new Promise((resolve) => resolve())))", async function () {
  return Promise.all(Array.from({ length: 100 }, () => Promise.resolve(1)));
});

await run();
