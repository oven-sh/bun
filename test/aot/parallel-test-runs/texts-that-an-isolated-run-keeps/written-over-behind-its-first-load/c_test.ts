import { test } from "bun:test";
import { writeFileSync } from "node:fs";
import { label } from "./shared.ts";
test("c", () => {
  console.log("SAID c", label);
});
