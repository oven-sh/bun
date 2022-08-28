import { bench, run } from "../node_modules/mitata/src/cli.mjs";

var promises = [];
for (var i = 0; i < 100; i++) {
  promises.push(Promise.resolve(1));
}

bench("noop", function () {});
bench("async function(){}", async function () {});
bench("await 1", async function () {
  return await 1;
});
bench("await new Promise(resolve => resolve())", async function () {
  await new Promise((resolve) => resolve());
});

await run();
