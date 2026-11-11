import { test, vi } from "bun:test";
const say = async (when, load) => {
  let said;
  try { said = (await load()).look(); } catch (error) { said = error.name; }
  console.log("SAID", when, said);
};
test("a", async () => {
  vi.doMock("./shapes.mjs", () => ({ round: 10, square: 20 }));
  await say("under", () => import("./user.mjs"));
  vi.doUnmock("./shapes.mjs");
  console.log("SAID apart", (await import("./shapes.mjs")).square);
  vi.doMock("./last.mjs", () => ({ own: 70 }));
  await say("behind", () => import("./user.mjs"));
});
