import { bench, run } from "mitata";

bench("process.cwd()", () => {
  process.cwd();
});

await run();
