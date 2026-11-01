// What ./engine-tests.test.ts and the tests beside it share to start `testaot` and `jsc`. ./engine/ runs the engine's own tests.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { isASAN, isDebug, isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { slots } from "./harness/commands";
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
  "modules/parent-and-children-where-the-run-time-answers-the-require.ir",
  // TODO(4093): it fails under every order, as in engine/testaot.ts.
  "modules/text-file-answers-the-text-to-a-linked-require-and-its-namespace-to-the-loader.ir",
  "placeholders/a-store-through-a-value-nobody-knows-writes-no-member-of-a-bun-that-escapes-later.ir",
  "placeholders/realm-objects-stay-closed-without-unseen-code.ir",
  "results/a-literal-gets-fields-for-what-a-spread-source-that-unknown-code-holds-is-born-with.ir",
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

const sameProgramUnderAnotherOrder = /-with-(all-|other-)?flow-rules-delayed(-\d+)?\.ir$/;
const directive = /^# ([A-Z][A-Z0-9_-]*?)(-NEXT|-NOT|-LABEL|-COUNT-\d+)?(\([A-Z0-9_-]+\))?:/;
const wordOfAnOrder = /^testing=Delay(Other)?FlowRules(:\d+)?(,Delay(Other)?FlowRules(:\d+)?)*$/;

function programWithoutItsRuns(text: string) {
  const ofRuns = new Set(["RUN", "TODO", "STATISTIC", "CHECK", ...text.matchAll(/^# RUN\(([A-Z0-9_-]+)\):/gm).map(it => it[1])]);
  return text.split(/\r?\n/).flatMap(line => {
    const word = line.match(directive)?.[1];
    if (!word) return [line];
    if (ofRuns.has(word)) return [];
    if (word !== "OPTIONS") return [line];
    const words = line.slice("# OPTIONS:".length).trim().split(/\s+/).filter(word => !wordOfAnOrder.test(word)); // prettier-ignore
    return words.length ? [`# OPTIONS: ${words.join(" ")}`] : [];
  });
}

function storedFlowPrograms(asks: RegExp) {
  const roots = { engine: join(engineTests!, "valueflow"), bun: join(import.meta.dir, "engine-tests", "valueflow") };
  return Object.entries(roots).flatMap(([root, folder]) => {
    const files = [...new Bun.Glob("**/*.ir").scanSync({ cwd: folder })].map(file => file.replaceAll("\\", "/")).sort();
    const seen = new Set<string>();
    return files.flatMap(file => {
      const program = file.replace(sameProgramUnderAnotherOrder, ".ir");
      const text = readFileSync(join(folder, file), "utf8");
      if (!asks.test(text) || /^# (REQUIRES|DIAGNOSTIC|LOSS|PROGRAM-OF)/m.test(text) || (program !== file && files.includes(program)) || seen.has(program))
        return [];
      seen.add(program);
      return [{ name: `${root}/${program}`, lines: programWithoutItsRuns(text) }];
    });
  });
}

const mostProcessesAtOnce = 16;

async function askStoredFlowPrograms(
  programs: ReturnType<typeof storedFlowPrograms>,
  question: string[],
  owed: Record<string, number>,
  runs: "together" | "each in a process",
) {
  using folder = tempDir("aot-flow-programs", {});
  for (const { name, lines } of programs) {
    mkdirSync(dirname(join(String(folder), name)), { recursive: true });
    writeFileSync(join(String(folder), name), [...question, ...lines].join("\n"));
  }
  const waiting = runs === "together" ? [String(folder)] : programs.map(({ name }) => join(String(folder), name));
  const lines: string[] = [];
  let answered = 0;
  const work = async () => {
    for (let path = waiting.shift(); path; path = waiting.shift()) {
      const output = (await run("run", path)).lines;
      const [, passed, failed] = output.at(-1)?.match(/^(\d+) passed, (\d+) failed, 0 todo$/) ?? [];
      expect({ path, lastLine: output.at(-1) }).toEqual({ path, lastLine: `${passed} passed, ${failed} failed, 0 todo` });
      answered += Number(passed) + Number(failed);
      lines.push(...output);
    }
  };
  await Promise.all(Array.from({ length: Math.min(slots, mostProcessesAtOnce) }, work));
  expect({ answered }).toEqual({ answered: programs.length });
  const start = String(folder).replaceAll("\\", "/") + "/";
  const unlike = new Set(lines.flatMap(line => line.match(/^FAIL (.+?\.ir):\d+: /)?.[1].replaceAll("\\", "/").replace(start, "") ?? [])); // prettier-ignore
  expect([...unlike].filter(name => !(name in owed)).sort()).toEqual([]);
}

const asksWhatUnseenCodeMayDo = /^# RUN(\([A-Z0-9_-]+\))?: valueflow-solve.* unseen/m;
const asksFlow = /^# RUN(\([A-Z0-9_-]+\))?: valueflow-solve/m;

const followTheOrderInTheirAnswers: Record<string, number> = {
  "bun/builtins/a-copy-of-a-bun-that-nobody-named-and-somebody-else-holds-hands-out-no-member-that-loads-code.ir": 4200,
  "bun/builtins/a-copy-of-a-bun-that-nobody-named-and-that-comes-late-hands-out-no-member-that-loads-code.ir": 4200,
  "bun/builtins/a-copy-of-a-bun-that-nobody-named-hands-out-no-member-that-loads-code.ir": 4200,
  "bun/host/three-reads-off-the-global-object.ir": 3743,
  "bun/modules/plugin-named-on-an-object-filled-under-the-keys-of-a-module-loaded-under-a-name-nobody-knows-is-not-that-of-bun.ir": 4200,
  "bun/placeholders/loader-stored-on-escaped-object-called-through-unknown-value-delayed.ir": 4319,
  "bun/placeholders/loader-stored-on-escaped-object-called-through-unknown-value.ir": 4319,
  "engine/host/class-that-extends-function-has-escaped-and-its-super-call-still-evaluates-text.ir": 4318,
  "engine/host/proxy-of-an-evaluator-that-is-called-evaluates-text.ir": 4318,
  "engine/modules/loader-read-below-a-copy-of-a-copy-of-process-is-found-on-the-source-of-the-copies.ir": 4200,
  "engine/modules/loader-read-on-a-copy-of-process-is-found-on-the-source-of-the-copy.ir": 4318,
  "engine/modules/loader-read-on-a-copy-of-process-that-unknown-code-holds-is-found-on-the-source-of-the-copy.ir": 4200,
  "engine/results/calls-of-values-nobody-follows-share-a-few-records-of-unseen-code.ir": 4319,
};
const takeBackWhenRunAgain: Record<string, number> = {
  "bun/calls/module-that-a-getter-of-the-library-answers-with-is-held-not-called.ir": 4320,
};

export function runFlowTestsInEveryOrder(part: number, parts: number) {
  (whyEngineTestsSkipped || comeInParts ? test.skip : test)(
    `what flow answers doesn't depend on the order in which its rules run: part ${part} of ${parts}`,
    () =>
      askStoredFlowPrograms(
        storedFlowPrograms(asksWhatUnseenCodeMayDo).filter((_, index) => index % parts === part - 1),
        ["# RUN: valueflow-solve every-order", "# CHECK: orders 512 answers 1", "# CHECK: orders 128 features 1", "# CHECK: orders 128 flips 0"],
        followTheOrderInTheirAnswers,
        "each in a process",
      ),
    limit,
  );
}

export function runFlowTestsWhereRulesRunAgain() {
  (whyEngineTestsSkipped || comeInParts ? test.skip : test)(
    "a rule of flow that runs again takes nothing back",
    () =>
      askStoredFlowPrograms(
        storedFlowPrograms(asksFlow),
        ["# RUN: valueflow-solve let-go", "# CHECK: let-go-loses 0"],
        takeBackWhenRunAgain,
        "together",
      ),
    limit,
  );
}
