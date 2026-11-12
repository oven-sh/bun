const { test, vi } = require("bun:test");
const key = require.resolve("./lib.cjs");
const say = async (at, load) => { let said; try { said = (await load()).seen(); } catch (error) { said = error.name; } console.log("SAID", at, said); };
const fail = async () => { await 0; throw new RangeError("late"); };
test("t", async () => {
  vi.doMock("./other.mjs", () => ({ o: "mock" }));
  await import("./other.mjs");
  vi.doMock("./lib.cjs", fail);
  await import("./lib.cjs").catch(() => {});
  try { require("./lib.cjs"); } catch {}
  await say("in front", () => import("./user.mjs"));
  delete require.cache[key];
  vi.doUnmock("./lib.cjs");
  await say("behind the end", () => import("./user.mjs"));
  vi.doUnmock("./other.mjs");
});
