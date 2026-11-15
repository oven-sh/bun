const { test, vi, mock, jest } = require("bun:test");
const NAME = 'pack/lib.cjs';
const by = {
  require: async () => { try { const it = require(NAME); return it.a + " " + it.n; } catch (error) { return error.name; } },
  import: async () => { try { const it = await import(NAME); return it.a + " " + it.n; } catch (error) { return error.name; } },
};
const say = async (at, door) => { const it = await by[door](); console.log("SAID", at, door, globalThis.runsOfLib, it); };
test("a", async () => {
  await say("first", 'import');
  mock.module(NAME, () => ({ a: "ours", n: -1 })); await say("under ours", 'import');
  vi.doUnmock(NAME); await say("ours ended", 'import'); await say("ours ended", 'require');
});
