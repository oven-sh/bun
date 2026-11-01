import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const fixtures = join(import.meta.dir, "a-commonjs-file-mocked-twice");

test("every line is as in plain bun test", async () => {
  using dir = tempDir(
    "aot-commonjs-file-mocked-twice",
    Object.fromEntries([
      ["package.json", `{ "name": "mocked-twice" }`],
      ...readdirSync(fixtures).map(name => [
        name === "mocks.fixture.mjs" ? "mocks.test.mjs" : name,
        readFileSync(join(fixtures, name), "utf8"),
      ]),
    ]),
  );
  const seenWith = async (words: string, ...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), {
      ...bunEnv,
      BUN_DEBUG_TEST_AOT_WORDS: words,
    });
    return {
      lines: stdout.split("\n").filter(line => line.includes(" | ") || line.includes("THE REAL BODY")),
      failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic/.test(line)),
      exitCode,
    };
  };
  const [plain, oneProgram, layers] = await Promise.all([
    seenWith("TestRunLayers:0"),
    seenWith("TestRunLayers:0", "--aot"),
    seenWith("TestRunLayers:2,TestRunPartFiles:1", "--aot"),
  ]);
  expect(plain.lines.length).toBe(20);
  expect(plain.lines).toContain(
    "18 a failed import between: another importer | THROWS SyntaxError Export named 'other' not found in module 'd.cjs'.",
  );
  expect(oneProgram).toEqual(plain);
  expect(layers).toEqual(plain);
}, 120_000);
