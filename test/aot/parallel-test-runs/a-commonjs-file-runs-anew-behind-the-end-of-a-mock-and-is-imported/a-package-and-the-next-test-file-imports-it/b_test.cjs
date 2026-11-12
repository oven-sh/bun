const { test, vi, mock, jest } = require("bun:test");
const NAME = 'pack/lib.cjs';
const by = {
  require: async () => { try { const it = require(NAME); return it.a + " " + it.n; } catch (error) { return error.name; } },
  import: async () => { try { const it = await import(NAME); return it.a + " " + it.n; } catch (error) { return error.name; } },
};
const say = async (at, door) => { const it = await by[door](); console.log("SAID", at, door, globalThis.runsOfLib, it); };
test("b", async () => {
  mock.module(NAME, () => ({ a: "theirs", n: -7 })); await say("under theirs", 'import');
  vi.doUnmock(NAME); await say("theirs ended", 'import'); await say("theirs ended", 'require');
});
