import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test --aot` in layers: the files that the test files share are programs of their own below the test files, in one realm.
// The realm has one entry point, the test file. The first file of a shared program that is loaded is not a second one:
// `if (require.main === module) main()` in it must not run.
const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "tsconfig.json": "{}",
  "src/imported.cjs": `exports.seen = [require.main === module, typeof require.main, module.id];
    if (require.main === module) console.log("imported.cjs takes itself for the main module");`,
  "src/imported.mjs": `export const seen = [import.meta.main, typeof import.meta.path];
    if (import.meta.main) console.log("imported.mjs takes itself for the main module");`,
  "src/asks.cjs": `const { basename } = require("node:path");
    exports.ask = () => [typeof require.main, require.main === module, require.main && basename(require.main.filename)];
    exports.atLoad = exports.ask();`,
  // Nothing follows the module object here, so the comparison is made at run time.
  "src/late.cjs": `let found;
    for (const each of [module]) found = each;
    exports.seen = [require.main === found, typeof require.main];
    if (require.main === found) console.log("late.cjs takes itself for the main module");`,
  "static.test.js": `import { test } from "bun:test";
    import { seen as cjs } from "./src/imported.cjs";
    import { seen as esm } from "./src/imported.mjs";
    test("files that a test file imports", () => {
      console.log("imported.cjs", ...cjs);
      console.log("imported.mjs", ...esm);
      console.log("the test file", import.meta.main, typeof require.main);
    });`,
  "commonjs.test.cjs": `const { test } = require("bun:test");
    const asks = require("./src/asks.cjs");
    test("a CommonJS test file", async () => {
      console.log("CommonJS test file", typeof require.main, require.main === module, ...asks.atLoad, ...asks.ask());
      console.log("CommonJS test file, import()", ...(await import("./src/late.cjs")).seen);
    });`,
  "late.test.js": `import { test } from "bun:test";
    test("files that import() and require() load", async () => {
      console.log("import()", ...(await import("./src/late.cjs")).seen);
      console.log("import(), asks", ...(await import("./src/asks.cjs")).atLoad);
      console.log("require(), asks", ...require("./src/asks.cjs").ask());
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

test("no file of a shared program is the main module", async () => {
  using dir = tempDir("aot-one-main-module", files);
  const plain = await runTests(String(dir));
  expect(plain.results.length).toBe(19);
  expect(plain.stdout).toContain("import() false undefined");
  expect(plain.stdout).toContain(
    "CommonJS test file object true object false commonjs.test.cjs object false commonjs.test.cjs",
  );
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}, 120_000);
