// With `--rerun-each`, a test file runs again in the same global object, and what it imports stays loaded. A test file written in CommonJS is run again like any other: its compiled body,
// with a module object, variables, classes and template objects of its own in each run.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const start = `globalThis.files = (globalThis.files ?? 0) + 1;\nconst run = globalThis.files;\n`;
const project = (testFile: string) => ({
  "package.json": `{ "name": "cell", "private": true }\n`,
  "bunfig.toml": `[test]\nrerunEach = 3\n`,
  "gauge.cjs": `globalThis.bodies = (globalThis.bodies ?? 0) + 1;\nexports.word = "file";\n`,
  "a_test.cjs": testFile,
});

async function runTests(testFile: string) {
  using dir = tempDir("aot-a-commonjs-test-file-runs-again", project(testFile));
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
  const said = stdout.split("\n").filter(line => line.startsWith("SAID"));
  return { said, stderr, exitCode };
}

test("the file runs three times, and what it requires stays loaded", async () => {
  const { said, stderr, exitCode } = await runTests(`const { test } = require("bun:test");
${start}test("t", () => { console.log("SAID", run, require("./gauge.cjs").word, globalThis.bodies); });\n`);
  expect(said).toEqual(["SAID 1 file 1", "SAID 2 file 1", "SAID 3 file 1"]);
  expect(stderr).toContain(" 3 pass");
  expect(stderr).toContain("Ran 3 tests across 1 file.");
  expect(stderr).not.toContain("interpreter");
  expect(exitCode).toBe(0);
});

test("each run has a module object, variables, a class and template objects of its own", async () => {
  const { said, stderr, exitCode } = await runTests(`const { test, beforeAll } = require("bun:test");
${start}let count = 0;
const tag = strings => strings, made = () => tag\`x\`;
class Kept {}
globalThis.first ??= { module, strings: made(), Kept };
module.exports.mark = run;
beforeAll(() => { count++; });
test("t", () => {
  const { first } = globalThis;
  console.log("SAID", run, count, module.exports.mark, (module === first.module) === (run === 1), (made() === first.strings) === (run === 1), (Kept === first.Kept) === (run === 1), require.main === module, require.cache[__filename] === module);
});\n`);
  expect(said).toEqual([1, 2, 3].map(run => `SAID ${run} 1 ${run} true true true true true`));
  expect(stderr).toContain(" 3 pass");
  expect(exitCode).toBe(0);
});

test("a file that throws in its second run fails that run", async () => {
  const { said, stderr, exitCode } = await runTests(`const { test } = require("bun:test");
${start}if (run === 2) throw new RangeError("second");
test("t", () => { console.log("SAID", run); });\n`);
  expect(said).toEqual(["SAID 1"]);
  expect(stderr).toContain("RangeError: second");
  expect(stderr).toContain(" 1 pass");
  expect(stderr).toContain(" 1 fail");
  expect(exitCode).toBe(1);
});
