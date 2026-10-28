// What the programs of ../programs/small-benchmarks and of ./witnesses cost when they run, held against ./small-benchmarks.linux-x64.json, which only goes down.
//
// ../small-benchmarks.test.ts says that they print the right thing. Nothing there says how long they take: a hot loop that the compiler takes for rare, or a
// test that fails at every access, halves the speed of a program and every test stays green. A witness is a small program on which such a fault has shown.
//
// Each program is built twice: the way a user builds it, and with a counter on each side of each branch (../harness/counted-run.ts). All numbers are counts:
// no clock, the same at any load. From each the same number of a program that prints one line is taken away: what is left is the program's own.
//
//   millionInstructions      what the run executes in user mode, on all threads (perf_event_open; not judged where that may not be used), with a collector
//                            that works on the thread of the program alone: two runs differ by a thousandth. Not judged on musl: the budgets are
//                            measured on glibc, and a program that allocates runs a fifth more there in the C library and the allocator
//   testsFailed              the tests that the compiler put in front of what it expects, and that took the side it laid out as the less likely one
//   alwaysFailing            the places whose test ran and failed every time: they cost the test and the slow side and buy nothing
//   accessesByName           the accesses that looked a property up by its name or by a key instead of loading a slot
//   runtimeOperations        the calls out of compiled code and its stubs into functions of the run time
//   callsNotExpected         the calls of functions that the compiler took for cold, for run once, or for reachable only behind a test that fails
//
// A number that is worse than its budget fails the test. Whoever means to accept it edits the file, where a reviewer sees it.
//
//   bun test test/aot/perf/small-benchmarks                         all
//   AOT_PROGRAMS=spectral bun test test/aot/perf/small-benchmarks   the programs whose name contains the text
//   AOT_BUDGETS=lower ..                                            writes every number that got better into the file
//   AOT_BUDGETS=accept ..                                           writes every number as measured
//
// Each program prints one line that begins with BUDGET.
import { afterAll, beforeAll, expect } from "bun:test";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isMusl, tempDir } from "harness";
import { basename, join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import {
  alwaysFailing,
  buildCounted,
  parseCounts,
  run,
  tabulate,
  testsAddedByTheCompiler,
  withoutCollections,
  withSteadyCollections,
} from "../harness/counted-run";
import { compileCommand, runtimeEnvironment } from "../harness/flags";
import { slot, wanted } from "../run-programs";
import { describe, test } from "../supported";

const numbers = [
  "millionInstructions",
  "testsFailed",
  "alwaysFailing",
  "accessesByName",
  "runtimeOperations",
  "callsNotExpected",
] as const;
type Budget = Partial<Record<(typeof numbers)[number], number>>;

const budgetsPath = join(import.meta.dir, "small-benchmarks.linux-x64.json");
const budgets: Record<string, Budget> = existsSync(budgetsPath) ? JSON.parse(readFileSync(budgetsPath, "utf8")) : {};
const mode = process.env.AOT_BUDGETS;
const skipped =
  !isLinux || process.arch !== "x64"
    ? "the budgets are those of Linux on x64"
    : isDebug || isASAN
      ? "a debug or ASAN build counts other instructions"
      : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/small-benchmarks.test.ts: ${skipped}`);
else if (isMusl)
  console.error("SKIPPED: test/aot/perf/small-benchmarks.test.ts: millionInstructions: the budgets are those of glibc");

const allowed = (budget: number, what: (typeof numbers)[number]) =>
  what === "millionInstructions" ? budget * 1.03 + 2 : budget * 1.01 + 2;

const folders = [join(import.meta.dir, "..", "programs", "small-benchmarks"), join(import.meta.dir, "witnesses")];
const programs = folders.flatMap(folder =>
  readdirSync(folder)
    .filter(name => /\.[jt]s$/.test(name))
    .sort()
    .map(name => join(folder, name)),
);
const nameOf = (path: string) => basename(path).replace(/\.[jt]s$/, "");

describe.skipIf(!!skipped)("compile/aot/perf/small benchmarks", () => {
  const folder = String(tempDir("aot-small-benchmarks", {}));
  const nothing = "prints-one-line.ts";
  let base: Required<Budget>;
  afterAll(() => {
    rmSync(folder, { recursive: true, force: true });
    if (mode)
      writeFileSync(
        budgetsPath,
        JSON.stringify(Object.fromEntries(Object.entries(budgets).sort(([a], [b]) => (a < b ? -1 : 1))), null, 2) +
          "\n",
      );
  });

  async function measure(source: string): Promise<Required<Budget> & { printed: string }> {
    const name = nameOf(source);
    const executable = join(folder, `${name}-plain`);
    const built = await run([bunExe(), ...compileCommand, `./${source}`, "--outfile", executable], folder, {
      ...bunEnv,
      NO_COLOR: "1",
    });
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
      stderr: expect.not.stringMatching(/^error\b/m),
      exitCode: 0,
    });
    const { instructions } = await measureCommand(folder, [executable], 300_000, {
      ...bunEnv,
      ...withSteadyCollections,
    });
    rmSync(executable);

    const counted = await buildCounted(folder, `./${source}`);
    const counts = `${counted.executable}.counts`;
    const ran = await run([counted.executable], folder, {
      ...bunEnv,
      ...withoutCollections,
      [runtimeEnvironment.forbidsInterpreter]: "1",
      [runtimeEnvironment.countsPath]: counts,
    });
    expect({ stderr: ran.stderr, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
      stderr: "",
      exitCode: 0,
      signal: null,
    });
    const work = tabulate(counted, parseCounts(""), parseCounts(readFileSync(counts, "utf8")), 1);
    rmSync(counted.executable);
    const added = work.tests.filter(each => testsAddedByTheCompiler.has(each.kind));
    return {
      printed: ran.stdout,
      millionInstructions: instructions === undefined || isMusl ? NaN : Math.round(instructions / 1e6),
      testsFailed: added.reduce((sum, each) => sum + each.failed, 0),
      alwaysFailing: alwaysFailing(added).length,
      accessesByName: work.accessesByName,
      runtimeOperations: Object.values(work.runtimeOperations).reduce((sum, count) => sum + count, 0),
      callsNotExpected: work.calls.cold + work.calls.once + work.calls.behindFailedTest,
    };
  }

  beforeAll(async () => {
    for (const path of programs) cpSync(path, join(folder, basename(path)));
    // With one function and one branch: a build with counters wants something to count.
    writeFileSync(
      join(folder, nothing),
      `function pick(count: number) {\n  return count > 99 ? "another line" : "one line";\n}\nconsole.log(pick(process.argv.length));\n`,
    );
    writeFileSync(
      join(folder, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "esnext",
          module: "preserve",
          moduleResolution: "bundler",
          allowImportingTsExtensions: true,
          typeRoots: [join(import.meta.dir, "..", "..", "..", "packages")],
          types: ["bun-types"],
          allowJs: true,
          noEmit: true,
        },
      }),
    );
    base = await measure(nothing);
  }, 600_000);

  const overTheirBudgets = new Set<string>();
  for (const path of programs) {
    const name = nameOf(path);
    if (wanted !== "quick" && !name.includes(wanted)) continue;
    (overTheirBudgets.has(name) ? test.todoIf(true) : test.concurrent)(
      name,
      () =>
        slot(async () => {
          const whole = await measure(basename(path));
          const now: Budget = {};
          for (const what of numbers)
            if (!Number.isNaN(whole[what]) && !Number.isNaN(base[what]))
              now[what] = Math.max(0, whole[what] - base[what]);
          const budget = budgets[name];
          if (mode === "accept" || !budget) {
            budgets[name] = now;
            console.error(`BUDGET ${name}: written: ${JSON.stringify(now)}`);
            expect(["accept", "lower"]).toContain(mode);
            return;
          }
          if (mode === "lower")
            budgets[name] = Object.fromEntries(
              numbers.flatMap(what =>
                now[what] === undefined ? [] : [[what, Math.min(now[what], budget[what] ?? Infinity)]],
              ),
            );
          const judged = numbers.filter(what => now[what] !== undefined && budget[what] !== undefined);
          const moved = (those: readonly (typeof numbers)[number][]) =>
            those.map(what => `${what} ${budget[what]} -> ${now[what]}`).join(", ");
          const worse = judged.filter(what => now[what]! > allowed(budget[what]!, what));
          const better = judged.filter(what => now[what]! < budget[what]! * 0.95 - 2);
          console.error(
            `BUDGET ${name}: ${[worse.length ? `WORSE: ${moved(worse)}` : "", better.length ? `better: ${moved(better)}` : ""].filter(Boolean).join("; ") || "within"}`,
          );
          expect(worse.map(what => `${what}: ${now[what]}, the budget is ${budget[what]}`)).toEqual([]);
        }),
      900_000,
    );
  }
});
