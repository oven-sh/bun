import { bench, run } from "../node_modules/mitata/src/cli.mjs";

bench("noop", function () {});
bench("async function(){}", async function () {});
bench("await 1", async function () {
  return await 1;
});
bench("await new Promise(resolve => resolve())", async function () {
  await new Promise((resolve) => resolve());
});
bench(
  "Promise.all(Array.from({length: 100}, () => new Promise((resolve) => resolve())))",
  async function () {
    return Promise.all(Array.from({ length: 100 }, () => Promise.resolve(1)));
  }
);

await run();
