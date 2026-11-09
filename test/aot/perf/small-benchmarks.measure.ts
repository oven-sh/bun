// What the programs of ../parallel/small-benchmarks cost when they run, held against ./small-benchmarks.linux-x64.json, which only goes down.
//
// ../run-parallel.ts holds what they print to plain Bun. Nothing there says how long they take: a test that fails at every access halves the speed of a
// program and every test stays green.
//
//   millionInstructions      what the run executes in user mode, on all threads (perf_event_open), with a collector that works on the thread of the
//                            program alone: no clock, the same at any load, and two runs differ by a thousandth. The same number of a program that
//                            prints one line is taken away: what is left is the program's own. The budgets are measured on glibc: on musl a
//                            program that allocates runs a fifth more, in the C library and the allocator
//
// A number that is worse than its budget fails the test. Whoever means to accept it edits the file, where a reviewer sees it.
//
//   bun test ./test/aot/perf/small-benchmarks.measure.ts   all
//   AOT_PROGRAMS=spectral ..                               the programs whose name contains the text
//   AOT_BUDGETS=lower ..                                   writes every number that got better into the file
//   AOT_BUDGETS=accept ..                                  writes every number as measured
//
// Each program prints one line that begins with BUDGET.
import { afterAll, beforeAll, expect } from "bun:test";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isMusl, tempDir } from "harness";
import { basename, join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import { slot } from "../harness/commands";
import { compileCommand, runtimeEnvironment } from "../harness/flags";
import { run } from "../harness/run";
import { describe, test } from "../supported";

// Collections come by bytes allocated and run on the program's own thread.
// With the collector's own threads on, counts differ by some percent from run to run.
const withSteadyCollections = {
  BUN_GC_TIMER_DISABLE: "1",
  BUN_JSC_percentCPUPerMBForEdenTimer: "0",
  BUN_JSC_percentCPUPerMBForFullTimer: "0",
  BUN_JSC_useConcurrentGC: "0",
  BUN_JSC_numberOfGCMarkers: "1",
};

type Budget = { millionInstructions: number };

const wanted = process.env.AOT_PROGRAMS ?? "";
const budgetsPath = join(import.meta.dir, "small-benchmarks.linux-x64.json");
const budgets: Record<string, Budget> = existsSync(budgetsPath) ? JSON.parse(readFileSync(budgetsPath, "utf8")) : {};
const mode = process.env.AOT_BUDGETS;
const skipped =
  !isLinux || process.arch !== "x64"
    ? "the budgets are those of Linux on x64"
    : isDebug || isASAN
      ? "a debug or ASAN build counts other instructions"
      : isMusl
        ? "the budgets are those of glibc"
        : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/small-benchmarks.measure.ts: ${skipped}`);

const allowed = (budget: number) => budget * 1.03 + 2;

const programsFolder = join(import.meta.dir, "..", "parallel", "small-benchmarks");
const programs = readdirSync(programsFolder)
  .filter(name => /\.[jt]s$/.test(name))
  .sort()
  .map(name => join(programsFolder, name));
const nameOf = (path: string) => basename(path).replace(/\.[jt]s$/, "");

describe.skipIf(!!skipped)("compile/aot/perf/small benchmarks", () => {
  const folder = String(tempDir("aot-small-benchmarks", {}));
  const nothing = "prints-one-line.ts";
  let base: number | undefined;
  afterAll(() => {
    rmSync(folder, { recursive: true, force: true });
    if (mode)
      writeFileSync(
        budgetsPath,
        JSON.stringify(Object.fromEntries(Object.entries(budgets).sort(([a], [b]) => (a < b ? -1 : 1))), null, 2) +
          "\n",
      );
  });

  /** Undefined where instructions cannot be counted. */
  async function millionInstructionsOf(source: string) {
    const executable = join(folder, `${nameOf(source)}-built`);
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
      [runtimeEnvironment.forbidsInterpreter]: "1",
    });
    rmSync(executable);
    return instructions === undefined ? undefined : Math.round(instructions / 1e6);
  }

  beforeAll(async () => {
    for (const path of programs) cpSync(path, join(folder, basename(path)));
    writeFileSync(join(folder, nothing), `console.log("one line");\n`);
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
    base = await millionInstructionsOf(nothing);
  }, 600_000);

  const overTheirBudgets = new Set<string>();
  for (const path of programs) {
    const name = nameOf(path);
    if (wanted !== "quick" && !name.includes(wanted)) continue;
    (overTheirBudgets.has(name) ? test.todoIf(true) : test.concurrent)(
      name,
      () =>
        slot(async () => {
          const whole = await millionInstructionsOf(basename(path));
          if (whole === undefined || base === undefined)
            return void console.error(`SKIPPED: ${name}: instructions cannot be counted here`);
          const now = Math.max(0, whole - base);
          const budget = budgets[name]?.millionInstructions;
          if (mode === "accept" || budget === undefined) {
            budgets[name] = { millionInstructions: now };
            console.error(`BUDGET ${name}: written: ${now}`);
            expect(["accept", "lower"]).toContain(mode);
            return;
          }
          if (mode === "lower") budgets[name] = { millionInstructions: Math.min(now, budget) };
          const isWorse = now > allowed(budget);
          const isBetter = now < budget * 0.95 - 2;
          console.error(
            `BUDGET ${name}: ${isWorse ? "WORSE: " : isBetter ? "better: " : "within: "}millionInstructions ${budget} -> ${now}`,
          );
          expect({ name, now, budget, isWorse }).toEqual({ name, now, budget, isWorse: false });
        }),
      900_000,
    );
  }
});
