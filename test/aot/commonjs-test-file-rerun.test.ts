// With `--rerun-each`, `bun test` keeps a CommonJS test file in require.cache, so it is evaluated once. A file that requires a module whose mock has ended is evaluated again.
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

async function runTests(testFile: string, ...flags: string[]) {
  using dir = tempDir("aot-commonjs-test-file-rerun", project(testFile));
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
  const said = stdout.split("\n").filter(line => line.startsWith("SAID"));
  const counts = stderr.split("\n").filter(line => /^ *\d+ (pass|fail)$/.test(line));
  return { said, counts, exitCode };
}

const files: Record<string, { testFile: string; said: string[] }> = {
  "a file that requires a module": {
    testFile: `const { test } = require("bun:test");
${start}test("t", () => { console.log("SAID", run, require("./gauge.cjs").word, globalThis.bodies); });\n`,
    said: ["SAID 1 file 1"],
  },
  "a file that exports": {
    testFile: `const { test, beforeAll } = require("bun:test");
${start}let count = 0;
module.exports.mark = run;
beforeAll(() => { count++; });
test("t", () => { console.log("SAID", run, count, module.exports.mark, require.main === module, require.cache[__filename] === module); });\n`,
    said: ["SAID 1 1 1 true true"],
  },
  "a file that would throw in its second run": {
    testFile: `const { test } = require("bun:test");
${start}if (run === 2) throw new RangeError("second");
test("t", () => { console.log("SAID", run); });\n`,
    said: ["SAID 1"],
  },
  "a file that throws in its first run": {
    testFile: `const { test } = require("bun:test");
${start}if (run === 1) throw new RangeError("first");
test("t", () => { console.log("SAID", run); });\n`,
    said: [],
  },
  "a file that requires a module that it mocks": {
    testFile: `const { test, mock } = require("bun:test");
${start}mock.module("./gauge.cjs", () => ({ word: "mock" }));
test("t", () => { console.log("SAID", run, require("./gauge.cjs").word); });\n`,
    said: ["SAID 1 mock", "SAID 2 mock", "SAID 3 mock"],
  },
};

test.each(Object.entries(files))("%s", async (_, { testFile, said }) => {
  const plain = await runTests(testFile);
  expect(plain.said).toEqual(said);
  expect(await runTests(testFile, "--aot")).toEqual(plain);
});
