import { mock, test, vi } from "bun:test";
// A patch writes its values into the names of the mock that it patches, and adds none: so it stays behind its end.
test("b", async () => {
  const { look } = await import("./user.mjs");
  console.log("SAID b at first", look());
  mock.module("made-up-pack/lib.cjs", () => ({ kept: 60, spare: 61 }));
  console.log("SAID b under the patch", look());
  vi.doUnmock("made-up-pack/lib.cjs");
  console.log("SAID b behind the end", look());
});
