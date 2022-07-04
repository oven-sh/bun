import { run, bench } from "mitata";

bench("async", async () => 1);
bench("await 1", async () => await 1);
bench("noop", () => {});

await run();
