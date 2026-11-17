const { test, vi, mock, jest } = require("bun:test");
const say = (...all) => console.log("SAID", "a", globalThis.runs, ...all);
test("a", async () => {
  vi.doMock("./lib.cjs", async () => { const inner = await import("./inner.mjs"); return { word: "mock", run: inner.run + 100 }; });
  const under = await import("./under.mjs");
  say("under", under.word, under.run);
  vi.doUnmock("./lib.cjs");
  say("ended", (await import("./last.mjs")).run);
});
