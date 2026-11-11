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
test("made up", async () => {
  vi.doMock("./shapes.mjs", () => ({ round: 10, square: 20, extra: 3 }));
  await say("under", () => import("./user.mjs"));
  vi.doUnmock("./shapes.mjs");
  vi.doMock("./last.mjs", () => ({ extra: 7 }));
  await say("again", () => import("./user.mjs"));
  await say("a third time", () => import("./user.mjs"));
});
