// For mocks-from-one-test-file-to-the-next-*.test.ts and mocks-laid-twice.test.ts. Each case of everyday-mock-cases-of-several-steps.ts is laid out as a project of its own and run by `bun test` and by
// `bun test --aot`, each run in a folder and a process of its own. What `bun test` says is the specification.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "../supported";
import type { EverydayMockCase } from "./everyday-mock-cases";
import { mocksFromOneTestFileToTheNext, mocksLaidTwice } from "./everyday-mock-cases-of-several-steps";
import { run } from "./run";

const wordsOfAll = process.env.AOT_TEST_RUN_WORDS ?? "";

async function outcomeOf(files: Record<string, string>, words: string, ...flags: string[]) {
  using dir = tempDir("aot-everyday-mock", files);
  const env = {
    ...bunEnv,
    NO_COLOR: "1",
    BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "0",
    BUN_DEBUG_TEST_AOT_WORDS: words,
  };
  const testFiles = Object.keys(files)
    .filter(name => name.includes(".test."))
    .sort()
    .map(name => "./" + name);
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, ...testFiles], String(dir), env);
  return {
    printed: stdout.split("\n").filter(line => line.startsWith("SAID ")),
    tests: stderr
      .split("\n")
      .filter(line => /^\((pass|fail|skip|todo)\) /.test(line))
      .map(line => line.replace(/ \[[\d.]+m?s\]$/, "")),
    exitCode,
    lastWords: exitCode > 1 ? stderr.split("\n").filter(Boolean).slice(-12) : [],
    // A compiled run ends with a list of the files that it did not run again where `bun test` does: `  room.cjs, while 2-second.test.mjs ran`.
    didNotRunAgain: (stdout + "\n" + stderr).split("\n").filter(line => /^ {2}\S+, while \S+ ran$/.test(line)).length,
  };
}

function each(
  cases: EverydayMockCase[],
  part: number,
  parts: number,
  judge: (name: string, plain: Outcome, compiled: Outcome) => void,
) {
  const stretch = Math.ceil(cases.length / parts);
  for (const { name, files } of cases.slice((part - 1) * stretch, part * stretch)) {
    test(name, async () => {
      const [plain, again, compiled] = await Promise.all([
        outcomeOf(files, ""),
        outcomeOf(files, ""),
        outcomeOf(files, wordsOfAll, "--aot"),
      ]);
      // A case in which `bun test` does not say the same twice specifies nothing.
      if (!Bun.deepEquals(plain, again)) {
        console.error(
          `THE REFERENCE WAVERED: ${name}: plain Bun said ${JSON.stringify(plain)}, then ${JSON.stringify(again)}`,
        );
        return;
      }
      judge(name, plain, compiled);
    });
  }
}
type Outcome = Awaited<ReturnType<typeof outcomeOf>>;

// In a compiled run the top-level code of a file runs once, also for the next test file, and the run says at its end which files that was. So a compiled run may print other lines than `bun test` here, and
// then it has to say so.
export function mocksFromOneTestFileToTheNextIn(part: number, parts: number) {
  each(mocksFromOneTestFileToTheNext(), part, parts, (name, plain, compiled) => {
    expect({ ...compiled, printed: [], didNotRunAgain: 0 }).toEqual({ ...plain, printed: [] });
    if (!Bun.deepEquals(compiled.printed, plain.printed)) expect(compiled.didNotRunAgain).toBeGreaterThan(0);
  });
}

// Where the two runs part today, and all that the compiled run prints there. Such a case fails by any other difference, and once the two runs agree: its line goes out.
const stillWrong: [cases: RegExp, printed: string, what: string][] = [
  [
    /^[a-z-]+--the-original-in-the-factory--reset-modules--laid-again--imported-at-run-time$/,
    "laid 1 ; the body of the lamp runs 1 ; 1 mock1 own 1 ; laid 2 ; threw EvalError",
    "a mock that needs the original, imported again behind resetModules()",
  ],
  [
    /^[a-z-]+--the-original-in-the-factory--reset-modules--left-as-it-is--imported-at-run-time$/,
    "laid 1 ; the body of the lamp runs 1 ; 1 mock1 own 1 ; threw EvalError",
    "the same",
  ],
  [
    /^vi-do-mock--a-factory--nothing-between--laid-again--imported-at-run-time$/,
    "laid 1 ; 1 mock1 mocked 0 ; laid 2 ; 2 mock2 mocked 0 ; held mock2 mocked",
    "what the test held from its first import() follows the second mock",
  ],
  [
    /^vi-do-mock--the-original-in-the-factory--nothing-between--laid-again--imported-at-run-time$/,
    "laid 1 ; the body of the lamp runs 1 ; 1 mock1 own 1 ; laid 2 ; 2 mock2 own 1 ; held mock2 own",
    "the same",
  ],
  [
    /^vi-do-mock--a-factory--nothing-between--laid-again--required$/,
    "laid 1 ; 1 mock1 mocked 0 ; laid 2 ; 2 mock1 mocked 0 ; held mock1 mocked",
    "the second require() still gets the first mock",
  ],
  [
    /^vi-do-mock--the-original-in-the-factory--nothing-between--laid-again--required$/,
    "laid 1 ; the body of the lamp runs 1 ; 1 mock1 own 1 ; laid 2 ; 2 mock1 own 1 ; held mock1 own",
    "the same",
  ],
];

export function mocksLaidTwiceIn(part: number, parts: number) {
  each(mocksLaidTwice(), part, parts, (name, plain, compiled) => {
    const printed = stillWrong.find(([names]) => names.test(name))?.[1];
    expect({ ...compiled, didNotRunAgain: 0 }).toEqual(
      printed === undefined ? plain : { ...plain, printed: printed.split(" ; ").map(line => "SAID " + line) },
    );
  });
}
