// `export * from "./dep.cjs"` and `export { flag as renamed } from "./dep.cjs"`: ES modules see the CommonJS file through its facade. The file is mocked before anything is loaded.
import { test, vi } from "bun:test";

test("a mock of a CommonJS file behind a barrel", async () => {
  vi.doMock("./dep.cjs", () => ({ flag: "mock flag", fn: () => "mock fn" }));
  const { read, readOffObject, readInLoop } = await import("./reader.js");
  console.log("| by name", read());
  console.log("| off the object", readOffObject());
  console.log("| in a loop", readInLoop());
});
