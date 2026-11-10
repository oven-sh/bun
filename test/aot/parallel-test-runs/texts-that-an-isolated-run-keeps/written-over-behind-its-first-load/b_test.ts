import { test } from "bun:test";
import { writeFileSync } from "node:fs";
import { label } from "./shared.ts";
test("b", () => {
  console.log("SAID b", label);
  writeFileSync(new URL("./shared.ts", import.meta.url), `export const label = "as built";\n`);
});
