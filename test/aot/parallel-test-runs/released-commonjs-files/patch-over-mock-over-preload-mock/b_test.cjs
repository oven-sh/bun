const { test, vi, mock, jest } = require("bun:test");
const ask = () => { const it = require("./lib.cjs"); return it.word + " " + it.run; };
const say = (...all) => console.log("SAID", "b", globalThis.runs, ...all);
test("b", async () => {
  say("next", ask());
  vi.doMock("./lib.cjs", () => ({ word: "mine", run: -1 }));
  say("mocked", ask());
  vi.doUnmock("./lib.cjs");
  say("ended", ask());
});
