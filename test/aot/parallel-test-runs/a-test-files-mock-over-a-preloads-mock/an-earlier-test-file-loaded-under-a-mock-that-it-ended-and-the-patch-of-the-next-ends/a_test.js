// A file was loaded under the mock of this test file, so the importers of the preload's mock kept that one beside it. The mock ends within the file.
import { test, vi } from "bun:test";
test("a", async () => {
  const { look } = await import("./user.mjs");
  console.log("SAID a", look());
  vi.doMock("made-up-pack/lib.cjs", () => ({ kept: 20 }));
  console.log("SAID a late", (await import("./late.mjs")).kept, look());
  vi.doUnmock("made-up-pack/lib.cjs");
});
