import { jest, mock, test, vi } from "bun:test";
test("loads", () => {
  mock.module("./other.cjs", () => ({ from: "mock" }));
  const { say } = require("./requires.cjs");
  say();
});
