import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A CommonJS file that has left `require.cache` is evaluated again by the next `require`: a second instance beside the first, with
// variables, functions and a `module` object of its own. Under `bun run --aot` the second instance is compiled code too:
// BUN_JSC_crashIfInterpreterIsUsed=1 crashes the program if any of its files is interpreted.

const files = {
  "lib/counter.js": `let count = 0;
var loads = (globalThis.loads = (globalThis.loads || 0) + 1);
function bump() { return ++count; }
class Box { constructor(value) { this.value = value; } }
exports.bump = bump;
exports.read = () => count;
exports.loads = loads;
exports.Box = Box;
exports.dependency = require("./dependency.js");
`,
  "lib/dependency.js": `globalThis.dependencies = (globalThis.dependencies || 0) + 1;
exports.name = "dependency";
`,
  "lib/told.js": `#!/usr/bin/env bun
"use strict";
module.exports = {
  told: [typeof exports, typeof require, typeof module, __filename.split("/").pop(), __dirname.split("/").pop(), arguments.length, this === exports, module.exports === exports],
  isStrict: (function () { return this === undefined; })(),
  id: module.id.split("/").pop(),
  isRequireOfModule: module.require === require,
  isInCache: require.cache[__filename] === module,
  parent: module.parent && module.parent.id.split("/").pop(),
  resolved: require.resolve("./dependency.js").split("/").pop(),
  text: String(function written() { return "as it is written"; }),
};
`,
  "lib/sloppy.js": `undeclared = (typeof undeclared === "number" ? undeclared : 0) + 1;
exports.isSloppy = (function () { return this === globalThis; })();
exports.undeclared = undeclared;
if (exports.undeclared > 1) return;
exports.first = true;
`,
  "lib/throws.js": `globalThis.attempts = (globalThis.attempts || 0) + 1;
exports.attempt = globalThis.attempts;
if (globalThis.attempts === 2) throw new Error("thrown at the second load");
`,
  "lib/stack.js": `exports.where = function where() { return new Error("here").stack.split("\\n").slice(1, 3).map(line => line.trim().replace(/\\(.*\\//, "(")).join(" | "); };
exports.atLoad = exports.where();
`,
  "lib/reload.js": `module.exports = function reload(require, name) {
  delete require.cache[require.resolve(name)];
  return require(name);
};
`,
};

const programs: Record<string, string> = {
  "two-instances.cjs": `const first = require("./lib/counter.js");
first.bump(); first.bump();
delete require.cache[require.resolve("./lib/counter.js")];
const second = require("./lib/counter.js");
console.log(first === second, first.bump(), second.bump(), first.read(), second.read(), first.loads, second.loads);
console.log(first.bump === second.bump, first.Box === second.Box, new first.Box(1) instanceof second.Box, first.dependency === second.dependency, globalThis.dependencies);
console.log(require("./lib/counter.js") === second);
`,
  "three-instances.cjs": `const reload = require("./lib/reload.js");
const all = [require("./lib/counter.js"), reload(require, "./lib/counter.js"), reload(require, "./lib/counter.js")];
all[0].bump(); all[2].bump(); all[2].bump();
console.log(all.map(one => one.read()).join(), all.map(one => one.loads).join(), new Set(all).size);
`,
  "what-the-file-is-told.cjs": `const first = require("./lib/told.js");
delete require.cache[require.resolve("./lib/told.js")];
const second = require("./lib/told.js");
console.log(JSON.stringify(first));
console.log(JSON.stringify(second));
`,
  "sloppy-code-and-return.cjs": `const first = require("./lib/sloppy.js");
delete require.cache[require.resolve("./lib/sloppy.js")];
console.log(JSON.stringify(first), JSON.stringify(require("./lib/sloppy.js")));
`,
  "the-second-load-throws.cjs": `const path = require.resolve("./lib/throws.js");
const first = require(path);
for (const time of [2, 3]) {
  delete require.cache[path];
  try { console.log(time, require("./lib/throws.js").attempt, path in require.cache); } catch (error) { console.log(time, error.message, path in require.cache); }
}
console.log(first.attempt);
`,
  "the-dependency-too.cjs": `const first = require("./lib/counter.js");
for (const key of Object.keys(require.cache)) if (key.includes("/lib/")) delete require.cache[key];
const second = require("./lib/counter.js");
console.log(first.dependency === second.dependency, globalThis.dependencies, second.loads);
`,
  "from-an-es-module.mjs": `import { createRequire } from "node:module";
import imported from "./lib/counter.js";
const require = createRequire(import.meta.url);
imported.bump();
delete require.cache[require.resolve("./lib/counter.js")];
const second = require("./lib/counter.js");
console.log(imported === second, imported.read(), second.read(), second.loads);
`,
  "stacks.cjs": `const first = require("./lib/stack.js");
delete require.cache[require.resolve("./lib/stack.js")];
const second = require("./lib/stack.js");
console.log(first.where() === second.where(), second.where());
console.log(second.atLoad.split(" | ")[0]);
`,
  "handlers-are-wrapped.cjs": `const Module = require("module");
const seen = [];
const first = require("./lib/counter.js");
const path = Module._resolveFilename("./lib/counter.js", module);
delete Module._cache[path];
const original = require.extensions[".js"];
require.extensions[".js"] = function (loaded, filename) { seen.push(filename.split("/").pop()); return original(loaded, filename); };
const second = module.require(path);
require.extensions[".js"] = original;
console.log(first === second, second.loads, seen.join());
`,
};

describe.concurrent.each(Object.keys(programs))("%s", entry => {
  test("bun run --aot interprets nothing and prints what bun run prints", async () => {
    using dir = tempDir("required-again", { ...files, [entry]: programs[entry] });
    const run = async (flags: string[], env: Record<string, string | undefined>) => {
      await using proc = Bun.spawn({ cmd: [bunExe(), "run", ...flags, entry], cwd: String(dir), env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    const plain = await run([], bunEnv);
    const aot = await run(["--aot"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect(plain.exitCode).toBe(0);
    expect(aot.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});
