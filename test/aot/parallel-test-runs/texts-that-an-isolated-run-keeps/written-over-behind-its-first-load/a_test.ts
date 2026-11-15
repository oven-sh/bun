import { test } from "bun:test";
import { writeFileSync } from "node:fs";
import { label } from "./shared.ts";
test("a", () => {
  console.log("SAID a", label);
  writeFileSync(new URL("./shared.ts", import.meta.url), `export const label = "written over";\n`);
});
