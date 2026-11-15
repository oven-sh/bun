import { test } from "bun:test";
import { both } from "./index.ts";
test("the package keeps the original, the program gets the mock", () => {
  console.log("SAID", both());
});
