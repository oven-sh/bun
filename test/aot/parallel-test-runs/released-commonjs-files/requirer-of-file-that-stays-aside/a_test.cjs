const { test, vi, mock, jest } = require("bun:test");
require("./user.cjs");
const ask = () => { const it = require("./lib.cjs"); return it.word + " " + it.run; };
const user = () => require("./user.cjs").read();
const say = (...all) => console.log("SAID", "a", globalThis.runs, ...all);
test("a", async () => {
  vi.doMock("./lib.cjs", async () => { await 0; return { word: "waits", run: -1 }; });
  mock.module("./lib.cjs", () => ({ word: "patch", run: -2 }));
  say("patched", ask(), user());
});
