const { test, vi, mock, jest } = require("bun:test");
const load = async () => { const it = await import("./lib.cjs"); return it.word + " " + it.run; };
const reader = async () => (await import("./reader.mjs")).read();
const say = (...all) => console.log("SAID", "a", globalThis.runs, ...all);
test("a", async () => {
  say("front", await reader());
  vi.doMock("./lib.cjs", () => ({ word: "mock", run: -1 }));
  mock.module("./lib.cjs", () => ({ word: "patch", run: -2 }));
  vi.doUnmock("./lib.cjs");
  mock.module("./lib.cjs", async () => { await 0; return { word: "late", run: -3 }; });
  say("late", await load(), await reader());
});
