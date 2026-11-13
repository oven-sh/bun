const { test, vi, mock, jest } = require("bun:test");
const ask = () => { const it = require("./lib.cjs"); return it.word + " " + it.run; };
const user = () => require("./user.cjs").read();
const load = async () => { const it = await import("./lib.cjs"); return it.word + " " + it.run; };
const reader = async () => (await import("./reader.mjs")).read();
const say = (...all) => console.log("SAID", "a", globalThis.runs, ...all);
test("a", async () => {
  say("front", user(), await reader());
  vi.doMock("./lib.cjs", async () => { await 0; return { word: "waits", run: -1 }; });
  mock.module("./lib.cjs", async () => { await 0; return { word: "waits too", run: -2 }; });
  mock.module("./lib.cjs", () => ({ word: "patch", run: -3 }));
  say("patched", ask(), user(), await load(), await reader());
  vi.doUnmock("./lib.cjs");
  say("ended", ask(), user(), await reader());
});
