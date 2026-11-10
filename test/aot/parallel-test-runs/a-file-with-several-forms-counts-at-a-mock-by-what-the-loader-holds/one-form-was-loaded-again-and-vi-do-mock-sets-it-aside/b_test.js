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
test("the steps and the probe", async () => {
  vi.doMock("./jug.mjs", jug);
  await say("start");
  vi.doMock("./part.mjs", () => ({ o: "of this test file" }));
  await say("laid");
  vi.doUnmock("./part.mjs");
  await say("ended");
  await import("./part.mjs");
  vi.doMock("./part.mjs", () => ({ o: "mock" }));
  await say("probe");
  const seen = await import("./part.mjs");
  console.log("SAID last", seen.o ?? seen.default?.o);
  vi.doUnmock("./part.mjs");
  vi.doUnmock("./jug.mjs");
});
