import { test, vi } from "bun:test";
import { seen as seenByPackage } from "typed";
import { seen as seenByProject } from "./own.js";
import { dep } from "./dep.js";
vi.mock("./dep.js", () => ({ dep: "mocked", shout: () => "MOCKED" }));
test("the package reads the file itself", () => {
  console.log("package", seenByPackage());
  console.log("project", seenByProject());
  console.log("test file", dep);
  console.log("package again", seenByPackage());
});
