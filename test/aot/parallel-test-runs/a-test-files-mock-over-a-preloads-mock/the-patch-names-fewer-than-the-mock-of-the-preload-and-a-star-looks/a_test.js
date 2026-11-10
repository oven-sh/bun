import { test, vi } from "bun:test";
test("a", async () => {
  const { look } = await import("./user.mjs");
  console.log("SAID a", look());
  vi.doMock("made-up-pack/lib.cjs", () => ({ kept: 20, spare: 21 }));
  console.log("SAID a late", (await import("./late.mjs")).kept, look());
});
