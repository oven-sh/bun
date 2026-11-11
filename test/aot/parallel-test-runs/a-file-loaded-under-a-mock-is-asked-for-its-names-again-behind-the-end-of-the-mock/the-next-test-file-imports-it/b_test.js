import { test, vi } from "bun:test";
const say = async (when, load) => {
  let said;
  try {
    said = (await load()).look();
  } catch (error) {
    said = error.name;
  }
  console.log("SAID", when, said);
};
test("in the next test file", async () => {
  await say("next file", () => import("./user.mjs"));
});
