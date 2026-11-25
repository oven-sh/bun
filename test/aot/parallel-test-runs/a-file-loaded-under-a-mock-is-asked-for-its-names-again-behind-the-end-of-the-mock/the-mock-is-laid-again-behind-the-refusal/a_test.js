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
test("under the mock, behind its end, and under it again", async () => {
  vi.doMock("./shapes.mjs", () => ({ round: 10 }));
  await say("under", () => import("./user.mjs"));
  vi.doUnmock("./shapes.mjs");
  await say("behind", () => import("./user.mjs"));
  vi.doMock("./shapes.mjs", () => ({ round: 10 }));
  await say("under it again", () => import("./user.mjs"));
});
