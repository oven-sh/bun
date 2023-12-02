import { realpathSync } from "node:fs";
const count = parseInt(process.env.ITERATIONS || "1", 10) || 1;
const arg = process.argv[process.argv.length - 1];
import { bench, run } from "./runner.mjs";

bench("realpathSync x " + count, () => {
  for (let i = 0; i < count; i++) realpathSync(arg, "utf-8");
});

await run();
