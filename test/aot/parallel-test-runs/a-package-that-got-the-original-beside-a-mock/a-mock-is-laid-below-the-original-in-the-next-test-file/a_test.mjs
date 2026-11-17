// The package gets the file shelf.mjs beside its mock, and holds it behind the end of the mock.
import { test, vi } from "bun:test";
test("one", async () => {
  vi.doMock("./shelf.mjs", () => ({ shelf: () => "of the test" }));
  console.log("SAID one", (await import("made-up-pack")).look());
  vi.doUnmock("./shelf.mjs");
});
