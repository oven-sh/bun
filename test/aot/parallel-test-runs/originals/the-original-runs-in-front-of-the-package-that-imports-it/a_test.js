import { test, vi } from "bun:test";
import "./early.js";
import { seen } from "typed";
import "./late.js";
vi.mock("./dep.js", () => ({ dep: () => "mocked" }));
test("the body runs where the package's import stands, behind what it alone imports", () => {
  console.log("package", seen());
});
