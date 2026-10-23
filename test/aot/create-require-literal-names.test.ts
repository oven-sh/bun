import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { run as spawned } from "./harness/run";
import { describe, test } from "./supported";

// `const require = createRequire(import.meta.url); require("./lib.cjs")`. The name is written in the program, so an ahead-of-time
// build compiles the file like any other that is required. BUN_JSC_crashIfInterpreterIsUsed=1 crashes the compiled program if
// any of its files is interpreted instead.

const files = {
  "lib.cjs": `exports.name = "lib"; exports.twice = n => n * 2; globalThis.evaluations = (globalThis.evaluations || 0) + 1;`,
  "other.cjs": `module.exports = function other() { return "other"; };`,
  "data.json": `{ "k": 1 }`,
  "node_modules/dep/package.json": `{ "name": "dep", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/dep/index.js": `exports.dep = "dep";`,
  "node_modules/dual/package.json": `{ "name": "dual", "version": "1.0.0", "exports": { ".": { "import": "./wrapper.mjs", "require": "./index.cjs" } } }`,
  "node_modules/dual/index.cjs": `exports.state = { n: 0 }; exports.kind = "required";`,
  "node_modules/dual/wrapper.mjs": `import both from "./index.cjs";\nexport const state = both.state;\nexport const kind = "imported";`,
};

const programs: Record<string, string> = {
  "named-require.mjs": `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const lib = require("./lib.cjs");
console.log(lib.name, lib.twice(2), require("./data.json").k, require("dep").dep, typeof require("node:fs").readFileSync, require("./other.cjs")());
console.log(require("./lib.cjs") === lib, globalThis.evaluations);
`,
  "another-name.mjs": `import { createRequire as make } from "module";
const load = make(import.meta.url);
console.log(load("./lib.cjs").name, load("./other.cjs")());
`,
  "namespace-import.mjs": `import * as mod from "node:module";
const r = mod.createRequire(import.meta.url);
console.log(r("./lib.cjs").name);
`,
  "default-import.mjs": `import mod from "node:module";
const r = mod.createRequire(import.meta.url);
console.log(r("./lib.cjs").name);
`,
  "by-filename.cjs": `const { createRequire } = require("module");
const r = createRequire(__filename);
console.log(r("./lib.cjs").name);
`,
  "by-import-meta-filename.mjs": `import { createRequire } from "node:module";
const r = createRequire(import.meta.filename);
console.log(r("./lib.cjs").name);
`,
  "in-a-function.mjs": `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
function late() { return require("./lib.cjs").twice(4); }
console.log(globalThis.evaluations, late(), globalThis.evaluations, late(), globalThis.evaluations);
`,
  "typescript.ts": `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const lib = require("./lib.cjs") as { name: string; twice(n: number): number };
console.log(lib.name, lib.twice(3));
`,
  "with-resolve.mjs": `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
console.log(require("./lib.cjs").name, typeof require.resolve);
`,
  "called-in-its-dead-zone.mjs": `import { createRequire } from "node:module";
function early() { return require("./lib.cjs").name; }
try { console.log(early()); } catch (error) { console.log(error.name); }
const require = createRequire(import.meta.url);
console.log(early());
`,
  "one-of-two-names.mjs": `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
console.log(require(process.argv.length > 99 ? "./other.cjs" : "./lib.cjs").name);
`,
  "a-package-that-is-also-imported.mjs": `import { createRequire } from "node:module";
import { state, kind } from "dual";
const require = createRequire(import.meta.url);
const required = require("dual");
console.log(kind, required.kind, required.state === state);
`,
  "one-of-two-names-under-another-name.mjs": `import { createRequire } from "node:module";
const load = createRequire(import.meta.url);
console.log(load(process.argv.length > 99 ? "./other.cjs" : "./lib.cjs").name);
`,
  "missing-in-a-try.mjs": `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
try { require("./not-there.cjs"); } catch (error) { console.log(error.code); }
console.log(require("./lib.cjs").name);
`,
};

const compiledOnly = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

describe.concurrent.each(Object.keys(programs))("%s", entry => {
  const tree = {
    ...files,
    [entry]: programs[entry],
    "tsconfig.json": `{ "compilerOptions": { "module": "preserve", "moduleResolution": "bundler" } }`,
  };

  test("bun run --aot interprets nothing and prints what bun run prints", async () => {
    using dir = tempDir("create-require", tree);
    const plain = await spawned([bunExe(), "run", entry], String(dir));
    expect(plain.exitCode).toBe(0);
    const aot = await spawned([bunExe(), "run", "--debug-aot", entry], String(dir), compiledOnly);
    expect(aot.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });

  // These two calls are left to the host's `require`, which looks on the disk.
  test.skipIf(entry === "a-package-that-is-also-imported.mjs" || entry === "one-of-two-names-under-another-name.mjs")(
    "bun build --compile --aot interprets nothing and prints what bun run prints, away from its sources",
    async () => {
      using dir = tempDir("create-require", tree);
      using elsewhere = tempDir("create-require-elsewhere", {});
      const plain = await spawned([bunExe(), "run", entry], String(dir));
      const built = await spawned(
        [bunExe(), "build", "--compile", "--aot", entry, "--outfile", join(String(elsewhere), "program")],
        String(dir),
      );
      expect(built.stderr).not.toContain("error:");
      expect(built.exitCode).toBe(0);
      const aot = await spawned([join(String(elsewhere), "program")], String(elsewhere), compiledOnly);
      expect(aot.stderr).not.toContain("crashIfInterpreterIsUsed");
      expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
    },
  );
});

test.each([
  [
    "called-through-call.mjs",
    `console.log(load("./lib.cjs").name, load.call(null, "./lib.cjs").name, globalThis.evaluations);
`,
    "lib lib 1\n",
  ],
])("a require off which more than resolve is read stays the host's: %s", async (entry, text, output) => {
  using dir = tempDir("create-require", {
    ...files,
    [entry]: `import { createRequire } from "node:module";\nconst load = createRequire(import.meta.url);\n` + text,
  });
  const plain = await spawned([bunExe(), "run", entry], String(dir));
  const aot = await spawned([bunExe(), "run", "--debug-aot", entry], String(dir));
  expect(plain.stdout).toBe(output);
  expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
});
