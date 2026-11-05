import { test } from "bun:test";
import { value } from "./dep.js";
test("c", () => {
  console.log("c before", value());
  require("./helper.cjs");
  console.log("c after", value());
});
