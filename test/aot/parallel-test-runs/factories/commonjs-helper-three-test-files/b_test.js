import { test } from "bun:test";
import { value } from "./dep.js";
test("b", () => {
  console.log("b before", value());
  require("./helper.cjs");
  console.log("b after", value());
});
