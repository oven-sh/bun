import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// For whoever compares what a test run compiles with what an executable compiles before either is numbered: `testaot print <file> --until=Select`.
test("the word TestRunProgramFile writes the program of a test run as --aot-out writes that of an executable", async () => {
  using dir = tempDir("program-of-a-test-run", {
    "lib.ts": `export function double(value: number) { return value * 2; }`,
    "main.ts": `import { double } from "./lib";\nconsole.log(double(21));`,
    "one.test.ts": `import { expect, test } from "bun:test";\nimport { double } from "./lib";\ntest("doubles", () => { expect(double(21)).toBe(42); });`,
  });
  const ofTestRun = join(String(dir), "test-run.program");
  const ofExecutable = join(String(dir), "executable.program");
  const tested = await run([bunExe(), "test", "--aot"], String(dir), {
    ...bunEnv,
    BUN_DEBUG_TEST_AOT_WORDS: `TestRunProgramFile:${ofTestRun}`,
  });
  expect({ stderr: tested.exitCode ? tested.stderr : "", exitCode: tested.exitCode }).toEqual({
    stderr: "",
    exitCode: 0,
  });
  const built = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      `--aot-out=${ofExecutable}`,
      "./main.ts",
      "--outfile",
      join(String(dir), "main"),
    ],
    String(dir),
    bunEnv,
  );
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const [first, second] = [readFileSync(ofTestRun), readFileSync(ofExecutable)];
  expect(first.length).toBeGreaterThan(1000);
  expect(first.subarray(0, 8)).toEqual(second.subarray(0, 8));
  expect(first.includes("one.test.ts")).toBe(true);
  expect(second.includes("one.test.ts")).toBe(false);
});
