// fixture.js is there when the run is built, so it is compiled. The test writes it anew, and `bun test` runs what lies there when the file is first loaded: a text that nobody has read, which evaluates a text.
import { test } from "bun:test";
import { writeFileSync } from "node:fs";
const text = 'export const mark = String((0, eval)("1 + 1")) + new Function("return 3")();';
test("the new text runs", async () => {
  writeFileSync(import.meta.dir + "/fixture.js", text);
  try {
    console.log((await import("./fixture.js")).mark);
  } finally {
    writeFileSync(import.meta.dir + "/fixture.js", 'export const mark = "old";\n');
  }
});
