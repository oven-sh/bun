import { test } from "vitest";
import { writeFileSync } from "node:fs";
test("a", async () => {
  console.log("SAID a", (await import("./shared.ts")).label);
  writeFileSync(new URL("./shared.ts", import.meta.url), `export const label = "written over";\n`);
});
