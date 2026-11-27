import { test } from "bun:test";
const jobs = async count => { for (let job = 0; job < count; job++) await 0; };
test("c", async () => {
  const asked = import("./part.mjs").then(it => it.x, error => error.name);
  await jobs(30);
  console.log("SAID waits", globalThis.calls);
  globalThis.late.reject(new RangeError("late"));
  console.log("SAID", await asked, globalThis.calls);
});
