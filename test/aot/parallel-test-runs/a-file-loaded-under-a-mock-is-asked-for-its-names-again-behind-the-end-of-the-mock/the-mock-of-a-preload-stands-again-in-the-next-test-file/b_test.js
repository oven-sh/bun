import { test } from "bun:test";
const say = async (when, load) => {
  let said;
  try {
    said = (await load()).look();
  } catch (error) {
    said = error.name + " " + String(error.message).slice(0, 44);
  }
  console.log("SAID", when, said);
};
test("b", async () => {
  await say("next file", () => import("./user.mjs"));
});
