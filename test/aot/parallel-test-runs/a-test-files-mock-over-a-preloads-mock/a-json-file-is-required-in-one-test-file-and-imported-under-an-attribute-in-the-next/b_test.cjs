const { test, vi, mock } = require("bun:test");
const ask = async () => { try { const got = await import(JSON.parse('"./lib.json"'), { with: { type: "json" } }); const it = got.default ?? got; return it.a + " " + it.n; } catch (error) { return error.name; } };
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("b", async () => {
  say("first", await ask());
  vi.doMock("./lib.json", () => ({ a: "mine", n: -1 })); say("mocked", await ask());
  vi.doUnmock("./lib.json"); say("ended", await ask(), await ask());
});
