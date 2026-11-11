import { test } from "bun:test";
import { answers } from "./lib/helper.mjs";
test("whoever called the built-in is who calls", () => {
  console.log("SAID", answers().join(" "));
});
