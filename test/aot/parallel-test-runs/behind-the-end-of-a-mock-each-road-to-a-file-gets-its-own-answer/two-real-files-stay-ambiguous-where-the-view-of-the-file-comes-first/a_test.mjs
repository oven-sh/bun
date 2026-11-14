import { test, vi } from "bun:test";
test("the names", async () => {
  await import("./early.mjs");
  vi.doMock("./part.cjs", () => ({ both: "mock", extra: 10 }));
  await import("./late.mjs");
  try { vi.doUnmock("./part.cjs"); } catch (error) { console.log("no end: " + error.name); }
  const all = await import("./barrel.mjs");
  console.log("SAID", Object.keys(all).sort().join(), all.both, all.extra, all.own);
});
