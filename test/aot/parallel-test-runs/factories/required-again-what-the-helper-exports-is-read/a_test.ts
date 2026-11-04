import { test } from "bun:test";
import { value } from "./dep";
test("a", () => {
  console.log("a", require("./helper").ready, value());
});
