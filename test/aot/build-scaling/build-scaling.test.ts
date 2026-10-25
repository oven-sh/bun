// A program twice as large costs the compiler about twice as much: in work and in memory. A step that looks at everything once for each thing costs four
// times as much, and one that does so in rounds eight times. On the programs of the other tests such a step takes no time at all, and on a large
// application it takes minutes or gigabytes.
//
// Each shape of ./shapes.ts is built at a size, at twice that size and at size 0, on one thread. Two things are counted: the instructions that the build
// executes in user mode, and the most memory it has resident. Both are counts: no clock. The instructions are the same at any load; the memory of one
// and the same build wavers by some 20 MB from run to run.
//
//   growth     (cost at twice the size - cost at size 0) / (cost at the size - cost at size 0)     may not pass 2.5
//   budget     the cost at twice the size may not pass what ./budgets.linux-x64.json has for the shape by more than a fifth
//
// A shape that grows faster than 2.5 times today has its growth in the file, and may not pass that, on any platform: the aim is that no shape has one.
// The file only goes down. Whoever means to accept a worse number edits it, where a reviewer sees it.
//
// One more build has all the shapes as its entry points, on four threads. The stages of a build run one after another, and a stage takes the memory that
// the stage before it has freed, so the build needs what its largest stage needs. On one thread that is so by itself. On several threads it also takes
// an allocator that hands what one thread has freed to the others, or back to the system. Only its memory is held against the budget, with less slack:
// it wavers by a twentieth.
//
// Instructions are counted with perf_event_open on Linux and /usr/bin/time -l on macOS; where neither may be used only the memory is judged. The growth
// of memory is judged only where the size adds enough of it to tell it from what the allocators keep for themselves. The budgets are those of Linux on x64 with glibc.
//
//   bun test test/aot/build-scaling                                     all shapes (a minute on eight cores)
//   AOT_BUILD_SCALING=wrappers bun test test/aot/build-scaling          the shapes whose name contains the text
//   AOT_BUILD_SCALING_FACTOR=2 bun test test/aot/build-scaling          all sizes twice as large; no budget is held against them
//   AOT_BUDGETS=lower bun test test/aot/build-scaling                   writes every number that got better into the file
//   AOT_BUDGETS=accept bun test test/aot/build-scaling                  writes every number as measured
//
// Each shape prints one line that begins with SCALING.
import { afterAll, expect } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isMusl, isWindows, tempDir } from "harness";
import { join } from "path";
import { measureCommand, type Cost } from "../analysis-scaling/measure-check";
import { withThreads } from "../harness/flags";
import { slot, spawned, withoutDebugInformation } from "../run-programs";
import { describe, test } from "../supported";
import { shapes, type Shape } from "./shapes";

interface Budget {
  /** At twice the size. */
  millionInstructions?: number;
  megabytes: number;
  /** Only where it is over `mostGrowth` today. */
  growth?: { instructions?: number; peakBytes?: number };
}

const mostGrowth = 2.5;
const leastBytesJudged = 96 * 1024 * 1024;
const leastInstructionsJudged = 300_000_000;
// What a budget leaves to the changes that every week brings. A step that explodes passes it at once.
const slack = 1.2;
// The numbers in the file were counted with glibc. With musl one shape has cost a third more instructions, and has grown a fifth faster.
const slackOfGrowth = isMusl ? 1.3 : 1.1;
const factor = Number(process.env.AOT_BUILD_SCALING_FACTOR) || 1;
const wanted = process.env.AOT_BUILD_SCALING ?? "";
const mode = process.env.AOT_BUDGETS;
const budgetsPath = join(import.meta.dir, "budgets.linux-x64.json");
const budgets: Record<string, Budget> = existsSync(budgetsPath) ? JSON.parse(readFileSync(budgetsPath, "utf8")) : {};
const holdsBudgets = isLinux && !isMusl && process.arch === "x64" && factor === 1;
const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions and bytes"
    : isWindows
      ? "it counts with perf_event_open or /usr/bin/time -l"
      : undefined;
if (skipped) console.error(`SKIPPED: test/aot/build-scaling: ${skipped}`);

async function measure(shape: Shape, size: number, carrier: string[]): Promise<Cost> {
  using folder = tempDir("aot-build-scaling", shape.write(size));
  const cwd = String(folder);
  let entry = shape.entry;
  if (shape.isBundledFirst) {
    const bundled = await spawned([bunExe(), "build", "--target=bun", entry, "--outfile", "bundle.js"], cwd, bunEnv);
    expect({ stderr: bundled.stderr, exitCode: bundled.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
    entry = "bundle.js";
  }
  const executable = join(cwd, "program");
  try {
    return await measureCommand(
      cwd,
      [bunExe(), "build", "--compile", "--aot", withThreads(1), ...carrier, entry, "--outfile", executable],
      900_000,
      bunEnv,
      shape.isRefused ? 1 : 0,
    );
  } finally {
    rmSync(executable, { force: true });
  }
}

const allShapesTogether = "all shapes as the entry points of one build, on four threads";
const slackOfAllShapesTogether = 1.15;

async function measureAllShapesTogether(carrier: string[]): Promise<Cost> {
  const built = shapes.filter(shape => !shape.isRefused && !shape.isBundledFirst);
  const files = built.flatMap((shape, index) =>
    Object.entries(shape.write(shape.size * factor)).map(([path, text]) => [`shape-${index}/${path}`, text]),
  );
  using folder = tempDir("aot-build-scaling", Object.fromEntries(files));
  const cwd = String(folder);
  const entryPoints = built.map((shape, index) => `./shape-${index}/${shape.entry}`);
  const executable = join(cwd, "program");
  return await measureCommand(
    cwd,
    [bunExe(), "build", "--compile", "--aot", withThreads(4), ...carrier, ...entryPoints, "--outfile", executable],
    900_000,
    bunEnv,
  );
}

const inMillions = (count: number) => Math.round(count / 1e6);
const rounded = (times: number) => Math.round(times * 100) / 100;
const lower = (a: number | undefined, b: number | undefined) =>
  a === undefined || b === undefined ? b : Math.min(a, b);

describe.skipIf(!!skipped)("compile/aot/build scaling", () => {
  const carrier = skipped ? [] : withoutDebugInformation();
  afterAll(() => {
    if (mode && holdsBudgets)
      writeFileSync(
        budgetsPath,
        JSON.stringify(
          Object.fromEntries(
            [...shapes.map(shape => shape.name), allShapesTogether].flatMap(name =>
              budgets[name] ? [[name, budgets[name]]] : [],
            ),
          ),
          null,
          2,
        ) + "\n",
      );
  });
  for (const shape of shapes) {
    if (!shape.name.includes(wanted)) continue;
    test.concurrent(
      shape.name,
      async () => {
        const size = shape.size * factor;
        const [none, once, twice] = await Promise.all(
          [0, size, 2 * size].map(size => slot(() => measure(shape, size, carrier))),
        );
        const grown = (name: keyof Cost, least: number, leastDivisor: number) => {
          if (none[name] === undefined || once[name] === undefined || twice[name] === undefined) return undefined;
          const [added, addedByTwice] = [once[name] - none[name], twice[name] - none[name]];
          // What the smaller size adds may be next to nothing, or little beside what wavers from run to run: then the quotient says little more than "much".
          return addedByTwice < least ? undefined : addedByTwice / Math.max(added, leastDivisor);
        };
        const growth = {
          instructions: grown("instructions", leastInstructionsJudged, leastInstructionsJudged / 8),
          peakBytes: grown("peakBytes", leastBytesJudged, leastBytesJudged / 2),
        };
        const row = (cost: Cost) =>
          `${cost.instructions === undefined ? "?" : inMillions(cost.instructions)} M instructions, ${inMillions(cost.peakBytes)} MB`;
        console.error(
          `SCALING ${shape.name}: 0: ${row(none)} | ${size} ${shape.counted}: ${row(once)} | ${2 * size}: ${row(twice)} | grows ${growth.instructions?.toFixed(2) ?? "-"} times in instructions, ${growth.peakBytes?.toFixed(2) ?? "-"} times in memory`,
        );

        const overTheBound = (times: number | undefined) =>
          times !== undefined && times > mostGrowth ? rounded(times) : undefined;
        const fast = { instructions: overTheBound(growth.instructions), peakBytes: overTheBound(growth.peakBytes) };
        const now: Budget = {
          millionInstructions: twice.instructions === undefined ? undefined : inMillions(twice.instructions),
          megabytes: inMillions(twice.peakBytes),
          growth: fast.instructions === undefined && fast.peakBytes === undefined ? undefined : fast,
        };
        const budget = holdsBudgets ? budgets[shape.name] : undefined;
        if (holdsBudgets && (mode === "accept" || !budget)) {
          budgets[shape.name] = now;
          expect(["accept", "lower"]).toContain(mode);
          return;
        }
        if (budget && mode === "lower") {
          const least = {
            instructions: fast.instructions && lower(budget.growth?.instructions, fast.instructions),
            peakBytes: fast.peakBytes && lower(budget.growth?.peakBytes, fast.peakBytes),
          };
          budgets[shape.name] = {
            millionInstructions: lower(budget.millionInstructions, now.millionInstructions),
            megabytes: Math.min(budget.megabytes, now.megabytes),
            growth: least.instructions === undefined && least.peakBytes === undefined ? undefined : least,
          };
        }

        const worse: string[] = [];
        for (const what of ["instructions", "peakBytes"] as const) {
          const allowed = Math.max(mostGrowth, (budgets[shape.name]?.growth?.[what] ?? 0) * slackOfGrowth);
          if (growth[what] !== undefined && growth[what] > allowed)
            worse.push(
              `twice as many ${shape.counted} cost ${growth[what].toFixed(2)} times the ${what}; allowed: ${rounded(allowed)}`,
            );
        }
        if (
          budget?.millionInstructions !== undefined &&
          now.millionInstructions !== undefined &&
          now.millionInstructions > budget.millionInstructions * slack
        )
          worse.push(
            `${2 * size} ${shape.counted} cost ${now.millionInstructions} M instructions; the budget is ${budget.millionInstructions} and a fifth`,
          );
        if (budget && now.megabytes > budget.megabytes * slack)
          worse.push(
            `${2 * size} ${shape.counted} take ${now.megabytes} MB; the budget is ${budget.megabytes} and a fifth`,
          );
        expect(worse).toEqual([]);
      },
      1_800_000,
    );
  }

  if (allShapesTogether.includes(wanted))
    test.concurrent(
      allShapesTogether,
      async () => {
        const megabytes = inMillions((await slot(() => measureAllShapesTogether(carrier))).peakBytes);
        console.error(`SCALING ${allShapesTogether}: ${megabytes} MB`);
        if (!holdsBudgets) return;
        const budget = budgets[allShapesTogether];
        if (mode === "accept" || !budget) {
          budgets[allShapesTogether] = { megabytes };
          expect(["accept", "lower"]).toContain(mode);
          return;
        }
        if (mode === "lower") budget.megabytes = Math.min(budget.megabytes, megabytes);
        expect(megabytes).toBeLessThanOrEqual(budget.megabytes * slackOfAllShapesTogether);
      },
      1_800_000,
    );
});
