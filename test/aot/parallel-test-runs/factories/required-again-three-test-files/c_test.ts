import { test } from "bun:test";
import { value } from "./dep";
test("c", () => {
  console.log("c before", value());
  require("./helper");
  console.log("c after", value());
});
