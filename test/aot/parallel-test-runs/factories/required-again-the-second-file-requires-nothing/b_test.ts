import { test } from "bun:test";
import { value } from "./dep";
test("b", () => {
  console.log("b", value());
});
