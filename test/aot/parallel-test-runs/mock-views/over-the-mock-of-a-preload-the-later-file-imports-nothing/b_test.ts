import { test, mock } from "bun:test";

mock.module("./m", () => ({ v: "b" }));

test("mock.module(), and the test file imports nothing", () => {
  console.log("b sees " + (globalThis as any).held());
});
