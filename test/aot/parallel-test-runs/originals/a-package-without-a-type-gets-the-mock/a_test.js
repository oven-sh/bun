import { test, vi } from "bun:test";
import { seen as seenWithoutType } from "untyped";
import { seen as seenInModuleFile } from "untyped/file.mjs";
vi.mock("./dep.js", () => ({ dep: "mocked" }));
test("Node would read its .js file as CommonJS, so it is loaded like a file of the project", () => {
  console.log("index.js", seenWithoutType());
  console.log("file.mjs", seenInModuleFile());
});
