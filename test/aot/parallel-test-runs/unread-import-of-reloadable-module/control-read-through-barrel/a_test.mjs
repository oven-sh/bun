import { test, vi } from "bun:test";
test("t", async () => {
  const first = await import("./outer.mjs");
  const before = await first.outer();
  vi.resetModules();
  vi.doMock("./base.mjs", () => ({ base: "again" }));
  const second = await import("./outer.mjs");
  console.log("SAID", before, "|", await first.outer(), "|", await second.outer());
});
