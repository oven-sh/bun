import { jest, mock, test, vi } from "bun:test";
test("loads", () => {
  const { say } = require("./requires.cjs");
  jest.resetModules();
  say();
});
