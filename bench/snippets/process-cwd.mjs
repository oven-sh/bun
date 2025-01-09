import { bench, run } from "../runner.mjs";

bench("process.cwd()", () => {
  process.cwd();
});

await run();
