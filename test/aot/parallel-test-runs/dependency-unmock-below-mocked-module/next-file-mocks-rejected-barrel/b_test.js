import { test, vi } from "bun:test";
const say = async (when, load) => {
  let said;
  try { said = await load(); } catch (error) { said = error.name; }
  console.log("SAID", when, said);
};
test("b", async () => {
  vi.doMock("./wide.mjs", () => ({ round: 7 }));
  await say("next file", async () => (await import("./user.mjs")).look());
});
