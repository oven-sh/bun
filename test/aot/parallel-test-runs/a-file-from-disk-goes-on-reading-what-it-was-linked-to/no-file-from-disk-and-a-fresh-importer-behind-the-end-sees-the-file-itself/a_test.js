import { test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("pack/wick.mjs", () => ({ width: 100 }));
  console.log((await import("pack/wick.mjs")).width);
  const { seen } = await import("./lamp.mjs");
  console.log(seen());
  vi.doUnmock("pack/wick.mjs");
  console.log((await import("./lantern.mjs")).seen());
});
