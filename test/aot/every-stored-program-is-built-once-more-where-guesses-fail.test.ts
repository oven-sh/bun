// run-parallel.ts builds every stored program once more with --aot-testing=FailGuesses:<n>: one guess in n fails on purpose, so that the program walks the ways from its typed copies into the
// closed ones, and it must print what plain Bun prints there too. No flag asks for that build: it is made wherever the builds behind the first are made.
// And once more with --aot-harden=proof-checks, where a proof that does not hold stops the program by name. The builds of each way are counted on stderr, so that no flag drops a way without a word.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const program = `function sum(list: number[]) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}
console.log(sum([1, 2, 3.5]), sum([4, 5, 6]));
`;

async function driven(words: string[], environment: Record<string, string> = {}, head = "") {
  using folder = tempDir("where-guesses-fail", { "tsconfig.json": "{}", "sums.ts": head + program });
  const root = String(folder);
  const { BUILDKITE_BUILD_NUMBER: _, ...env } = bunEnv;
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), join(import.meta.dir, "run-parallel.ts"), `--root=${root}`, "--jobs=3", ...words, join(root, "sums.ts")],
    root,
    { ...env, ...environment },
  );
  const lines = stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
  return { lines, stderr, exitCode };
}
const waysOf = async (words: string[], environment?: Record<string, string>) => {
  const { lines, exitCode } = await driven(words, environment);
  return { ways: lines.find(({ state }) => state !== "compiling")?.ways, exitCode };
};
const inFourWays = (n: string) => ({
  ways: {
    compiled: "pass",
    "under --aot-erase-types": "pass",
    [`under --aot-testing=FailGuesses:${n}`]: "pass",
    "under --aot-harden=proof-checks": "pass",
  },
  exitCode: 0,
});

test("a program is built as written, with its types erased, where one guess in three fails, and where proofs are checked", async () => {
  expect(await waysOf([])).toEqual(inFourWays("3"));
}, 120_000);

test("the builds of each way are counted, and --no-erased is named where it leaves them out", async () => {
  expect((await driven([])).stderr).toContain(
    "builds by way: compiled 1 | under --aot-erase-types 1 | under --aot-testing=FailGuesses:3 1 | under --aot-harden=proof-checks 1\n",
  );
  expect((await driven(["--no-erased"])).stderr).toContain(
    "builds by way: compiled 1 | --no-erased leaves out every build behind the first\n",
  );
}, 120_000);

test.each([
  ["137940", "3"],
  ["137941", "2"],
  ["137942", "7"],
])(
  "in build %s of CI it is one guess in %s",
  async (number, n) => {
    expect(await waysOf([], { BUILDKITE_BUILD_NUMBER: number })).toEqual(inFourWays(n));
  },
  120_000,
);

test("--one-guess-in says which, with a seed or without", async () => {
  expect(await waysOf(["--one-guess-in=5:8"], { BUILDKITE_BUILD_NUMBER: "137941" })).toEqual(inFourWays("5:8"));
}, 120_000);

test.each(["1", "1:8", "0", "three"])(
  "--one-guess-in=%s is refused: where every guess fails no typed copy is entered",
  async n => {
    const { lines, stderr, exitCode } = await driven([`--one-guess-in=${n}`]);
    expect({ lines, exitCode }).toEqual({ lines: [], exitCode: 1 });
    expect(stderr).toContain(`--one-guess-in=${n}: <n> or <n>:<seed>, and n over 1`);
  },
);

test("a program that prints what goes by the copy that runs is built and run there, and not compared", async () => {
  const { lines, exitCode } = await driven(
    [],
    {},
    "// Prints what goes by the copy that runs: nothing, for the test\n",
  );
  expect({ ways: lines.find(({ state }) => state !== "compiling")?.ways, exitCode }).toEqual({
    ways: {
      compiled: "pass",
      "under --aot-erase-types": "built and run, not compared",
      "under --aot-testing=FailGuesses:3": "built and run, not compared",
      "under --aot-harden=proof-checks": "built and run, not compared",
    },
    exitCode: 0,
  });
}, 120_000);

test("a line leaves one way uncompared, and another leaves its build out; the other ways are held as ever", async () => {
  const waysUnder = async (head: string) => {
    const { lines, exitCode } = await driven([], {}, head);
    return { ways: lines.find(({ state }) => state !== "compiling")?.ways, exitCode };
  };
  const { "under --aot-harden=proof-checks": _, ...theOtherThree } = inFourWays("3").ways;
  expect(await waysUnder("// Skip under --aot-harden=proof-checks: for the test\n")).toEqual({
    ways: { ...theOtherThree, "under --aot-harden=proof-checks": "built and run, not compared" },
    exitCode: 0,
  });
  expect(await waysUnder("// No build under --aot-harden=proof-checks: for the test\n")).toEqual({ ways: theOtherThree, exitCode: 0 });
}, 240_000);

test("--no-erased leaves it out with the other builds behind the first, and --deal prices it", async () => {
  expect(await waysOf(["--no-erased"])).toEqual({ ways: { compiled: "pass" }, exitCode: 0 });
  const priceOf = async (words: string[]) => (await driven(["--deal", ...words])).lines[0].ms as number;
  expect(await priceOf([])).toBe(4 * (await priceOf(["--no-erased"])));
}, 120_000);
