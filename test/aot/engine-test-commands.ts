// What ./engine-tests.test.ts and the tests beside it share to start `testaot` and `jsc`. ./engine/ runs the engine's own tests.
import { expect, test } from "bun:test";
import { existsSync } from "fs";
import { isASAN, isDebug, isWindows } from "harness";
import { dirname, join } from "path";
import { run as runCommand } from "./harness/run";
import { engineTests, jsc, testaot, toolEnv } from "./shell/tools";

const comeInParts = isASAN || isDebug;
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

// The runner gives a file twice the time under a sanitizer.
const limit = isASAN ? 480_000 : 290_000;

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
