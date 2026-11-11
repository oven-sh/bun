import { test } from "bun:test";
import { writeFileSync } from "node:fs";
export const label = "as built";
test("a", () => {
  console.log("SAID a", label);
  writeFileSync(new URL("./a_test.ts", import.meta.url), `import { test } from "bun:test";\nexport const label = "written over";\ntest("a", () => {\n  console.log("SAID a", label);\n});\n`);
});
