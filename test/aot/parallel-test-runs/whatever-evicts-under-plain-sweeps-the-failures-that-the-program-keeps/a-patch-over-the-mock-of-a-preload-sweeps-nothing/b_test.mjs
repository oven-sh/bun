import { test, mock, vi } from "bun:test";
let calls = 0;
const three = () => {
  calls++;
  if (calls === 1) throw new RangeError("three fails");
  return { t: "mock three" };
};
async function say(step) {
  let answer;
  try { answer = (await import("./all.mjs")).both; } catch (error) { answer = error.message; }
  console.log("SAID b", step, "calls", calls, answer);
}
test("b", async () => {
  vi.doMock("./three.mjs", three);
  await say(1);
  await mock.module("./other.mjs", () => ({ o: "M other" }));
  await say(2);
});
