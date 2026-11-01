import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const files = {
  "package.json": `{}`,
  "src/a.mjs": `export const same = "a";`,
  "src/b.mjs": `export const same = "b";`,
  "src/stars.mjs": `export * from "./a.mjs"; export * from "./b.mjs";`,
  "src/ambiguous.mjs": `import { same } from "./stars.mjs"; console.log("never", same);`,
  "src/missing.mjs": `import { absent } from "./a.mjs"; console.log("never", absent);`,
  "ambiguous.test.mjs": `import { test } from "bun:test"; import "./src/ambiguous.mjs"; console.log("never"); test("runs", () => {});`,
  "missing.test.mjs": `import { test } from "bun:test"; import "./src/missing.mjs"; console.log("never"); test("runs", () => {});`,
  "good.test.mjs": `import { test } from "bun:test"; import * as stars from "./src/stars.mjs"; console.log("good:", Object.keys(stars).join()); test("runs", () => {});`,
};

async function runTests(directory: string, words: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  const counts = stderr.split("\n").filter(line => /^ *\d+ (pass|fail|error)/.test(line));
  return { stdout: stdout.replace(/^bun test .*\n/, ""), stderr, counts, exitCode };
}

test.each([
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
])("%s", async (_, words) => {
  using directory = tempDir("helper-file-that-fails-at-load", files);
  const plain = await runTests(String(directory), words);
  expect(plain.stdout).toContain("good: ");
  expect(plain.stdout).not.toContain("never");
  const compiled = await runTests(String(directory), words, "--aot");
  expect({ stdout: compiled.stdout, counts: compiled.counts, exitCode: compiled.exitCode }).toEqual({
    stdout: plain.stdout,
    counts: plain.counts,
    exitCode: plain.exitCode,
  });
  expect(compiled.stderr).not.toMatch(/TS\d+/);
  const errorLines = (text: string) => text.split("\n").filter(line => line.startsWith("error"));
  expect(errorLines(compiled.stderr)).toEqual(errorLines(plain.stderr));
  expect(compiled.stderr.match(/SyntaxError/g)?.length).toBe(plain.stderr.match(/SyntaxError/g)?.length);
});
