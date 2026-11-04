// A barrel of barrels: outer.js has a star over middle.js, which has a star over inner.js, which hands the name on from lib.js. The one in the middle is mocked.
import { test, vi } from "bun:test";

test("the mock of the barrel in the middle answers", async () => {
  vi.doMock("./middle.js", () => ({ fn: () => "mock fn" }));
  const { read, readOffObject, readInLoop } = await import("./reader.js");
  console.log("| by name", read());
  console.log("| off the object", readOffObject());
  console.log("| in a loop", readInLoop());
});
