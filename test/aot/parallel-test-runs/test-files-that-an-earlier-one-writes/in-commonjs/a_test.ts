import { test } from "bun:test";
import { writeFileSync, unlinkSync, utimesSync } from "node:fs";
test("a", () => {
  writeFileSync(import.meta.dir + "/b_test.cjs", "const { test } = require(\"bun:test\");\nconst { bump } = require(\"./app.ts\");\ntest(\"b\", () => console.log(\"SAID new\", bump()));\n");
});
