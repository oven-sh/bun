import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// The stages of the compiler time themselves. These lines are for what a run does in front of the build, and behind it up to the first result.
const files: Record<string, string> = {
  "tsconfig.json": "{}",
  "package.json": `{ "name": "steps", "dependencies": { "twice": "1.0.0" } }`,
  "node_modules/twice/package.json": `{ "name": "twice", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/twice/index.js": `module.exports = function twice(x) { return x * 2; };\n`,
  "src/lib.ts": `import twice from "twice";\nexport const four = (): number => twice(2);\n`,
  "one.test.ts": `import { expect, test } from "bun:test";
import { four } from "./src/lib";
test("one", () => expect(four()).toBe(4));
`,
  "two.test.ts": `import { expect, test } from "bun:test";
import { four } from "./src/lib";
test("two", () => expect(four() + 1).toBe(5));
`,
};

test("each step of a test run is logged in order, with its time", async () => {
  using dir = tempDir("aot-steps-of-a-test-run", files);
  const directory = String(dir);
  const stepsOf = async (more: Record<string, string>) => {
    const env = {
      ...bunEnv,
      ...more,
      BUN_TMPDIR: directory,
    };
    // One worker is no pool: the files then run in the process that found them.
    const ran = await run([bunExe(), "test", "--aot", "--isolate", "--parallel=2", "."], directory, env);
    const lines = (ran.stdout + "\n" + ran.stderr).split("\n");
    expect(lines.filter(line => /^ *\d+ (pass|fail)$/.test(line))).toEqual([" 2 pass", " 0 fail"]);
    return lines.flatMap(line => {
      const match = /^AOT test run step \| (.*) \| at (\d+) ms$/.exec(line);
      return match ? [{ step: match[1], ms: Number(match[2]) }] : [];
    });
  };
  const steps = await stepsOf({ BUN_JSC_logAOTPhaseTimes: "1" });
  expect(steps.map(it => it.step)).toEqual([
    "2 test files are found",
    // The process that builds the program starts another to run it, which looks for the files again. Its clock begins anew.
    "2 test files are found",
    "2 test files are to run",
    "the coordinator is set up",
    "the first worker is ready",
    "the first test file has begun",
    "the first result is there",
  ]);
  const timesOfSecondProcess = steps.slice(1).map(it => it.ms);
  expect(timesOfSecondProcess).toEqual(timesOfSecondProcess.toSorted((a, b) => a - b));
  expect(await stepsOf({})).toEqual([]);
}, 240_000);
