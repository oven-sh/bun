import { test, vi } from "bun:test";
test("u", async () => {
  const { look } = await import("./user.mjs"); console.log("SAID next", look());
  vi.doMock("pack/lib.mjs", () => ({ kept: 40 })); console.log("SAID vi of b", look());
});
