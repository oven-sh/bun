import { test } from "bun:test";
const word = load => Promise.resolve(load).then(it => String(it.x), error => error.name);
const jobs = async n => { for (let job = 0; job < n; job++) await 0; };
test("b", async () => {
  globalThis.late.resolve({ x: "late mock" });
  await jobs(60);
  console.log("SAID b", globalThis.calls, await word(import("./part.cjs")), globalThis.calls);
});
