import { test, vi } from "bun:test";
const say = (step, all) => console.log("SAID", step, Object.keys(all).sort().join(), all.first, all.added, all.kept, all.both, all.own);
test("the names", async () => {
  vi.doMock("./first.mjs", () => ({ first: 10, added: 3 }));
  vi.doMock("./part.cjs", () => ({ kept: 10 }));
  const all = await import("./outer.mjs");
  say("under", all);
  vi.doUnmock("./first.mjs");
  vi.doUnmock("./part.cjs");
  say("ended", all);
  say("the module itself", await import("./first.mjs"));
  say("another barrel", await import("./late.mjs"));
});
