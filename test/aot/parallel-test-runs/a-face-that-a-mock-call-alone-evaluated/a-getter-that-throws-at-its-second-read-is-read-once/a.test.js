import { mock, test } from "bun:test";
const box = require("./box.cjs");
test("t", () => {
  mock.module("./box.cjs", () => ({ a: "mocked" }));
  console.log("a", typeof box, typeof require("./box.cjs"));
});
