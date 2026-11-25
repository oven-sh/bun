import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("a", () => {
  writeFileSync(import.meta.dir + "/" + (globalThis.never ?? "b_test.ts"), `import { test } from "bun:test";\ntest("b", () => console.log("SAID new text"));\n`);
});
