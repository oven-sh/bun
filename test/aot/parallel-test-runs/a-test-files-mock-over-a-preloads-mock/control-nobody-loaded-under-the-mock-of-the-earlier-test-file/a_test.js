// Nobody loads under the mock of this test file.
import { test, vi } from "bun:test";
test("a", async () => {
  const { look } = await import("./user.mjs");
  console.log("SAID a", look());
  vi.doMock("made-up-pack/lib.cjs", () => ({ kept: 20 }));
});
