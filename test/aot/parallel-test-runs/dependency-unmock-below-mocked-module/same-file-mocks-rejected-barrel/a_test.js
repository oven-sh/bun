import { test, vi } from "bun:test";
const say = async (when, load) => {
  let said;
  try { said = await load(); } catch (error) { said = error.name; }
  console.log("SAID", when, said);
};
test("a", async () => {
  vi.doMock("./shapes.mjs", () => ({ round: 10 }));
  await say("under", async () => (await import("./user.mjs")).look());
  vi.doUnmock("./shapes.mjs");
  await say("behind", async () => (await import("./user.mjs")).look());
  vi.doMock("./wide.mjs", () => ({ round: 7 }));
  await say("wide is mocked", async () => (await import("./user.mjs")).look());
  vi.doUnmock("./wide.mjs");
  await say("behind its end", async () => (await import("./user.mjs")).look());
});
