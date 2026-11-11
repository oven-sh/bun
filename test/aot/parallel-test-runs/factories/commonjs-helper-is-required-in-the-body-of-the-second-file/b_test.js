import { test } from "bun:test";
import { value } from "./dep.js";
console.log("b body before", value());
require("./helper.cjs");
console.log("b body after", value());
test("b", () => {
  console.log("b", value());
});
