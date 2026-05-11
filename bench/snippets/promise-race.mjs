import { bench, run } from "../runner.mjs";

bench("Promise.race([p1, p2])", async function () {
  return await Promise.race([Promise.resolve(1), Promise.resolve(2)]);
});

await run();
