import { test, vi } from "bun:test";
test("a name is asked for again behind the end of the mock", async () => {
  vi.doMock("./sizes.cjs", async () => { const inner = await import("./inner"); return { width: 10, height: inner.seen + 100 }; });
  const under = await import("./under");
  vi.doUnmock("./sizes.cjs");
  const last = await import("./last");
  console.log("SAID", under.seen, last.seen);
});
