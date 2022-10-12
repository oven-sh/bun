import { bench, run } from "../node_modules/mitata/src/cli.mjs";

bench("return await Promise.resolve(1)", async function () {
  return await Promise.resolve(1);
});

bench("return Promise.resolve(1) (async fn)", async function () {
  return Promise.resolve(1);
});

bench("return await 1", async function () {
  return await 1;
});


await run();
