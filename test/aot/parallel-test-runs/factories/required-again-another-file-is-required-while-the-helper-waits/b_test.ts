import { test } from "bun:test";
import { value } from "./dep";
test("b", () => {
  console.log("b before", value());
  console.log("b", require("./other").other, value());
  require("./helper");
  console.log("b after", value());
});
