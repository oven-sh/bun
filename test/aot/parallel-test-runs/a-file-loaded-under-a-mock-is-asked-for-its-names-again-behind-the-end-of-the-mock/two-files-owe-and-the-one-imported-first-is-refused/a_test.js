import { test, vi } from "bun:test";
const say = async (when, load) => {
  let said;
  try {
    said = (await load()).look();
  } catch (error) {
    said = error.name + " " + String(error.message).slice(0, 44);
  }
  console.log("SAID", when, said);
};
test("two owe", async () => {
  vi.doMock("./shapes.mjs", () => ({ round: 10, square: 20 }));
  await say("under", () => import("./user.mjs"));
  vi.doUnmock("./shapes.mjs");
  await say("behind", () => import("./user.mjs"));
});
