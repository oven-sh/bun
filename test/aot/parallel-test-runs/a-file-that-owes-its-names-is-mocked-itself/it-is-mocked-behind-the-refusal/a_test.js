import { test, vi } from "bun:test";
const say = async (when, load) => {
  let said;
  try { said = await load(); } catch (error) { said = error.name; }
  console.log("SAID", when, said);
};
test("t", async () => {
  vi.doMock("./shapes.mjs", () => ({ round: 10 }));
  await say("under", async () => (await import("./user.mjs")).look());
  vi.doUnmock("./shapes.mjs");
  await say("behind", async () => (await import("./user.mjs")).look());
  vi.doMock("./last.mjs", () => ({ round: 9 }));
  await say("last is mocked", async () => (await import("./user.mjs")).look());
});
