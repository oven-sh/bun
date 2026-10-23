import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const files = {
  "kinds.mjs": `export const thing = 1;
export default 2;
console.log("kinds.mjs is evaluated");
`,
};

const programs: Record<string, string> = {
  "a-tag-without-a-module-specifier.js": `/**
 * @import url(partial.css) screen
 */
function lengthOf(text) {
  return text.length;
}
console.log(lengthOf("abc"));
`,
  "a-tag-inside-a-function.cjs": `exports.parse = function (text) {
  /**
   * @import url(partial.css) screen
   */
  var state = "";
  return state + text;
};
console.log(exports.parse("abc"));
`,
  "a-variable-of-the-same-name.js": `/** @import url(partial.css) screen */
var url = { _cache: 1 };
console.log(url._cache);
`,
  "the-name-of-a-namespace-tag-without-a-module-specifier.js": `/** @import * as sheet (partial.css) */
function kind() {
  return typeof sheet;
}
console.log(kind());
`,
  "the-name-of-a-named-tag-without-a-module-specifier.js": `/** @import { sheet } (partial.css) */
function kind() {
  return typeof sheet;
}
console.log(kind());
`,
  "a-call-of-the-name-of-a-tag-without-a-module-specifier.js": `/** @import { sheet } (partial.css) */
try {
  sheet();
} catch (error) {
  console.log(error.name);
}
`,
  "a-named-tag.mjs": `/** @import { thing } from "./kinds.mjs" */
console.log(typeof thing);
try {
  thing;
} catch (error) {
  console.log(error.name);
}
`,
  "a-default-tag.mjs": `/** @import kinds from "./kinds.mjs" */
console.log(typeof kinds);
try {
  kinds;
} catch (error) {
  console.log(error.name);
}
`,
  "a-namespace-tag.mjs": `/** @import * as kinds from "./kinds.mjs" */
console.log(typeof kinds);
try {
  kinds.thing;
} catch (error) {
  console.log(error.name);
}
`,
  "a-global-of-the-same-name.mjs": `/** @import { thing } from "./kinds.mjs" */
globalThis.thing = "the global";
console.log(thing, thing + 1, thing.length);
`,
  "a-global-of-the-same-name-read-in-a-closure.mjs": `/** @import { thing } from "./kinds.mjs" */
const read = () => () => thing;
globalThis.thing = "the global";
console.log(read()());
`,
  "a-builtin-global-of-the-same-name.mjs": `/** @import { URL } from "node:url" */
console.log(new URL("http://localhost/path").pathname);
`,
  "a-tag-of-a-builtin-module.cjs": `/** @import Module from "node:module" */
console.log(typeof Module);
`,
  "a-store-to-the-name.cjs": `/** @import { thing } from "./kinds.mjs" */
thing = 5;
console.log(globalThis.thing, thing);
`,
  "a-tag-beside-an-import-of-another-name.mjs": `/** @import { thing as Thing } from "./kinds.mjs" */
import { thing } from "./kinds.mjs";
console.log(thing, typeof Thing);
`,
  "a-tag-beside-an-import-of-the-same-name.mjs": `/** @import { thing } from "./kinds.mjs" */
import { thing } from "./kinds.mjs";
console.log(thing);
`,
};

const env = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

describe.concurrent.each(Object.keys(programs))("%s", entry => {
  test("bun run --aot prints what bun run prints", async () => {
    using dir = tempDir("jsdoc-import-tags", { ...files, [entry]: programs[entry] });
    const plain = await run([bunExe(), "run", entry], String(dir), bunEnv);
    const aot = await run([bunExe(), "run", "--debug-aot", entry], String(dir), env);
    expect(plain.exitCode).toBe(0);
    expect(aot.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });

  test("an executable built with --aot prints what bun run prints", async () => {
    using dir = tempDir("jsdoc-import-tags", { ...files, [entry]: programs[entry] });
    const plain = await run([bunExe(), "run", entry], String(dir), bunEnv);
    const build = await run(
      [bunExe(), "build", "--compile", "--aot", entry, "--outfile", "program"],
      String(dir),
      bunEnv,
    );
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
    const aot = await run([join(String(dir), "program")], String(dir), env);
    expect(plain.exitCode).toBe(0);
    expect(aot.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});
