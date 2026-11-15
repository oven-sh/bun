import { mock, test } from "bun:test";
test("the next test file finds nothing loaded", async () => {
  mock.module("./lib.mjs", () => {
    console.log("the factory is called");
    return { a: "second" };
  });
  console.log("mocked again");
  console.log("import", (await import("./lib.mjs")).a, "runs", globalThis.runs);
});
