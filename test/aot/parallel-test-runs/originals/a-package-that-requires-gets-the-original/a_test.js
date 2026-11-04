import { test, vi } from "bun:test";
import reads from "reads";
import own from "./own.cjs";
vi.mock("./dep.cjs", () => ({ dep: "mocked" }));
test("require() in a package gets the file, require() in the project gets the mock", () => {
  console.log("project", own.seen());
  console.log("package", reads.seen());
  console.log("project", own.seen());
  console.log("package", reads.seen(), reads.isSame());
});
