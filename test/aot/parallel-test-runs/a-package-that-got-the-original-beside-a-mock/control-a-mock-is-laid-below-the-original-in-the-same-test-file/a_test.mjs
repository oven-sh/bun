import { test, vi } from "bun:test";
test("one", async () => {
  vi.doMock("./shelf.mjs", () => ({ shelf: () => "of the test" }));
  console.log("SAID one", (await import("made-up-pack")).look());
  vi.doUnmock("./shelf.mjs");
  vi.doMock("./floor.mjs", () => ({ floor: "mocked" }));
  console.log("SAID two", (await import("made-up-pack")).look());
});
