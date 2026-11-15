import { test } from "bun:test";
import { value } from "./dep";
test("b", () => {
  let seen = "";
  for (let i = 0; i < 300; i++) seen = require("./other").other + " " + value();
  console.log("b", seen);
  require("./helper");
  console.log("b after", value());
});
