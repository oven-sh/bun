import { test, jest } from "bun:test";

jest.mock("./m", () => ({ v: "b" }));

test("jest.mock(), and the test file imports nothing", () => {
  console.log("b sees " + (globalThis as any).held());
});
