// run-parallel.ts builds every stored program once more with --aot-testing=FailSpeculations:<n>: one guess in n fails on purpose, so that the program walks the ways from its typed copies into the
// closed ones, and it must print what plain Bun prints there too. No flag asks for that build: it is made wherever the builds behind the first are made.
// And once more with --aot-harden=proof-checks, where a proof that does not hold stops the program by name. The builds of each way are counted on stderr, so that no flag drops a way without a word.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join, sep } from "node:path";
import { lineThatLeavesOut } from "./harness/lines-that-leave-out";
import { run } from "./harness/run";
import { beforeAll, test } from "./supported";

const program = `function sum(list: number[]) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}
console.log(sum([1, 2, 3.5]), sum([4, 5, 6]));
`;

async function start(words: string[], environment: Record<string, string>, programs: Record<string, string>) {
  using folder = tempDir("where-guesses-fail", { "tsconfig.json": "{}", ...programs });
  const root = String(folder);
  // One of these programs stops on purpose. A crash report that a passing test file leaves behind is laid on the next file that fails, which then gets no second try.
  const { BUILDKITE_BUILD_NUMBER: _, BUN_CRASH_REPORT_URL: __, ...env } = bunEnv;
  const files = Object.keys(programs).map(name => join(root, name));
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), join(import.meta.dir, "run-parallel.ts"), `--root=${root}`, "--jobs=3", ...words, ...files],
    root,
    { ...env, ...environment },
  );
  const lines = stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
  return { lines, stderr, exitCode, root };
}
type Ran = Awaited<ReturnType<typeof start>>;
// The builds are what costs. The driver is started once for each list of arguments, and every test that asks the same of it reads that run.
const runs = new Map<string, Promise<Ran>>();
async function started(
  words: string[],
  environment: Record<string, string>,
  programs: Record<string, string>,
): Promise<Ran> {
  const key = JSON.stringify([words, environment, programs]);
  const begun = runs.get(key);
  if (!begun) return runs.getOrInsertComputed(key, () => start(words, environment, programs));
  // By itself the driver ends with 0 or 1. A run that was ended, as where its test ran out of time and bun:test killed what it had started, has not said everything.
  // Only the test that began it reads it. Another test that asks for it begins a run of its own, as if nothing were shared.
  const ran = await begun.catch(() => undefined);
  if (ran?.exitCode === 0 || ran?.exitCode === 1) return ran;
  if (runs.get(key) === begun) runs.delete(key);
  return started(words, environment, programs);
}
const driven = (words: string[], environment: Record<string, string> = {}, head = "", text = program) =>
  started(words, environment, { "sums.ts": head + text });
/** The one line in which the driver says how a program went. */
const verdictOf = ({ lines, root }: Ran, name = "sums.ts") =>
  lines.find(({ file, state }) => file === join(root, name) && state !== "compiling");
/** What that line says, and how the driver ended. A program that passes has no stage and no message: where one fails that should not, the difference shows why. */
const saidOf = (ran: Ran, name?: string) => {
  const { ways, stage, message } = verdictOf(ran, name) ?? {};
  return { ways, stage, message, exitCode: ran.exitCode };
};
/** The last that the driver says on stderr: the builds of each way and, behind them, what a line has left out. */
const countsOf = ({ stderr, root }: Ran) =>
  /^builds by way: .*\nleft out by a line: .*\n(?:  not (?:compared|built): .*\n)*/m
    .exec(stderr)?.[0]
    .replaceAll(root + sep, "");
const waysOf = async (words: string[], environment?: Record<string, string>) =>
  saidOf(await driven(words, environment));
const inFourWays = (n: string) => ({
  ways: {
    compiled: "pass",
    "under --aot-erase-types": "pass",
    [`under --aot-testing=FailSpeculations:${n}`]: "pass",
    "under --aot-harden=proof-checks": "pass",
  },
  exitCode: 0,
});
const fourBuilds =
  "builds by way: compiled 1 | under --aot-erase-types 1 | under --aot-testing=FailSpeculations:3 1 | under --aot-harden=proof-checks 1\n";

test("a program is built as written, with its types erased, where one guess in three fails, and where proofs are checked", async () => {
  expect(await waysOf([])).toEqual(inFourWays("3"));
});

test("the builds of each way are counted, and --no-erased is named where it leaves them out", async () => {
  const [whole, first] = await Promise.all([driven([]), driven(["--no-erased"])]);
  expect(countsOf(whole)).toBe(fourBuilds + "left out by a line: 0 not compared | 0 not built\n");
  expect(countsOf(first)).toBe(
    "builds by way: compiled 1 | --no-erased leaves out every build behind the first\n" +
      "left out by a line: 0 not compared | 0 not built\n",
  );
});

test.each([
  ["137940", "3"],
  ["137941", "2"],
  ["137942", "7"],
])("in build %s of CI it is one guess in %s", async (number, n) => {
  expect(await waysOf([], { BUILDKITE_BUILD_NUMBER: number })).toEqual(inFourWays(n));
});

test("--one-guess-in says which, with a seed or without", async () => {
  expect(await waysOf(["--one-guess-in=5:8"], { BUILDKITE_BUILD_NUMBER: "137941" })).toEqual(inFourWays("5:8"));
});

test.each(["1", "1:8", "0", "three"])(
  "--one-guess-in=%s is refused: where every guess fails no typed copy is entered",
  async n => {
    const { lines, stderr, exitCode } = await driven([`--one-guess-in=${n}`]);
    expect({ lines, stderr, exitCode }).toEqual({
      lines: [],
      stderr: expect.stringContaining(`error: --one-guess-in=${n}: <n> or <n>:<seed>, and n over 1\n`),
      exitCode: 1,
    });
  },
);

const notCompared = "// Prints what goes by the copy that runs: nothing, for the test\n";

test("a program that prints what goes by the copy that runs is built and run there, and not compared", async () => {
  const ran = await driven([], {}, notCompared);
  expect({ ...saidOf(ran), counts: countsOf(ran) }).toEqual({
    ways: {
      compiled: "pass",
      "under --aot-erase-types": "built and run, not compared",
      "under --aot-testing=FailSpeculations:3": "built and run, not compared",
      "under --aot-harden=proof-checks": "built and run, not compared",
    },
    counts:
      fourBuilds +
      "left out by a line: 3 not compared | 0 not built\n" +
      "  not compared: sums.ts under --aot-erase-types\n" +
      "  not compared: sums.ts under --aot-testing=FailSpeculations:3\n" +
      "  not compared: sums.ts under --aot-harden=proof-checks\n",
    exitCode: 0,
  });
});

const noBuild = "// No build under --aot-harden=proof-checks";
const { "under --aot-harden=proof-checks": _, ...theOtherThree } = inFourWays("3").ways;

test("a line leaves the build of one way out; the other ways are held, and stderr lists it", async () => {
  const ran = await driven([], {}, `${noBuild}: for the test\n`);
  expect({ ...saidOf(ran), counts: countsOf(ran) }).toEqual({
    ways: theOtherThree,
    counts:
      "builds by way: compiled 1 | under --aot-erase-types 1 | under --aot-testing=FailSpeculations:3 1\n" +
      "left out by a line: 0 not compared | 1 not built\n" +
      "  not built: sums.ts under --aot-harden=proof-checks\n",
    exitCode: 0,
  });
});

const noSuchWay = "its flags are those of no way in which the program is built whatever the build of CI";
const misspelt = `${noBuild.replace("proof-checks", "proof-cheks")}: for the test`;
const refusedLines = [
  ["names a way that this driver does not build", `${misspelt}\n`, noSuchWay],
  [
    "names the way that goes by the number of CI's build",
    "// No build under --aot-testing=FailSpeculations:3: for the test\n",
    noSuchWay,
  ],
  ["says no reason", `${noBuild}:\n`, "it says no reason"],
  ["says blanks for a reason", `${noBuild}:   \n`, "it says no reason"],
  [
    "names the way that goes by the number of CI's build though the program asks for it itself",
    "// Under: --aot-testing=FailSpeculations:3: for the test\n// No build under --aot-testing=FailSpeculations:3: for the test\n",
    noSuchWay,
  ],
  [
    "leaves every build behind the first uncompared and says no reason",
    "// Prints what goes by the copy that runs:\n",
    "it says no reason",
  ],
  ["stands below the head", `\n${noBuild}: for the test\n`, "it stands below the head"],
].map(([what, head, why], row) => [what, head, why, `line-${row}.ts`]);
// Such a line is refused where the program is read, before its first build. So one start judges all of them, a program each, and --no-erased spares the builds behind the first, which ask the compiler and not this driver.
const withRefusedLines = () =>
  started(["--no-erased"], {}, Object.fromEntries(refusedLines.map(([, head, , name]) => [name, head + program])));

test.each(refusedLines)("a line that %s fails the program", async (_, head, why, name) => {
  expect(saidOf(await withRefusedLines(), name)).toEqual({
    ways: { compiled: "fail" },
    stage: "read",
    // The line, and why it is not read.
    message: `${head.split("\n").findLast(Boolean)}: ${why}`,
    exitCode: 1,
  });
});

// One of them with the builds behind the first: the driver has one verdict for a file, and here three ways pass beside the one that is refused.
test("a line that is not read leaves out no build: the other three ways pass, and the line alone fails the program", async () => {
  const ran = await driven([], {}, `${misspelt}\n`);
  expect({ ...saidOf(ran), counts: countsOf(ran) }).toEqual({
    ways: {
      compiled: "fail",
      "under --aot-erase-types": "pass",
      "under --aot-testing=FailSpeculations:3": "pass",
      "under --aot-harden=proof-checks": "pass",
    },
    stage: "read",
    message: `${misspelt}: ${noSuchWay}`,
    counts: fourBuilds + "left out by a line: 0 not compared | 0 not built\n",
    exitCode: 1,
  });
});

test("another exit code in a way that is not compared fails it all the same", async () => {
  expect(saidOf(await driven([], {}, notCompared, "process.exit(3);\n"))).toEqual({
    ways: {
      compiled: "fail",
      "under --aot-erase-types": "fail",
      "under --aot-testing=FailSpeculations:3": "fail",
      "under --aot-harden=proof-checks": "fail",
    },
    // The line of the file is that of its first build: plain Bun ends with 3 too, and no `// Exit code:` says so.
    stage: "reference",
    message: "the reference ended with exit code 3, not with 0: see `// Exit code:`",
    exitCode: 1,
  });
});

// The program of from-source/machine/where-the-emitters-hold-the-dividend-of-a-division-of-the-built-ins-is-held-to-its-told-range.ir, which says what the fault does to it.
// Its loop counts `left` down. With one that tests `turn !== turns`, the first build and the one with its types erased never end under this fault, and fill the memory until the driver ends them.
const dividesUnderAFalseRange = `const given: number[] = JSON.parse("[-9, 0, 4, 2, 7]");
function tally(low: number, add: number, step: number, by: number, turns: number): unknown[] {
  const out: unknown[] = [];
  const divisor = (by & 7) + 1;
  let held: number | undefined = undefined;
  for (let left = turns; left > 0; left--) {
    const turn = turns - left;
    if (held !== undefined && -1 < held && held <= 1000) out.push((held / divisor) | 0);
    else out.push("none");
    held = (low | 0) + ((add + turn * step) | 0);
  }
  return out;
}
console.log(tally(given[0]!, given[1]!, given[2]!, given[3]!, given[4]!).join(" "));
`;

test("a stop in a way that is not compared fails it all the same", async () => {
  const head = `// Flags: --aot-testing=TreatEqualIntegersAsLess\n${notCompared}`;
  const ran = await driven([], {}, head, dividesUnderAFalseRange);
  expect({ ...saidOf(ran), stderr: verdictOf(ran)?.actual?.stderr }).toEqual({
    // Nothing but the stop fails the program: the builds without the check print what plain Bun prints.
    ways: {
      compiled: "pass",
      "under --aot-erase-types": "built and run, not compared",
      "under --aot-testing=FailSpeculations:3": "built and run, not compared",
      "under --aot-harden=proof-checks": "fail",
    },
    stage: "run",
    message: "under --aot-harden=proof-checks: it ended by SIGABRT",
    stderr: expect.stringMatching(/^bun: internal AOT error: type check failed at \S+ \(tally\)$/m),
    exitCode: 1,
  });
});

// Some thirty thousand files. Where they are not in the page cache their reads take seconds, and one behind another several times as long.
// So the scan begins before the first test, reads them beside one another, and goes on beside the starts of the driver. Its test waits for what is left of it.
async function scanStoredPrograms() {
  const stored = join(import.meta.dir, "parallel");
  const files = await Array.fromAsync(new Bun.Glob("**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}").scan(stored));
  const found = await Promise.all(
    files.map(async file =>
      Array.from(
        (await Bun.file(join(stored, file)).text()).matchAll(lineThatLeavesOut),
        ([, what]) => `${file.replaceAll("\\", "/")}: ${what}`,
      ),
    ),
  );
  return found.flat().sort();
}
let linesInStoredPrograms: Promise<string[]>;
beforeAll(() => {
  linesInStoredPrograms = scanStoredPrograms();
  // A rejection is for its test to report, and not for whichever test runs at that moment.
  linesInStoredPrograms.catch(() => {});
});

test("the lines by which something of a stored program is not compared or not built are these, and a new one is written here too", async () => {
  expect(await linesInStoredPrograms).toEqual([
    "async/await-direct-call-function-tests-args.ts: Prints what the compiler saves",
    "async/await-direct-call-untyped-version/main.ts: Prints what the compiler saves",
    "calls-fast-paths/class-as-value/main.ts: Prints what the compiler saves",
    "classes-left-to-their-records/structures-and-prototype-objects-wait-for-the-first-touch.ts: Prints what the compiler saves",
    "external-data/bun-file-json-parsed-by-type.ts: Prints what the compiler saves",
    "gc/a-generator-lets-go-of-the-old-value-of-a-variable-assigned-again.mjs: Prints what the compiler saves",
    "gc/a-generator-lets-go-of-what-lives-only-across-a-yield-on-a-way-not-taken.mjs: Prints what the compiler saves",
    "gc/a-generator-that-has-ended-lets-go-of-what-it-stored.mjs: Prints what the compiler saves",
    "lists-handed-to-apply/a-written-list-of-66000-elements-handed-to-a-function-in-sight.cjs: No build under --aot-harden=proof-checks",
  ]);
});

test("--no-erased leaves it out with the other builds behind the first, and --deal prices it", async () => {
  expect(await waysOf(["--no-erased"])).toEqual({ ways: { compiled: "pass" }, exitCode: 0 });
  // One line for the program, with what all of its builds take: four, or the first alone.
  const [whole, first] = await Promise.all([driven(["--deal"]), driven(["--deal", "--no-erased"])]);
  const ms: number = first.lines[0]?.ms;
  expect(ms).toBeGreaterThan(0);
  expect([whole, first].map(({ lines, exitCode }) => ({ lines, exitCode }))).toEqual([
    { lines: [{ ms: 4 * ms, files: [join(whole.root, "sums.ts")] }], exitCode: 0 },
    { lines: [{ ms, files: [join(first.root, "sums.ts")] }], exitCode: 0 },
  ]);
});
