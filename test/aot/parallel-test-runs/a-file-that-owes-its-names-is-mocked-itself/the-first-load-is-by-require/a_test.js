import { test, vi } from "bun:test";
const say = async (when, load) => {
  let said;
  try { said = await load(); } catch (error) { said = error.name; }
  console.log("SAID", when, said);
};
test("t", async () => {
  vi.doMock("./shapes.mjs", () => ({ round: 10 }));
  await say("under", () => require("./user.mjs").look());
  vi.doUnmock("./shapes.mjs");
  vi.doMock("./last.mjs", () => ({ round: 9 }));
  await say("last is mocked", () => require("./user.mjs").look());
});
