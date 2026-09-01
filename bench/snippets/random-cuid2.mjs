import { bench, run } from "../runner.mjs";

bench("Bun.randomCUID2()", () => {
  return Bun.randomCUID2();
});

bench("Bun.randomUUIDv7()", () => {
  return Bun.randomUUIDv7();
});

bench("crypto.randomUUID()", () => {
  return crypto.randomUUID();
});

await run();
