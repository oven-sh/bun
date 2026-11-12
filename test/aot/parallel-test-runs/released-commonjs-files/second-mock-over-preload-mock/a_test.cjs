const { test, vi, mock, jest } = require("bun:test");
const ask = () => { const it = require("./lib.cjs"); return it.word + " " + it.run; };
const user = () => require("./user.cjs").read();
const say = (...all) => console.log("SAID", "a", globalThis.runs, ...all);
test("a", async () => {
  say("front", user());
  vi.doMock("./lib.cjs", () => ({ word: "mock", run: -1 }));
  say("mocked", ask(), user());
  vi.doMock("./lib.cjs", () => ({ word: "mock too", run: -2 }));
  say("mocked", ask(), user());
});
