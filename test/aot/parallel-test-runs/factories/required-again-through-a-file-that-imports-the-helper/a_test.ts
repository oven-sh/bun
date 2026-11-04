import { test } from "bun:test";
import { value } from "./dep";
test("a", () => {
  require("./outer");
  console.log("a", value());
});
