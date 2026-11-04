// barrel.js has a star over inner.js, which hands the name on from middle.js, which hands it on from lib.js. middle.js is mocked: neither the file that the import names nor the file
// that declares. The star is an ordinary one: inner.js is no mock and has no star of its own. And the reader imports the name and nothing else, so nobody reads it off the object of the barrel.
// Plain prints "mock fn" in all three lines.
import { test, vi } from "bun:test";

test("the mock behind a star and a name answers", async () => {
  vi.doMock("./middle.js", () => ({ fn: () => "mock fn" }));
  const { read, readThrough, readInLoop } = await import("./reader.js");
  console.log("| straight", read());
  console.log("| through a parameter", readThrough(value => value));
  console.log("| in a loop", readInLoop());
});
