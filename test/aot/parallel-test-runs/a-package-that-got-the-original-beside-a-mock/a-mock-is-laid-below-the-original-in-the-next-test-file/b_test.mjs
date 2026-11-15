// A load of the package still leads to what lies below shelf.mjs: the mock that waits there runs, and shelf.mjs is linked to it.
import { test, vi } from "bun:test";
test("two", async () => {
  vi.doMock("./floor.mjs", () => ({ floor: "mocked" }));
  console.log("SAID two", (await import("made-up-pack")).look());
});
