import { test } from "bun:test";
import { label } from "./shared.ts";
test("b", () => {
  console.log("SAID b", label);
});
