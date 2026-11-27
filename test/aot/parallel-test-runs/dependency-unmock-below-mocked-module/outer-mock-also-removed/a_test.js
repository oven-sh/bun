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
  await say("0 user", () => import("./user.mjs"));
  vi.doMock("./last.mjs", () => ({ extra: 70 }));
  vi.doUnmock("./shapes.mjs");
  vi.doUnmock("./last.mjs");
  await say("4 user", () => import("./user.mjs"));
  await say("5 user2", () => import("./user2.mjs"));
  await say("6 user", () => import("./user.mjs"));
});
