import { bench, run } from "../runner.mjs";

bench("crypto.randomUUID()", () => {
  return crypto.randomUUID();
});

await run();
