import { bench, run } from "mitata";

bench("sync", () => {});
bench("async", async () => {});
bench("await 1", async () => await 1);

await run();
