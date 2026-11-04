import { test, vi } from "bun:test";
import { seenByPackage, seenByProject } from "./own.js";
vi.mock("./dep.js", () => ({ dep: "mocked" }));
test("the import of a file of the project gets the mock and runs no body", () => {
  console.log("project", seenByProject());
  console.log("package", seenByPackage());
});
