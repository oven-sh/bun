import { test } from "bun:test";
test("what stands above process behind a printed warning", async () => {
  console.log(
    "before",
    typeof process._eventsCount,
    Object.getPrototypeOf(Object.getPrototypeOf(process)) === Object.prototype,
  );
  process.emitWarning("made-up words");
  await new Promise(resolve => setImmediate(resolve));
  console.log(
    "behind",
    typeof process._eventsCount,
    Object.getPrototypeOf(Object.getPrototypeOf(process)) === Object.prototype,
  );
});
