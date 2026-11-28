import { test } from "bun:test";
import { writeFileSync, unlinkSync, utimesSync } from "node:fs";
import { bump } from "./app.ts";
console.log("a", bump());
test("a", () => {
  writeFileSync(import.meta.dir + "/b_test.ts", "import { test, mock } from \"bun:test\";\nmock.module(\"./app.ts\", () => ({ bump: () => \"mocked\" }));\nimport { bump } from \"./app.ts\";\ntest(\"b\", () => console.log(\"SAID new\", bump()));\n");
});
