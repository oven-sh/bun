const { test, vi, mock, jest } = require("bun:test");
const ask = () => { const it = require("./lib.cjs"); return it.word + " " + it.run; };
const user = () => require("./user.cjs").read();
const say = (...all) => console.log("SAID", "b", globalThis.runs, ...all);
test("b", async () => {
  say("front", user());
  mock.module("./lib.cjs", () => ({ word: "patch", run: -1 }));
  say("patched", user(), ask());
  vi.doUnmock("./lib.cjs");
  say("ended", user(), ask());
});
