import { test } from "bun:test";
import { first } from "./first.mjs";
test("a", () => {
  console.log("SAID a", first());
});
