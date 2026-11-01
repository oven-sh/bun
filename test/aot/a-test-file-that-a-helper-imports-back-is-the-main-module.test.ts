import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "suite" }`,
  "helpers/requires-back.cjs": `exports.mark = () => require("../required-back.test.cjs").mark;`,
  "helpers/only-for-main.cjs": `exports.mark = "loaded for the main module";`,
  "required-back.test.cjs": `const { test } = require("bun:test");
    exports.mark = "required back";
    const helper = require("./helpers/requires-back.cjs");
    const atLoad = require.main === module ? require("./helpers/only-for-main.cjs").mark : "not the main module";
    test("a CommonJS test file", () => {
      const answers = [require.main === module, module === require.main, require.main == module, require.main !== module];
      console.log("required-back.test.cjs", ...answers, process.mainModule === module, atLoad, helper.mark());
    });`,
  "helpers/imports-back.ts": `import { mark } from "../imported-back.test.ts";
    export const markOfTestFile = () => mark;`,
  "imported-back.test.ts": `import { test } from "bun:test";
    import { markOfTestFile } from "./helpers/imports-back.ts";
    export const mark = "imported back";
    const atLoad = import.meta.main ? "the main module" : "not the main module";
    test("a test file that is an ES module", () => {
      console.log("imported-back.test.ts", import.meta.main, !import.meta.main, atLoad, markOfTestFile());
    });`,
  "helpers/imports-another-test-file.ts": `import { wasMainAtLoad } from "../z-imported-by-another.test.ts";
    export const wasOtherMain = () => wasMainAtLoad;`,
  "a-imports-another.test.ts": `import { test } from "bun:test";
    import { wasOtherMain } from "./helpers/imports-another-test-file.ts";
    test("a test file whose helper imports another test file", () => {
      console.log("a-imports-another.test.ts", import.meta.main, wasOtherMain());
    });`,
  "z-imported-by-another.test.ts": `import { test } from "bun:test";
    export const wasMainAtLoad = import.meta.main;
    test("a test file that the helper of another imports", () => {
      console.log("z-imported-by-another.test.ts under", Bun.main.split(/[\\\\/]/).at(-1), import.meta.main, wasMainAtLoad);
    });`,
};

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, { ...bunEnv, ...env });
  if (exitCode !== 0) console.error(stderr);
  const lines = (stdout + "\n" + stderr).split("\n").filter(line => /^[a-z-]+\.test\.(cjs|ts) /.test(line));
  return { stdout: lines.sort(), exitCode };
}

const asMainModule = [
  "imported-back.test.ts true false the main module imported back",
  "required-back.test.cjs true true true false true loaded for the main module required back",
];

test("in one process", async () => {
  using dir = tempDir("aot-test-file-imported-back", files);
  const plain = await runTests(String(dir), {});
  expect(plain.exitCode).toBe(0);
  expect(plain.stdout).toEqual(expect.arrayContaining(asMainModule));
  expect(await runTests(String(dir), {}, "--aot")).toEqual(plain);
  const fromDisk = { BUN_AOT_TEST_FILES_FROM_DISK: "1" };
  expect(await runTests(String(dir), fromDisk, "--aot")).toEqual(plain);
  expect(await runTests(String(dir), { ...fromDisk, BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1" }, "--aot")).toEqual(plain);
}, 240_000);

test("in workers, over layers that hold what the test files import", async () => {
  using dir = tempDir("aot-test-file-imported-back-in-layers", files);
  const plain = await runTests(String(dir), {}, "--parallel=2");
  expect(plain.exitCode).toBe(0);
  expect(plain.stdout).toEqual(
    expect.arrayContaining([
      ...asMainModule,
      "z-imported-by-another.test.ts under a-imports-another.test.ts false false",
      "z-imported-by-another.test.ts under z-imported-by-another.test.ts true true",
    ]),
  );
  for (const words of ["TestRunLayers:1", "TestRunLayers:2,TestRunPartFiles:1", "TestRunLayers:3"]) {
    const env = { BUN_DEBUG_TEST_AOT_WORDS: words };
    expect({ words, ...(await runTests(String(dir), env, "--aot", "--parallel=2")) }).toEqual({ words, ...plain });
  }
}, 480_000);
