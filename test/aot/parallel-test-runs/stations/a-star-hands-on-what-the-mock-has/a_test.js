// A mock of a file that `export *` names, laid before anything is loaded. Whoever reads through the barrel reads the mock.
import { test, vi } from "bun:test";

test("read through a star", async () => {
  vi.doMock("./lib.js", () => ({ fn: () => "mock fn", other: "mock other" }));
  const { read, readThrough, readInLoop } = await import("./reader.js");
  console.log("| straight", read());
  console.log("| through a parameter", readThrough(value => value));
  console.log("| in a loop", readInLoop());
});
