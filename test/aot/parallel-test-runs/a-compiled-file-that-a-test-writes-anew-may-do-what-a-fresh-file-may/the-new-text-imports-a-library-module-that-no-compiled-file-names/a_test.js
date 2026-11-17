// fixture.js is there when the run is built, so it is compiled. The test writes it anew, and `bun test` runs what lies there when the file is first loaded: a text that nobody has read, which names a module that no compiled file names.
import { test } from "bun:test";
import { writeFileSync } from "node:fs";
const text = ['import os from "node:os";', "export const mark = typeof os.EOL + typeof os.platform();"].join("\n");
test("the new text runs", async () => {
  writeFileSync(import.meta.dir + "/fixture.js", text);
  try {
    console.log((await import("./fixture.js")).mark);
  } finally {
    writeFileSync(import.meta.dir + "/fixture.js", 'export const mark = "old";\n');
  }
});
