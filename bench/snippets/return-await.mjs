import { bench, run } from "../runner.mjs";

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
