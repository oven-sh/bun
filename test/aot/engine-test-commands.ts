// The long commands of the engine's own tests. Each is a test file of its own (parts.mts), so that none shares the five minutes
// that the runner gives a file with another: the two runs of IR text tests, and the native tests in parts.
// ./engine-tests.test.ts has the short ones and says which tools they need. With a sanitizer ./engine-tests-in-parts.ts runs these.
//
//   TEST_PART=aot/engine-tests-ir bun test test/aot/parts.test.ts            the engine's IR text tests
//   TEST_PART=aot/engine-tests-ir-of-bun bun test test/aot/parts.test.ts     those of ./engine-tests, which name entries of Bun's table
//   TEST_PART=aot/engine-tests-native-3 bun test test/aot/parts.test.ts      one part of the native tests
//   TEST_PART=aot/engine-tests-native bun test test/aot/parts.test.ts        all of them
//   TEST_PART=aot/engine-tests-flow-under-other-schedules-2 bun test test/aot/parts.test.ts   flow's IR text tests under a quarter of the other orders of its rules
import { expect, test } from "bun:test";
import { existsSync } from "fs";
import { isArm64, isASAN, isMacOS, isWindows } from "harness";
import { dirname, join } from "path";
import { comeInParts, printOutputOfFailedTests } from "./engine-tests-in-parts";
import { run as runCommand } from "./harness/run";
import { engineTests, jsc, testaot, toolEnv } from "./shell/tools";

const shellPath = testaot && join(dirname(testaot), "jsc" + (isWindows ? ".exe" : ""));

export const whySkipped = !testaot
  ? "there is no testaot: not in $TESTAOT, not beside the Bun under test, not in build/release-local or build/release"
  : undefined;
export const whyEngineTestsSkipped =
  whySkipped ??
  (!engineTests
    ? "two tests need the engine's test files: not in $AOT_ENGINE_TESTS, no aot-tests beside the Bun under test, no aot/tests in $BUN_WEBKIT_PATH or vendor/WebKit"
    : undefined);
export const whyNativeTestsSkipped =
  whyEngineTestsSkipped ??
  (!existsSync(shellPath!)
    ? `one test needs jsc in the folder of testaot, where the engine's native tests start it: there is no ${shellPath}`
    : undefined);
export const whyShellSkipped =
  whySkipped ??
  (!jsc
    ? "one test needs jsc: not in $JSC, not beside the Bun under test, not in build/release-local or build/release"
    : undefined);

export async function runTool(cmd: string[]) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, undefined, toolEnv);
  return { lines: stdout.split(/\r?\n/).filter(line => line !== ""), stderr, exitCode };
}

export const run = (...args: string[]) => runTool([testaot!, ...args]);

// TODO: on Windows x64 `pass` answers "unknown pass f0:v3" to a word that retypes a value behind the parser, so it runs no pass. Why is not known.
// On Windows arm64 it takes the word. These are three files with such a word. The last one is in ./engine-tests.
export const unexplainedOnWindows = [
  "represent/operand-wider-than-its-operation-takes.ir",
  "select/builtin-call-whose-operand-lost-its-type.ir",
  "select/a-call-that-takes-parts-of-views-keeps-its-form-when-a-view-is-only-known-as-an-object.ir",
];
const isKnownOnWindows = (line: string) =>
  unexplainedOnWindows.some(file => line.replaceAll("\\", "/").includes(`/${file}:`));

// TODO: on arm64 it prints another output.
const notYetOnArm64 = isArm64 ? ["dictionary-access-by-name/programs/uncacheable-dictionary-files-nothing"] : [];
// TODO: on the Intel Macs of CI the native tests, in four parts at one time, did not end within the five minutes that the runner gives a file.
const nativeTestsOutlastTheRunner = isMacOS && !isArm64;
// The runner gives a file twice the time under a sanitizer.
const limit = isASAN ? 480_000 : 290_000;

async function expectEveryTestPassed({ lines, stderr, exitCode }: Awaited<ReturnType<typeof run>>) {
  await printOutputOfFailedTests(lines.filter(line => !(isWindows && isKnownOnWindows(line))));
  if (isWindows && lines.some(line => line.startsWith("FAIL ") && isKnownOnWindows(line))) {
    expect(lines.filter(line => line.startsWith("FAIL ") && !isKnownOnWindows(line))).toEqual([]);
    return;
  }
  const failed = lines.filter(line => line.startsWith("FAIL "));
  const isOnTheList = (line: string) => notYetOnArm64.some(name => line.startsWith(`FAIL ${name}: `));
  if (failed.length && failed.every(isOnTheList)) {
    expect(lines.at(-1)).toMatch(/^[1-9][0-9]* passed, [1-9][0-9]* failed, [0-9]+ todo$/);
    return;
  }
  // In front of its FAIL line a native test that crashed has said which check failed, and where.
  const hasFailed = lines.some(line => line.startsWith("FAIL "));
  expect(hasFailed ? lines.filter(line => !/^(PASS|TODO|SKIP|  still fails:) /.test(line)).slice(-60) : []).toEqual([]);
  // After a crash, lastLine names the native test and stderr has the failed check: stderr is listed so that it is printed.
  expect({ lastLine: lines.at(-1), stderr, exitCode }).toEqual({
    lastLine: expect.stringMatching(/^[1-9][0-9]* passed, 0 failed, [0-9]+ todo$/),
    stderr: expect.any(String),
    exitCode: 0,
  });
}

export function runIRTests(folder: "engine" | "bun") {
  if (folder === "engine")
    (whyEngineTestsSkipped || comeInParts ? test.skip : test)(
      "the engine's IR text tests pass",
      async () => {
        await expectEveryTestPassed(await run("run", engineTests!));
      },
      limit,
    );
  else
    (whySkipped || comeInParts ? test.skip : test)(
      "the engine's IR text tests of Bun's entries pass",
      async () => {
        await expectEveryTestPassed(await run("run", join(import.meta.dir, "engine-tests")));
      },
      limit,
    );
}

export function runNativeTests(part: number, parts: number) {
  (whyNativeTestsSkipped || comeInParts ? test.skip : nativeTestsOutlastTheRunner ? test.todo : test)(
    `the engine's native tests pass: part ${part} of ${parts}`,
    async () => {
      await expectEveryTestPassed(await run("native", `--part=${part}/${parts}`));
    },
    limit,
  );
}

// What flow finds may not hang on the order in which its rules run. `testing=DelayFlowRules:<n>` is one of 256 other valid orders: about half of the rules that are due in a round
// wait for a later one, and the number says which half. The numbers are fixed, so a red test is red again: `testaot run <file> --option=testing=DelayFlowRules:<n>`.
const numberOfSchedules = 32;
// These still answer otherwise under some of the orders. Each is owed a cure and goes out of the list with it. A test that is not listed and fails here has lost something: it is not added.
const followTheOrderOfTheRules = [
  "modules/children-of-a-module-object-are-what-the-module-requires.ir",
  "modules/parent-and-children-where-the-run-time-answers-the-require.ir",
  "modules/parent-of-a-module-object-is-a-module-that-requires-it.ir",
  "modules/read-of-process-under-a-key-nobody-knows-answers-the-main-module-where-a-way-is-named.ir",
  "placeholders/class-above-an-escaped-instance-is-found-under-constructor-of-the-unknown-object.ir",
  "placeholders/realm-objects-stay-closed-without-unseen-code.ir",
  "results/a-literal-gets-fields-for-what-a-spread-source-that-unknown-code-holds-is-born-with.ir",
  "results/store-written-for-the-instances-lists-no-member-of-the-prototype-object.ir",
];

export function runFlowTestsUnderOtherSchedules(part: number, parts: number) {
  (whyEngineTestsSkipped || comeInParts ? test.skip : test)(
    `flow's IR text tests answer the same under other orders of its rules: part ${part} of ${parts}`,
    async () => {
      const failed: string[] = [];
      for (let number = part - 1; number < numberOfSchedules; number += parts) {
        const { lines } = await run(
          "run",
          join(engineTests!, "valueflow"),
          `--option=testing=DelayFlowRules:${number}`,
        );
        expect({ number, lastLine: lines.at(-1) }).toEqual({
          number,
          lastLine: expect.stringMatching(/^[1-9][0-9]* passed, [0-9]+ failed, [0-9]+ todo$/),
        });
        const files = new Set(
          lines.flatMap(line => line.match(/^FAIL (.+?\.ir):\d+: /)?.[1].replaceAll("\\", "/") ?? []),
        );
        for (const file of files)
          if (!followTheOrderOfTheRules.some(listed => file.endsWith("/valueflow/" + listed)))
            failed.push(`${file} under ${number}`);
      }
      expect(failed).toEqual([]);
    },
    limit,
  );
}
