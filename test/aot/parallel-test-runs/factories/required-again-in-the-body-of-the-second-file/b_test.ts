import { test } from "bun:test";
import { value } from "./dep";
console.log("b body before", value());
require("./helper");
console.log("b body after", value());
test("b", () => {
  console.log("b", value());
});
