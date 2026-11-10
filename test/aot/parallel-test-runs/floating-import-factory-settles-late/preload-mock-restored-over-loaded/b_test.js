import { test } from "bun:test";
const word = load => Promise.resolve(load).then(it => String(it.x), error => error.name);
const jobs = async n => { for (let job = 0; job < n; job++) await 0; };
test("b", async () => {
  const asked = word(import("./part.js"));
  await jobs(30);
  console.log("SAID b waits", globalThis.calls);
  globalThis.late.reject(new RangeError("late"));
  console.log("SAID b", await asked, globalThis.calls);
});
