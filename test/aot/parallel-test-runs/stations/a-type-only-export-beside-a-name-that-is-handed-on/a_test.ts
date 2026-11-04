// `export type { Shape } from "./lib"` and `export { type Kind, fn } from "./lib"`: what is only a type is no export when the program runs, and no name on the way.
// lib.ts is mocked, and the mock has `Shape` and `Kind` all the same: the barrel hands on neither.
// Plain prints "mock fn", then "fn", then "undefined undefined".
import { test, vi } from "bun:test";

test("a type that is handed on is no name of the barrel", async () => {
  vi.doMock("./lib", () => ({ fn: () => "mock fn", Shape: "mock Shape", Kind: "mock Kind" }));
  const { read, readKeys, readTypes } = await import("./reader");
  console.log("| by name", read());
  console.log("| keys", readKeys());
  console.log("| types", readTypes());
});
