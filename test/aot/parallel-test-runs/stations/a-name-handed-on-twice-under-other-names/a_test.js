// `export { b as c } from "./inner.js"` over `export { a as b } from "./lib.js"`. The file between is mocked: neither the file that the import names nor the file that declares.
import { test, vi } from "bun:test";

test("the mock of the file between answers under the name it is asked for there", async () => {
  vi.doMock("./inner.js", () => ({ a: () => "mock a", b: () => "mock b", c: () => "mock c" }));
  const { read, readThrough, readInLoop } = await import("./reader.js");
  console.log("| straight", read());
  console.log("| through a parameter", readThrough(value => value));
  console.log("| in a loop", readInLoop());
});
