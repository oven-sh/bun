import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const fixtures = join(import.meta.dir, "a-commonjs-file-mocked-before-it-is-loaded");

test("every line is as in plain bun test", async () => {
  using dir = tempDir(
    "aot-commonjs-file-mocked-before-it-is-loaded",
    Object.fromEntries([
      ["package.json", `{ "name": "mocked-before-it-is-loaded" }`],
      ...readdirSync(fixtures).map(name => [
        name === "mocks.fixture.mjs" ? "mocks.test.mjs" : name,
        readFileSync(join(fixtures, name), "utf8"),
      ]),
    ]),
  );
  const seenWith = async (...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), {
      ...bunEnv,
      BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0",
    });
    return {
      lines: stdout.split("\n").filter(line => line.includes(" | ") || line.includes("THE REAL BODY")),
      failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic/.test(line)),
      exitCode,
    };
  };
  const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
  expect(plain.lines.length).toBe(32);
  expect(plain.lines).toContain("04 require is the namespace | true");
  expect(compiled).toEqual(plain);
}, 120_000);
