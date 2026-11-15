import { test, vi } from "bun:test";
const say = async (when, load) => {
  let said;
  try { said = await load(); } catch (error) { said = error.name; }
  console.log("SAID", when, said);
};
test("b", async () => {
  await say("next file", async () => (await import("./user.mjs")).look());
});
