// Link follows what a CommonJS file exports into the variables of the ES modules that import it, and proves what `sum` is called with.
// Evaluated text lays a loader into the table of node:module; a require of a path that is missing at the build turns to the host, which calls that loader; the loader asks for the file by a name made at run time.
// It is refused, and the program goes on: the loader of the engine still gets the module that stands for the file in the graph of main.mjs.
//
// Each program is built alone, in a folder of its own whose path is spelled into it: the file must be missing at the build, or the build reads it as data and nothing turns to the host.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const sum = `"use strict";
module.exports = function sum(a, b) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? a + b : 0;
};
`;
const main = `import sum from "./sum.cjs";
import "./start.cjs";
let total = 0;
for (let i = 0; i < 300; i++) total = sum(total, i) | 0;
setTimeout(() => console.log(String(total), out), 10);
`;
const says = `e => { out = "refused " + e.name + ":" + String(e.message).replace(/'[^']*'/, "<path>").slice(0, 35); }`;
const asks: Record<string, string> = {
  "a require that the text creates": `try { const got = Module.createRequire(from)("./sum.cjs"); out = typeof got + ":" + got("a", "b"); } catch (e) { (${says})(e); }`,
  "import()": `import(from.replace("start.cjs", "sum.cjs")).then(got => { out = typeof got.default + ":" + got.default("a", "b"); }, ${says});`,
};

test.each(Object.entries(asks))(
  "%s",
  async (_, ask) => {
    using dir = tempDir("aot-file-behind-a-face-is-asked-for", { "main.mjs": main, "sum.cjs": sum });
    const directory = String(dir).replaceAll("\\", "/");
    const text = `(from) => { const Module = process.getBuiltinModule("node:module"); Module._extensions[".json"] = function (made) { ${ask} made.exports = 1; }; }`;
    await Bun.write(
      join(directory, "start.cjs"),
      `"use strict";
const fs = require("node:fs");
globalThis.out = "not called";
(0, eval)(${JSON.stringify(text)})(__filename);
fs.writeFileSync("${directory}/late.json", "{}"); try { require("${directory}/late.json"); } finally { fs.rmSync("${directory}/late.json"); }
`,
    );
    const plain = await run([bunExe(), "main.mjs"], directory, bunEnv);
    expect([plain.stdout.trim(), plain.exitCode]).toEqual(["44850 function:ab", 0]);
    const executable = join(directory, isWindows ? "program.exe" : "program");
    const built = await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], directory);
    expect(built.exitCode).toBe(0);
    const compiled = await run([executable], directory, bunEnv);
    expect([compiled.stdout.trim(), compiled.exitCode]).toEqual([
      "44850 refused Error:Cannot load <path>: this executable",
      0,
    ]);
  },
  240_000,
);
