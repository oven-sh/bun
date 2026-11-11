import { test, mock, vi, jest } from "bun:test";
let calls = 0;
const cup = () => {
  calls++;
  if (calls === 1) throw new RangeError("cup fails");
  return { t: "mock cup" };
};
async function say(step) {
  let answer;
  try { answer = (await import("./all.mjs")).both; } catch (error) { answer = error.message; }
  console.log("b", step, "calls", calls, answer, "trays", globalThis.trays ?? 0);
}
test("b", async () => {
  vi.doMock("./cup.mjs", cup);
  await say(1);
  vi.doMock("./tray.mjs", () => ({ o: "mock tray" }));
  await say(2);
});
