// run-parallel.ts builds every stored program once more with --aot-testing=FailGuesses:<n>: one guess in n fails on purpose, so that the program walks the ways from its typed copies into the
// closed ones, and it must print what plain Bun prints there too. No flag asks for that build: it is made wherever the builds behind the first are made.
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
const inThreeWays = (n: string) => ({
  ways: { compiled: "pass", "under --aot-erase-types": "pass", [`under --aot-testing=FailGuesses:${n}`]: "pass" },
  exitCode: 0,
});

test("a program is built as written, with its types erased, and where one guess in three fails", async () => {
  expect(await waysOf([])).toEqual(inThreeWays("3"));
}, 120_000);

test.each([
  ["137940", "3"],
  ["137941", "2"],
  ["137942", "7"],
])(
  "in build %s of CI it is one guess in %s",
  async (number, n) => {
    expect(await waysOf([], { BUILDKITE_BUILD_NUMBER: number })).toEqual(inThreeWays(n));
  },
  120_000,
);

test("--one-guess-in says which, with a seed or without", async () => {
  expect(await waysOf(["--one-guess-in=5:8"], { BUILDKITE_BUILD_NUMBER: "137941" })).toEqual(inThreeWays("5:8"));
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
    },
    exitCode: 0,
  });
}, 120_000);

test("--no-erased leaves it out with the other builds behind the first, and --deal prices it", async () => {
  expect(await waysOf(["--no-erased"])).toEqual({ ways: { compiled: "pass" }, exitCode: 0 });
  const priceOf = async (words: string[]) => (await driven(["--deal", ...words])).lines[0].ms as number;
  expect(await priceOf([])).toBe(3 * (await priceOf(["--no-erased"])));
}, 120_000);
