import { test } from "bun:test";
test("the second file", async () => {
  globalThis.late.reject(new RangeError("late"));
  for (let job = 0; job < 40; job++) await 0;
  console.log("SAID second", globalThis.calls);
});
