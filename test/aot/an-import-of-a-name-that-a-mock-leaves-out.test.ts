import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const fixtures = join(import.meta.dir, "an-import-of-a-name-that-a-mock-leaves-out");

// mock.module("./shapes.mjs", () => ({ area })) before anything has loaded shapes.mjs: what the factory answers is the whole module.
// `import { sides } from "./shapes.mjs"` in a module that is loaded later links, and `sides` is undefined at each read.
test.each(["TestRunLayers:0", "TestRunLayers:2,TestRunPartFiles:1"])(
  "every line is as in plain bun test: %s",
  async words => {
    using dir = tempDir(
      "aot-import-of-a-name-that-a-mock-leaves-out",
      Object.fromEntries([
        ["package.json", `{ "name": "a-name-that-a-mock-leaves-out" }`],
        ...readdirSync(fixtures).map(name => [
          name === "mocks.fixture.mjs" ? "mocks.test.mjs" : name,
          readFileSync(join(fixtures, name), "utf8"),
        ]),
      ]),
    );
    const seenWith = async (...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), {
        ...bunEnv,
        BUN_DEBUG_TEST_AOT_WORDS: words,
      });
      return {
        lines: stdout.split("\n").filter(line => line.includes(" | ") || line.includes("BODY OF")),
        failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic/.test(line)),
        exitCode,
      };
    };
    const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
    expect(plain.lines.length).toBe(32);
    expect(plain.lines).toContain("02 a const | undefined");
    expect(compiled).toEqual(plain);
  },
  120_000,
);
