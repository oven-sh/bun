// What ./engine-tests.test.ts and the tests beside it share to start `testaot` and `jsc`. ./engine/ runs the engine's own tests.
import { expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { isASAN, isCI, isDebug, isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { slots } from "./harness/commands";
import { run as runCommand } from "./harness/run";
import { partOfGrid, runsWholeGrids } from "./harness/ways";
import { test } from "./listed";
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
];

const heldByTheSchedulesAlone = [
  "modules/children-of-a-module-object-are-what-the-module-requires.ir",
  "modules/parent-of-a-module-object-is-a-module-that-requires-it.ir",
  "modules/read-of-process-under-a-key-nobody-knows-answers-the-main-module-where-a-way-is-named.ir",
  "placeholders/class-above-an-escaped-instance-is-found-under-constructor-of-the-unknown-object.ir",
  "results/a-literal-gets-fields-for-what-a-spread-source-that-unknown-code-holds-is-born-with.ir",
  "results/store-written-for-the-instances-lists-no-member-of-the-prototype-object.ir",
];

export function runFlowTestsUnderOtherSchedules(part: number, parts: number) {
  (whyEngineTestsSkipped || comeInParts ? test.skip : test)(
    `flow's IR text tests answer the same under other orders of its rules: part ${part} of ${parts}`,
    async () => {
      const failed: string[] = [];
      const folder = join(engineTests!, "valueflow");
      const schedules = Array.from({ length: numberOfSchedules }, (_, number) => number);
      const drawn = partOfGrid("flow's IR text tests under other orders of its rules", schedules, 4, String);
      const isOfThisPart = (_: number, index: number) => index % parts === part - 1;
      const held = heldByTheSchedulesAlone.map(name => join(folder, name));
      const others = schedules.filter(number => !drawn.includes(number));
      const asked = [
        ...drawn.filter(isOfThisPart).map(number => ({ number, paths: [folder] })),
        ...others.filter(isOfThisPart).map(number => ({ number, paths: held })),
      ];
      for (const { number, paths } of asked) {
        for (const path of paths) {
          const { lines } = await run("run", path, `--option=testing=DelayFlowRules:${number}`);
          expect({ number, lastLine: lines.at(-1) }).toEqual({
            number,
            lastLine: expect.stringMatching(/^([1-9]\d* passed, \d+|0 passed, [1-9]\d*) failed, \d+ todo$/),
          });
          const files = new Set(
            lines.flatMap(line => line.match(/^FAIL (.+?\.ir):\d+: /)?.[1].replaceAll("\\", "/") ?? []),
          );
          for (const file of files)
            if (!followTheOrderOfTheRules.some(listed => file.endsWith("/valueflow/" + listed)))
              failed.push(`${file} under ${number}`);
        }
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
const saysWhatDiffers = /^(orders \d+ |threads \d|in \d+ orders|proof under order |line \d+ under order |flip |let-go)/;

async function askStoredFlowPrograms(
  programs: ReturnType<typeof storedFlowPrograms>,
  question: string[] | ((name: string) => string[]),
  owed: Record<string, number>,
  runs: "together" | "each in a process",
) {
  using folder = tempDir("aot-flow-programs", {});
  for (const { name, lines } of programs) {
    mkdirSync(dirname(join(String(folder), name)), { recursive: true });
    writeFileSync(join(String(folder), name), [...(typeof question === "function" ? question(name) : question), ...lines].join("\n"));
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
  const differences: Record<string, string[]> = {};
  for (const name of [...unlike].filter(name => !(name in owed)).sort())
    differences[name] = isCI ? [] : (await run("run", join(String(folder), name), "--show-output")).lines.filter(line => saysWhatDiffers.test(line)); // prettier-ignore
  expect(differences).toEqual({});
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
const answersInEveryOrder: Record<string, { proofs: number; predictions: number }> = {
  "bun/modules/create-require-named-on-an-object-whose-getter-reads-node-module-under-a-key-nobody-knows.ir": { proofs: 2, predictions: 2 },
  "bun/modules/create-require-read-late-on-a-copy-of-node-module-returns-a-require-function.ir": { proofs: 2, predictions: 2 },
  "bun/modules/what-a-read-of-node-module-under-a-key-nobody-knows-answers-is-no-loader-once-it-is-stored-on-another-object.ir": { proofs: 1, predictions: 2 },
};
const takeBackWhenRunAgain: Record<string, number> = {
  "bun/calls/module-that-a-getter-of-the-library-answers-with-is-held-not-called.ir": 4320,
};

export function runFlowTestsInEveryOrder(part: number, parts: number) {
  (whyEngineTestsSkipped || comeInParts ? test.skip : test)(
    `what flow answers doesn't depend on the order in which its rules run: part ${part} of ${parts}`,
    () => {
      const programs = storedFlowPrograms(asksWhatUnseenCodeMayDo);
      const owedNothing = programs.map(({ name }) => name).filter(name => !(name in followTheOrderInTheirAnswers));
      const drawn = new Set(partOfGrid("flow's stored programs in every order of its rules", owedNothing, 4, String));
      const runsNow = (name: string) => runsWholeGrids || drawn.has(name) || name in answersInEveryOrder;
      return askStoredFlowPrograms(
        programs.filter(({ name }) => runsNow(name)).filter((_, index) => index % parts === part - 1),
        name => {
          const { proofs, predictions } = answersInEveryOrder[name] ?? { proofs: 1, predictions: 1 };
          return [
            "# RUN: valueflow-solve every-order",
            "# CHECK: orders 512 answers 1",
            "# CHECK: orders 128 features 1",
            "# CHECK: orders 128 flips 0",
            `# CHECK: orders 128 | proofs: answers ${proofs} | predictions: answers ${predictions}`,
            "# CHECK: threads 1 2 4 16 | answers 1",
          ];
        },
        followTheOrderInTheirAnswers,
        "each in a process",
      );
    },
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
