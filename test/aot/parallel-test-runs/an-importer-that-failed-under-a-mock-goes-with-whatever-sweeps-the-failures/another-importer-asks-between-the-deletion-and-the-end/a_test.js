const { test, vi } = require("bun:test");
const key = require.resolve("./lib.cjs");
const say = async (at, load) => { let said; try { said = (await load()).seen(); } catch (error) { said = error.name; } console.log("SAID", at, said); };
const fail = async () => { await 0; throw new RangeError("late"); };
test("t", async () => {
  vi.doMock("./lib.cjs", fail);
  await say("in front", () => import("./user.mjs"));
  delete require.cache[key];
  await say("beside", () => import("./beside.mjs"));
  vi.doUnmock("./lib.cjs");
  await say("behind the end", () => import("./user.mjs"));
});
