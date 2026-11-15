import { test, mock, vi } from "bun:test";
let pours = 0;
const jug = () => {
  pours++;
  throw new RangeError("the jug slips");
};
async function say(step) {
  let answer;
  try { answer = (await import("./table.mjs")).served; } catch (error) { answer = error.message; }
  console.log("SAID", step, "pours", pours, answer);
}
test("the steps", async () => {
  vi.doMock("./jug.mjs", jug);
  await say("start");
  vi.doMock("./bin.json", () => ({ o: "of this test file" }));
  await say("laid");
  vi.doUnmock("./bin.json");
  await say("ended");
  vi.doUnmock("./jug.mjs");
});
