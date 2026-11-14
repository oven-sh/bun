import { test } from "bun:test";
import { label } from "./shared.ts";
test("c", () => {
  console.log("SAID c", label);
});
