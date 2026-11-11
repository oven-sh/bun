import { test } from "bun:test";
const word = load => load.then(it => String(it.x), error => error.name);
test("b", async () => {
  globalThis.late.reject(new RangeError("late"));
  for (let job = 0; job < 40; job++) await 0;
  console.log("SAID b", globalThis.calls, await word(import("./part.js")), globalThis.calls);
});
