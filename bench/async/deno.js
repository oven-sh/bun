import { bench, run } from "../node_modules/mitata/src/cli.mjs";

bench("sync", () => {});
bench("async", async () => {});
bench("await 1", async () => await 1);

await run();
