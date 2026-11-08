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

async function driven(words: string[], environment: Record<string, string> = {}, head = "", text = program) {
  using folder = tempDir("where-guesses-fail", { "tsconfig.json": "{}", "sums.ts": head + text });
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

const skipHere = `// Skip on ${process.platform} ${process.arch} under --aot-harden=proof-checks`;
const waysUnder = async (head: string, text?: string) => {
  const { lines, stderr, exitCode } = await driven([], {}, head, text);
  return { ways: lines.find(({ state }) => state !== "compiling")?.ways, stderr, exitCode };
};
const { "under --aot-harden=proof-checks": _, ...theOtherThree } = inFourWays("3").ways;

test("a line leaves one way uncompared on one platform, and another leaves its build out; the other ways are held, and stderr lists both", async () => {
  expect(await waysUnder(`${skipHere}: for the test\n`)).toEqual({
    ways: { ...theOtherThree, "under --aot-harden=proof-checks": "built and run, not compared" },
    stderr: expect.stringMatching(
      /left out by a line: 1 not compared \| 0 not built\n  not compared: \S*sums\.ts under --aot-harden=proof-checks\n/,
    ),
    exitCode: 0,
  });
  expect(await waysUnder("// No build under --aot-harden=proof-checks: for the test\n")).toEqual({
    ways: theOtherThree,
    stderr: expect.stringMatching(
      /left out by a line: 0 not compared \| 1 not built\n  not built: \S*sums\.ts under --aot-harden=proof-checks\n/,
    ),
    exitCode: 0,
  });
  expect(await waysUnder("// Skip on plan9 mips under --aot-harden=proof-checks: for the test\n")).toEqual({
    ...inFourWays("3"),
    stderr: expect.stringContaining("left out by a line: 0 not compared | 0 not built\n"),
  });
}, 360_000);

test.each([
  ["names no platform", "// Skip under --aot-harden=proof-checks: for the test\n"],
  ["names a way that this driver does not build", `${skipHere.replace("proof-checks", "proof-cheks")}: for the test\n`],
  [
    "names the way that goes by the number of CI's build",
    "// No build under --aot-testing=FailGuesses:3: for the test\n",
  ],
  ["says no reason", `${skipHere}:\n`],
  ["stands below the head", `\n${skipHere}: for the test\n`],
])(
  "a line that %s fails the program",
  async (_, head) => {
    const { lines, exitCode } = await driven([], {}, head);
    expect({ failed: lines.filter(({ state }) => state === "fail").map(({ stage }) => stage), exitCode }).toEqual({
      failed: expect.arrayContaining(["read"]),
      exitCode: 1,
    });
  },
  120_000,
);

test("a stop in a way that is not compared fails it all the same", async () => {
  const { ways, exitCode } = await waysUnder(
    `// Flags: --aot-testing=EqualIntegersAreTakenToBeLess\n${skipHere}: for the test\n`,
    `const given: number[] = JSON.parse("[-9, 0, 4, 2, 7]");
function tally(low: number, add: number, step: number, by: number, turns: number): unknown[] {
  const out: unknown[] = [];
  const divisor = (by & 7) + 1;
  let held: number | undefined = undefined;
  for (let turn = 0; turn !== turns; turn++) {
    if (held !== undefined && -1 < held && held <= 1000) out.push((held / divisor) | 0);
    else out.push("none");
    held = (low | 0) + ((add + turn * step) | 0);
  }
  return out;
}
console.log(tally(given[0]!, given[1]!, given[2]!, given[3]!, given[4]!).join(" "));
`,
  );
  expect({ way: ways?.["under --aot-harden=proof-checks"], exitCode }).toEqual({ way: "fail", exitCode: 1 });
}, 120_000);

test("the lines that leave a way of a stored program out are these, and a new one is written here too", async () => {
  const stored = join(import.meta.dir, "parallel");
  const found: string[] = [];
  for await (const file of new Bun.Glob("**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}").scan(stored))
    for (const [, line] of (await Bun.file(join(stored, file)).text()).matchAll(
      /^\/\/ ((?:Skip(?: on \w+ \w+)? under(?! ASAN:)|No build under) .*?):/gm,
    ))
      found.push(`${file.replaceAll("\\", "/")}: ${line}`);
  expect(found.sort()).toEqual([
    "cells-lent-to-callees/what-was-lent-is-let-go-on-every-way-into-a-handler.ts: Skip on linux arm64 under --aot-harden=proof-checks",
    "cells-lent-to-callees/what-was-lent-is-let-go-where-another-argument-throws.ts: Skip on linux arm64 under --aot-harden=proof-checks",
    "lists-handed-to-apply/a-written-list-of-66000-elements-handed-to-a-function-in-sight.cjs: No build under --aot-harden=proof-checks",
  ]);
}, 120_000);

test("--no-erased leaves it out with the other builds behind the first, and --deal prices it", async () => {
  expect(await waysOf(["--no-erased"])).toEqual({ ways: { compiled: "pass" }, exitCode: 0 });
  const priceOf = async (words: string[]) => (await driven(["--deal", ...words])).lines[0].ms as number;
  expect(await priceOf([])).toBe(4 * (await priceOf(["--no-erased"])));
}, 120_000);
