import { jest, mock, test, vi } from "bun:test";
test("loads", () => {
  const { say } = require("./requires.cjs");
  delete require.cache[require.resolve("./other.cjs")];
  say();
});
