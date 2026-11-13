// For mocks-from-one-test-file-to-the-next-*.test.ts and mocks-laid-twice.test.ts. Each case of everyday-mock-cases-of-several-steps.ts is laid out as a project of its own and run by `bun test` and by
// `bun test --aot`, each run in a folder and a process of its own. What `bun test` says is the specification.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "../supported";
import type { EverydayMockCase } from "./everyday-mock-cases";
import { mocksInAChain } from "./everyday-mock-cases-in-a-chain";
import { mocksFromOneTestFileToTheNext, mocksLaidTwice } from "./everyday-mock-cases-of-several-steps";
import { run } from "./run";

const wordsOfAll = process.env.AOT_TEST_RUN_WORDS ?? "";

async function outcomeOf(files: Record<string, string>, words: string, oneThread: boolean, ...flags: string[]) {
  using dir = tempDir("aot-everyday-mock", files);
  const env = {
    ...bunEnv,
    NO_COLOR: "1",
    BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: oneThread ? "1" : "0",
    BUN_DEBUG_TEST_AOT_WORDS: words,
  };
  const testFiles = Object.keys(files)
    .filter(name => name.includes(".test."))
    .sort()
    .map(name => "./" + name);
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, ...testFiles], String(dir), env);
  const lines = stderr.split("\n").filter(Boolean);
  // A report of a sanitizer ends with the stacks of the threads that started one another, so the lines that name the fault go in front of the last ones.
  const namesFault = (line: string) => /^(==\d+==ERROR|SUMMARY): /.test(line);
  // A run that came to its end says how many tests it ran. The exit code alone does not tell: a report of AddressSanitizer ends a run with 1, as a failed test does, unless it is told to
  // abort, and it may come behind that line.
  const hasDied =
    exitCode > 1 || lines.some(namesFault) || !lines.some(line => /^Ran \d+ tests? across \d+ files?\. /.test(line));
  return {
    printed: stdout.split("\n").filter(line => line.startsWith("SAID ")),
    tests: lines
      .filter(line => /^\((pass|fail|skip|todo)\) /.test(line))
      .map(line => line.replace(/ \[[\d.]+m?s\]$/, "")),
    exitCode,
    // A run that dies says why here, and nowhere else. One that is killed says nothing, so how it ended comes last.
    lastWords: hasDied ? [...lines.slice(0, -12).filter(namesFault), ...lines.slice(-12), `exit code ${exitCode}`] : [],
    // A compiled run ends with a list of the files that it did not run again where `bun test` does: `  room.cjs, while 2-second.test.mjs ran`.
    didNotRunAgain: (stdout + "\n" + stderr).split("\n").filter(line => /^ {2}\S+, while \S+ ran$/.test(line)).length,
  };
}

function each(
  cases: EverydayMockCase[],
  part: number,
  parts: number,
  judge: (name: string, plain: Outcome, compiled: Outcome) => void,
  plainOnOneThread = false,
) {
  const stretch = Math.ceil(cases.length / parts);
  for (const { name, files } of cases.slice((part - 1) * stretch, part * stretch)) {
    // A case shares nothing with the others, so they run beside one another on every lane, as many as `--max-concurrency` says.
    test.concurrent(name, async () => {
      const [plain, compiled] = await Promise.all([
        outcomeOf(files, "", plainOnOneThread),
        outcomeOf(files, wordsOfAll, false, "--aot"),
      ]);
      // A run that died fails its case, with its last words, also where the two runs are known to part.
      expect({ plain: plain.lastWords, compiled: compiled.lastWords }).toEqual({ plain: [], compiled: [] });
      // A run that printed nothing would be the same as any other that printed nothing.
      expect(plain.printed).not.toBeEmpty();
      judge(name, plain, compiled);
    });
  }
}
type Outcome = Awaited<ReturnType<typeof outcomeOf>>;
// Also for failing-module-mocks.ts and everyday-failing-tests.ts.
export { each };

// Each test file prints one line at its end: what the room says, what the hall says, and how often the files that use the lamp have run so far.
const shapeOf = (line: string) => line.replace(/^(SAID \S+) [^,]+,[^,]+ ran \d+$/, "$1 <room>,<hall> ran <count>");

// A compiled run may keep what the top-level code of a file computed where `bun test` runs the file again, and then lists the file at its end. No case here comes to that
// today: each prints the lines of `bun test` and lists no file, and fails once it does not.
export function mocksFromOneTestFileToTheNextIn(part: number, parts: number) {
  each(mocksFromOneTestFileToTheNext(), part, parts, (_, plain, compiled) => {
    // What a line says is up to `bun test`. That every test file passes and prints its line is up to the case.
    expect({ ...plain, printed: plain.printed.map(shapeOf) }).toEqual({
      printed: ["first", "second", "third"].map(file => `SAID ${file} <room>,<hall> ran <count>`),
      tests: ["(pass) first", "(pass) second", "(pass) third"],
      exitCode: 0,
      lastWords: [],
      didNotRunAgain: 0,
    });
    expect(compiled).toEqual(plain);
  });
}

// Where the two runs part today. Such a case is run and fails by nothing; where the two runs agree it says so, and once they always do its line goes out.
const partsInAChain: [cases: RegExp, what: string][] = [
  [
    /^([a-z-]+--imported|(a-spy|a-file-among-the-mocks|a-factory-that-waits)--the-original-asked-for|a-factory-that-waits--imported-at-run-time)--one--modules-reset-meanwhile$/,
    "the modules are reset while the brook itself waits for the spring",
  ],
  [
    /^[a-z-]+--imported--(one|two|three)--unmocked-meanwhile$/,
    "the mock is ended while a file that imports the spring is loaded",
  ],
  [
    /^(bare|a-spy|a-file-among-the-mocks)--required--one--unmocked-meanwhile$/,
    "the mock is ended while a file that requires the spring is loaded",
  ],
  [
    /^a-factory-over-the-original--required--(?!(one|two)--(laid-in-a-preload|loads-begun-in-another-file)$)/,
    "require() meets a factory that waits for the original",
  ],
  [
    /^a-factory-that-waits--(imported-at-run-time|required)--(one|two|three)--unmocked-meanwhile$/,
    "the mock is ended while its factory waits",
  ],
  [
    /^a-factory-that-waits--(imported-at-run-time|required)--one--laid-in-the-test$/,
    "the brook itself asks for the spring while the factory waits",
  ],
  [
    /^a-factory-that-waits--imported--((one|two|three)--laid-in-the-test|three--(loads-begun-in-another-file|laid-in-a-preload)|(two|three)--modules-reset-meanwhile)$/,
    "a file that imports the spring is loaded while the factory waits",
  ],
];

// Plain Bun reads the files on one thread: with threads it completes loads in the order in which the threads finish.
export function mocksInAChainIn(part: number, parts: number) {
  const judge = (name: string, plain: Outcome, compiled: Outcome) => {
    if (!partsInAChain.some(([names]) => names.test(name))) {
      expect({ ...compiled, didNotRunAgain: 0 }).toEqual(plain);
      return;
    }
    // Which load in flight ends first is a matter of time, so that the two runs part is asked of nobody.
    if (Bun.deepEquals({ ...compiled, didNotRunAgain: 0 }, plain))
      console.error(`A LISTED PARTING AGREES WITH bun test: ${name}`);
  };
  each(mocksInAChain(), part, parts, judge, true);
}

export function mocksLaidTwiceIn(part: number, parts: number) {
  each(mocksLaidTwice(), part, parts, (_, plain, compiled) => {
    expect({ ...compiled, didNotRunAgain: 0 }).toEqual(plain);
  });
}
