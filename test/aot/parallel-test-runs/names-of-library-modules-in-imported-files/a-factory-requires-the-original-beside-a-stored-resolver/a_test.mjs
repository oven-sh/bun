import { expect, mock, test } from "bun:test";
import "./resolver.cjs";
import { lay } from "./imported.cjs";
test("in an imported file", () => {
  expect(lay()).toBe("function");
});
test("in the test file", () => {
  mock.module("path", () => ({ of: typeof require("path").join }));
  expect(require("path").of).toBe("function");
});
