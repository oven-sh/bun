import { test } from "bun:test";
import { find } from "./users.ts";
test("b", () => {
  console.log("SAID", find());
});
