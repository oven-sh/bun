import { test } from "bun:test";
const jobs = async n => { for (let job = 0; job < n; job++) await 0; };
test("b", async () => {
  globalThis.late.reject(new RangeError("late"));
  await jobs(60);
  console.log("SAID b", globalThis.calls);
});
test("b goes on", () => console.log("SAID b goes on", globalThis.calls));
