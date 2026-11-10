const { test, vi, mock } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { const it = require("./lib.cjs"); return it.a + " " + it.n; } catch (error) { return error.name; } };
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
let calls = 0;
test("a", () => {
  vi.doMock("./lib.cjs", () => ({ a: "mine", n: -1 })); say("mocked", ask());
  vi.doUnmock("./lib.cjs"); say("ended", ask());
  const lay = vi.mock; lay("./lib.cjs", () => { calls++; return { a: "again", n: -2 }; });
  say("laid", calls); say("again", ask(), calls);
});
