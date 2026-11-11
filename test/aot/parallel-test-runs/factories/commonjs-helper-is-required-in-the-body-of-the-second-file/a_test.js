import { test } from "bun:test";
import { value } from "./dep.js";
test("a", () => {
  require("./helper.cjs");
  console.log("a", value());
});
