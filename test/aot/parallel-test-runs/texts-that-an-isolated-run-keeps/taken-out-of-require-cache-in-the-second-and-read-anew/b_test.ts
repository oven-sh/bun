import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("b", () => {
  delete require.cache[require.resolve("./shared.cjs")];
  console.log("SAID b", require("./shared.cjs").label);
});
