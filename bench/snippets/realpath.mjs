import { realpathSync } from "node:fs";
import { bench, run } from "../runner.mjs";
const count = parseInt(process.env.ITERATIONS || "1", 10) || 1;
const arg = process.argv[process.argv.length - 1];

bench("realpathSync x " + count, () => {
  for (let i = 0; i < count; i++) realpathSync(arg, "utf-8");
});

await run();
