import { bench, run } from "../runner.mjs";

bench("Bun.randomULID()", () => {
  return Bun.randomULID();
});

bench("Bun.randomUUIDv7()", () => {
  return Bun.randomUUIDv7();
});

bench("crypto.randomUUID()", () => {
  return crypto.randomUUID();
});

await run();
