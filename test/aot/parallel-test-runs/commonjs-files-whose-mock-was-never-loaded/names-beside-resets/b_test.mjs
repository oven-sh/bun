import { test } from "bun:test";
const counter = require("./counter.cjs");

test("the next file requires the file itself", () => {
  counter.increment();
  console.log("b", counter.count);
});
