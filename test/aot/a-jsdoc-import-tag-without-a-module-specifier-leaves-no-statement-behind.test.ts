// An `@import` tag whose clause is not followed by `from "..."` reads an expression as its module specifier, as TypeScript does.
// With the leading `*` of the next comment line that expression runs into the next tag: `token * @returns`. The `@returns` is a
// decorator of nothing. It belongs to the comment, as every node of a tag does, and no statement of the file comes from it.
import { expect, test } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { unsupported } from "./harness/commands";
import { run } from "./harness/run";

const files = {
  "lib.js": `/**
 * @param {Object} token @import lexical token
 * @returns {Object} node
 */
function f(token) { return token; }
module.exports = { f };
`,
  "lib.mjs": `/**
 * @import lexical token
 * @param {Object} token
 */
export function f(token) { return token; }
export const g = 1;
`,
  "main.js": `const lib = require("./lib.js");
import { f, g } from "./lib.mjs";
console.log(lib.f("ok"), f("ok"), g);
`,
};

test.skipIf(unsupported)(
  "the tag that follows an @import tag without a module specifier is no statement of the file",
  async () => {
    using dir = tempDir("aot-jsdoc-import-tag", files);
    expect(await run([bunExe(), "main.js"], String(dir))).toEqual({ stdout: "ok ok 1\n", stderr: "", exitCode: 0 });
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    expect(
      await run([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable], String(dir)),
    ).toMatchObject({ exitCode: 0 });
    expect(await run([executable], String(dir))).toEqual({ stdout: "ok ok 1\n", stderr: "", exitCode: 0 });
  },
  240_000,
);
