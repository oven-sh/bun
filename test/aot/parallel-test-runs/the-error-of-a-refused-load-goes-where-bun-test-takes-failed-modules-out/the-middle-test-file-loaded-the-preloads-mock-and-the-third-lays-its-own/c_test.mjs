import { test, mock, vi } from "bun:test";
let pours = 0;
const jug = () => {
  pours++;
  if (pours === 1) throw new RangeError("the jug slips");
  return { drink: "mock" };
};
async function say(step) {
  let answer;
  try { answer = (await import("./table.mjs")).served; } catch (error) { answer = error.message; }
  console.log("SAID", step, "pours", pours, answer, "bodies", globalThis.bodies ?? 0);
}
test("the failure of another mock's factory", async () => {
  vi.doMock("./jug.mjs", jug);
  await say(1);
  vi.doMock("./bin.mjs", () => ({ o: "mock" }));
  await say(2);
});
