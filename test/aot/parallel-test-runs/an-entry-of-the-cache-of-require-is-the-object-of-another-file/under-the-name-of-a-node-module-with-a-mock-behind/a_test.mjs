import { jest, mock, test, vi } from "bun:test";
test("loads", () => {
  const { say } = require("./requires.cjs");
  mock.module("./other.cjs", () => ({ from: "mock" }));
  say();
});
