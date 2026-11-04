import { test, vi } from "bun:test";
import { dep } from "./dep.js";
import { seen } from "typed";
vi.mock("./dep.js", () => ({ dep: "mocked" }));
test("a file of the package that the package imports gets the original too", () => {
  console.log("package", seen());
  console.log("test file", dep);
});
