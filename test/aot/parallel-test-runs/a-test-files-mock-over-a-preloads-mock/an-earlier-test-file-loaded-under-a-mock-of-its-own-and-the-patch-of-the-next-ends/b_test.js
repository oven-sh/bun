// Under `bun test` the patch writes on the module that the importers hold, and its end restores nothing: they keep what the patch left.
import { mock, test, vi } from "bun:test";
test("b", async () => {
  const { look } = await import("./user.mjs");
  console.log("SAID b at first", look());
  mock.module("made-up-pack/lib.cjs", () => ({ kept: 60 }));
  console.log("SAID b under the patch", look());
  vi.doUnmock("made-up-pack/lib.cjs");
  console.log("SAID b behind the end", look());
});
