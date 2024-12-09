import { bench, run } from "../runner.mjs";

bench("sync", () => {});
bench("async", async () => {});
bench("await 1", async () => await 1);

await run();
