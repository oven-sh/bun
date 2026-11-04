// `export { default } from "./lib.js"` and `export { default as named } from "./lib.js"`, beside a star, which hands no default on. lib.js is mocked.
import { test, vi } from "bun:test";

test("the default export of a mock comes through by its name", async () => {
  vi.doMock("./lib.js", () => ({ default: () => "mock default", fn: () => "mock fn" }));
  const { read, readOffObject, readInLoop } = await import("./reader.js");
  console.log("| by name", read());
  console.log("| off the objects", readOffObject());
  console.log("| in a loop", readInLoop());
});
