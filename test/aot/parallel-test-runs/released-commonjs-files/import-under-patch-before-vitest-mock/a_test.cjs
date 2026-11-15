const { test, mock, vi } = require("bun:test");
require("./lib.cjs");
test("t", async () => {
  await mock.module("./lib.cjs", async () => ({ a: "late", n: -1 }));
  const kept = [await import("./reader.mjs"), (await import("./space.mjs")).lib, await import("./lib.cjs")];
  const say = at => console.log("SAID", at, kept.map(it => it.a + it.n).join());
  say("patched");
  vi.doMock("./lib.cjs", () => ({ a: "vi", n: -2 }));
  say("mocked");
  kept.push(await import("./reader.mjs"), (await import("./space.mjs")).lib, await import("./lib.cjs"));
  say("loaded");
});
