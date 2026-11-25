import { test } from "bun:test";
import { far } from "./far.mjs";
test("first", () => {
  console.log("SAID first", far);
});
