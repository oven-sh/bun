const { test, vi, mock, jest } = require("bun:test");
const ask = () => { const it = require("./lib.cjs"); return it.word + " " + it.run; };
const say = (...all) => console.log("SAID", "c", globalThis.runs, ...all);
test("c", async () => {
  say("last", ask());
  vi.doUnmock("./lib.cjs");
  say("ended", ask());
});
