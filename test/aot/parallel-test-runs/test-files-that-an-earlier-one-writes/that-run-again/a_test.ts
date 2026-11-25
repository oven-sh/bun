import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("a", () => {
  console.log("SAID first text");
  writeFileSync(import.meta.dir + "/a_test.ts", `import { test } from "bun:test";\ntest("a", () => console.log("SAID second text"));\n`);
});
