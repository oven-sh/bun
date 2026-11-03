import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test --aot` in layers: the packages are one program, the files of the project a second above it, the test files further ones.
// A build takes what a program below holds from there. That is every file of the program below, not only the ones that it was begun with:
// built again above, a file would run twice and have its state twice.
const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "tsconfig.json": "{}",
  // `import` finds the wrapper, which imports the file that `require` finds.
  "node_modules/wrapped/package.json": `{ "name": "wrapped", "version": "1.0.0", "main": "./index.cjs", "exports": { ".": { "import": "./wrapper.mjs", "require": "./index.cjs" }, "./inner": "./lib/inner.js" } }`,
  "node_modules/wrapped/wrapper.mjs": `import cjs from "./index.cjs";\nexport const state = cjs.state;\nexport const inc = cjs.inc;\nexport const isWrapper = true;\nexport default cjs;`,
  "node_modules/wrapped/index.cjs": `globalThis.timesRun = (globalThis.timesRun ?? 0) + 1;\nexports.state = { count: 0 };\nexports.inc = () => ++exports.state.count;\nexports.deep = require("./lib/deep.cjs");`,
  "node_modules/wrapped/lib/deep.cjs": `exports.made = {};`,
  "node_modules/wrapped/lib/inner.js": `import { made } from "./deep.cjs";\nexport { made };`,
  "src/both.mjs": `import whole, { state, inc, isWrapper } from "wrapped";
    const required = require("wrapped");
    export const seen = [required.state === state, required.inc(), inc(), state.count, isWrapper, required.isWrapper, whole === required, globalThis.timesRun];`,
  "src/made.mjs": `import { createRequire } from "node:module";
    import { state } from "wrapped";
    const load = createRequire(import.meta.url);
    export const seen = [load("wrapped").state === state, globalThis.timesRun];`,
  "project.test.js": `import { test } from "bun:test";
    import { seen as both } from "./src/both.mjs";
    import { seen as made } from "./src/made.mjs";
    test("in files of the project", () => { console.log("both", ...both); console.log("made", ...made); });`,
  "own.test.js": `import { test } from "bun:test";
    import { state, inc } from "wrapped";
    import { made } from "wrapped/inner";
    test("in a test file", () => {
      const required = require("wrapped");
      console.log("own", required.state === state, required.inc(), inc(), state.count, required.deep.made === made, globalThis.timesRun);
    });`,
};

// A run of a few test files is one program.
for (let i = 0; i < 16; i++)
  files[`more-${i}.test.js`] = `import { test } from "bun:test";\ntest("one of many, ${i}", () => {});`;

async function runTests(directory: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2" };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  const printed = stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
  return { stdout: printed.sort(), results: results.sort(), exitCode };
}

test("a file that a package reaches by itself is one file for every layer", async () => {
  using dir = tempDir("aot-a-file-of-a-layer-below", files);
  const plain = await runTests(String(dir));
  expect(plain.results).toContain("pass in a test file");
  expect(plain.results).toContain("pass in files of the project");
  expect(plain.results.length).toBe(18);
  expect(plain.stdout).toContain("both true 1 2 2 true undefined true 1");
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}, 120_000);
