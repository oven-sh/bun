import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("b", async () => {
  console.log("SAID b", (await import("./above.ts")).look());
  writeFileSync(new URL("./shared.ts", import.meta.url), `export const label = "written over";\n`);
  writeFileSync(new URL("./above.ts", import.meta.url), `import { label } from "./shared.ts";\nexport const look = () => "above written over, " + label;\n`);
});
