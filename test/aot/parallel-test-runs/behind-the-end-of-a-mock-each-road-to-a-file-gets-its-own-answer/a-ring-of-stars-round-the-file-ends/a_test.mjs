import { test, vi } from "bun:test";
test("the names", async () => {
  vi.doMock("./part.cjs", () => ({ kept: 10, added: 3 }));
  const all = await import("./first.mjs");
  vi.doUnmock("./part.cjs");
  console.log("SAID", Object.keys(all).sort().join(), all.kept, all.added, all.both, all.own);
});
