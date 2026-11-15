import { test, vi } from "bun:test";
test("without the factory asking", async () => {
  vi.doMock("./sizes.cjs", async () => { await 0; return { width: 10, height: 100 }; });
  const under = await import("./under");
  vi.doUnmock("./sizes.cjs");
  const last = await import("./last");
  console.log("SAID", under.seen, last.seen);
});
