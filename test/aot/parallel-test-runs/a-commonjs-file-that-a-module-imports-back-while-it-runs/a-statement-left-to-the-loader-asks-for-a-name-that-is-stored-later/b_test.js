import { early } from "./half.cjs";
import { test } from "bun:test";
test("the early name", () => {
  console.log("b sees", early);
});
