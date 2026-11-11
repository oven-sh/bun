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
test("under the mock and behind its end", async () => {
  vi.doMock("./shapes.mjs", () => ({ round: 10, extra: 11 }));
  await say("under", () => import("./user.mjs"));
  vi.doUnmock("./shapes.mjs");
  await say("behind", () => import("./user.mjs"));
});
