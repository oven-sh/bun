import { test } from "bun:test";
const word = load => Promise.resolve(load).then(it => String(it.x), error => error.name);
test("b", async () => {
  globalThis.late.resolve({ x: "late mock" });
  for (let job = 0; job < 40; job++) await 0;
  console.log("SAID b", globalThis.calls, await word(import("./part.cjs")), globalThis.calls);
});
