import { jest, test } from "bun:test";
import { seen as seenByImport } from "typed";
import required from "requires";
jest.mock("./dep.js", () => ({ dep: "mocked" }));
jest.mock("./dep.cjs", () => ({ dep: "mocked" }));
test("a mock of Jest reaches the packages too", () => {
  console.log("import", seenByImport());
  console.log("require", required.seen());
});
