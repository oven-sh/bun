import { test, vi } from "bun:test";
import { writeFileSync } from "node:fs";
test("b", () => {
  console.log("SAID b", require("./shared.cjs").label);
});
