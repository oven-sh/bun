// `require("/somewhere/late.json")`, where the file is missing when the program is built, is left to the host. The module object that the host makes for the file has the module object
// of the compiled file that asked for its parent, and a loader that the program has stored in require.extensions reads the exports off it and calls one with other types than the program does.
//
// Each program is built alone, in a folder of its own whose path is spelled into it: were the file there at the build, the build would read it as data and nothing would turn to the host.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const start = `"use strict";
const fs = require("node:fs");
const asks = require("./asks.cjs");
let total = 0;
for (let i = 0; i < 300; i++) total = asks.sum(total, i) | 0;
let out = "not called";
require.extensions[".json"] = function load(made) {
  const above = made.parent;
  out = [Object.keys(above.exports).join("+"), above.exports === asks, above.exports.sum("a", "b")].join(" ");
  made.exports = 1;
};
fs.writeFileSync("FOLDER/late.json", "{}");
try { asks.ask(); } catch (error) { out += "|" + error.name; }
fs.rmSync("FOLDER/late.json");
console.log(String(total), out);
`;
const asks = (ask: string) => `"use strict";
exports.sum = function sum(a, b) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? a + b : 0;
};
exports.ask = function ask() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  ${ask}
};
`;

const programs: Record<string, string> = {
  "the path is written in the call": `return require("FOLDER/late.json");`,
  "require goes to evaluated text by value": `return (0, eval)("(load) => load('FOLDER/late.json')")(require);`,
};

describe("a loader of the program finds the file that asked above what it loads", () => {
  test.each(Object.entries(programs))(
    "%s",
    async (_, ask) => {
      using dir = tempDir("aot-parent-of-what-the-host-loads", { "main.mjs": `import "./start.cjs";\n` });
      const directory = String(dir);
      const spelled = (text: string) => text.replaceAll("FOLDER", directory.replaceAll("\\", "/"));
      await Bun.write(join(directory, "start.cjs"), spelled(start));
      await Bun.write(join(directory, "asks.cjs"), spelled(asks(ask)));
      const plain = await run([bunExe(), "main.mjs"], directory, bunEnv);
      const executable = join(directory, isWindows ? "program.exe" : "program");
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
        directory,
      );
      expect(built.exitCode).toBe(0);
      const compiled = await run([executable], directory, bunEnv);
      expect([plain.stdout.trim(), plain.exitCode]).toEqual(["44850 sum+ask true ab", 0]);
      expect([compiled.stdout.trim(), compiled.exitCode]).toEqual([plain.stdout.trim(), 0]);
    },
    240_000,
  );
});
