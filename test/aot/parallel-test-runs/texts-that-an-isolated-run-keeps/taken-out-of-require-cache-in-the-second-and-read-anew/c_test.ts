import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("c", () => {
  console.log("SAID c", require("./shared.cjs").label);
});
