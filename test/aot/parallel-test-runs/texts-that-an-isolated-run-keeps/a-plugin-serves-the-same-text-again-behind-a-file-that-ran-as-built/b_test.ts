import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("b", async () => {
  console.log("SAID b", (await import("./shared.ts")).label);
  writeFileSync(new URL("./shared.ts", import.meta.url), `export const label = "written over";\n`);
});
