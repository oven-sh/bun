import { test, vi } from "bun:test";
test("the names of the barrel and what they hold", async () => {
  vi.doMock("pack/shapes.cjs", () => ({ round: 10 }));
  const all = await import("pack/wide.mjs");
  console.log("SAID", Object.keys(all).join(), all.round, all.square);
});
