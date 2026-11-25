const { test, vi, mock, jest } = require("bun:test");
const ask = () => { const it = require("./lib.cjs"); return it.word + " " + it.run; };
const say = (...all) => console.log("SAID", "a", globalThis.runs, ...all);
test("a", async () => {
  vi.doMock("./lib.cjs", () => ({ word: "mine", run: -1 }));
  vi.doUnmock("./lib.cjs");
  say("ended", ask());
  vi.doMock("./lib.cjs", () => ({ word: "again", run: -2 }));
  say("again", ask());
});
