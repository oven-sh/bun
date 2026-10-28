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
// Most of what a small build has resident has nothing to do with its program, and about a third of that is pages of Bun's own file: how many depends on how
// Bun was linked and on what else the machine is doing. The file has that number once, for a program of one line. Where size 0 of a shape takes more than
// that, the difference is left out of the shape's memory, so one row fails and not all of them. A build that is over its budget in memory is measured again,
// together with a new build of size 0.
//
// The allocator hands freed memory back to the system a while after it was freed, by the clock. So a build has resident what it needs and, on top, what an
// earlier stage has freed and the system has not got back yet: up to 30 MB more in one run than in the next. Where the smaller size adds under 100 MB, three
// such numbers make a quotient that is off by a half. A growth in memory that is over its bound is measured again, and each of the three sizes keeps the
// least that it was seen to take: what a build needs it takes every time.
//
// One more build has all the shapes as its entry points, on four threads. The stages of a build run one after another, and a stage takes the memory that
// the stage before it has freed, so the build needs what its largest stage needs. On one thread that is so by itself. On several threads it also takes
// an allocator that hands what one thread has freed to the others, or back to the system. Only its memory is held against the budget, with less slack:
// it wavers by a twentieth.
//
// One row uses a clock, as a ratio. Files whose tsconfig.json changes a program-wide compiler option get a separate checker program per set of options.
// Those programs are independent and run in parallel, so the stages they run in must take at most half as long on eight threads as on one.
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
import { availableParallelism } from "os";
import { join } from "path";
import { measureCommandWithMemory, type Cost } from "../analysis-scaling/measure-check";
import { readBuildReport } from "../harness/build-report";
import { slot, spawned, withoutDebugInformation } from "../harness/commands";
import { withReport, withThreads } from "../harness/flags";
import { measureUntilWithinBounds } from "../harness/measure-again";
import { describe, test } from "../supported";
import { packagesWithOwnCompilerOptions, shapes, type Shape } from "./shapes";

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
    return await measureCommandWithMemory(
      cwd,
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        withThreads(1),
        ...(shape.flags ?? []),
        ...carrier,
        entry,
        "--outfile",
        executable,
      ],
      900_000,
      bunEnv,
      shape.isRefused ? 1 : 0,
    );
  } finally {
    rmSync(executable, { force: true });
  }
}

const oneLine = "a program of one line";
const bytesOfOneLineInFile = (budgets[oneLine]?.megabytes ?? Infinity) * 1e6;

async function measureOneLine(carrier: string[]): Promise<Cost> {
  using folder = tempDir("aot-build-scaling", { "main.js": "console.log(0);\n" });
  const cwd = String(folder);
  const executable = join(cwd, "program");
  return await measureCommandWithMemory(
    cwd,
    [bunExe(), "build", "--compile", "--aot", withThreads(1), ...carrier, "main.js", "--outfile", executable],
    900_000,
    bunEnv,
  );
}

const allShapesTogether = "all shapes as the entry points of one build, on four threads";
const slackOfAllShapesTogether = 1.15;

async function measureAllShapesTogether(carrier: string[]): Promise<Cost> {
  const built = shapes.filter(
    shape => !shape.isRefused && !shape.isBundledFirst && !shape.flags && !shape.isExcludedFromCombinedBuild,
  );
  const files = built.flatMap((shape, index) =>
    Object.entries(shape.write(shape.size * factor)).map(([path, text]) => [`shape-${index}/${path}`, text]),
  );
  using folder = tempDir("aot-build-scaling", Object.fromEntries(files));
  const cwd = String(folder);
  const entryPoints = built.map((shape, index) => `./shape-${index}/${shape.entry}`);
  const executable = join(cwd, "program");
  return await measureCommandWithMemory(
    cwd,
    [bunExe(), "build", "--compile", "--aot", withThreads(4), ...carrier, ...entryPoints, "--outfile", executable],
    900_000,
    bunEnv,
  );
}

const parallelProgramsRow = "checker programs of packages with different compiler options, eight threads against one";
const maxRatioToOneThread = 0.5;

async function measureFrontEndMilliseconds(threads: number, carrier: string[]): Promise<number> {
  const shape = packagesWithOwnCompilerOptions;
  using folder = tempDir("aot-build-scaling", shape.write(2 * shape.size * factor));
  const cwd = String(folder);
  const report = join(cwd, "report.json");
  const command = [
    bunExe(),
    "build",
    "--compile",
    "--aot",
    withThreads(threads),
    ...withReport(report, "summary"),
    ...carrier,
  ];
  const built = await spawned([...command, shape.entry, "--outfile", join(cwd, "program")], cwd, bunEnv);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  const { statistics } = readBuildReport(report);
  return (statistics.BindModulesNanoseconds + statistics.CheckNanoseconds + statistics.LowerNanoseconds) / 1e6;
}

const inMillions = (count: number) => Math.round(count / 1e6);
/** What `build` has resident, less what a build of nothing takes here over what the file has for a program of one line. */
const judgedMegabytes = (nothing: Cost, build: Cost) =>
  inMillions(build.peakBytes - Math.max(0, nothing.peakBytes - bytesOfOneLineInFile));
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
            [oneLine, ...shapes.map(shape => shape.name), allShapesTogether].flatMap(name =>
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
        const budget = holdsBudgets ? budgets[shape.name] : undefined;
        const grown = ([none, once, twice]: Cost[], name: keyof Cost, least: number, leastDivisor: number) => {
          if (none[name] === undefined || once[name] === undefined || twice[name] === undefined) return undefined;
          const [added, addedByTwice] = [once[name] - none[name], twice[name] - none[name]];
          // What the smaller size adds may be next to nothing, or little beside what wavers from run to run: then the quotient says little more than "much".
          return addedByTwice < least ? undefined : addedByTwice / Math.max(added, leastDivisor);
        };
        const grownInMemory = (costs: Cost[]) => grown(costs, "peakBytes", leastBytesJudged, leastBytesJudged / 2);
        const allowedGrowth = (what: keyof Cost) =>
          Math.max(mostGrowth, (budgets[shape.name]?.growth?.[what] ?? 0) * slackOfGrowth);
        let leastSeen: Cost[] | undefined;
        const costs = await measureUntilWithinBounds(
          shape.name,
          async () => {
            const measured = await Promise.all(
              [0, size, 2 * size].map(size => slot(() => measure(shape, size, carrier))),
            );
            leastSeen = measured.map((cost, index) => ({
              ...cost,
              peakBytes: Math.min(cost.peakBytes, leastSeen?.[index].peakBytes ?? Infinity),
            }));
            return leastSeen;
          },
          costs => (grownInMemory(costs) ?? 0) <= allowedGrowth("peakBytes"),
        );
        const [none, once, twice] = costs;
        const growth = {
          instructions: grown(costs, "instructions", leastInstructionsJudged, leastInstructionsJudged / 8),
          peakBytes: grownInMemory(costs),
        };
        const row = (cost: Cost) =>
          `${cost.instructions === undefined ? "?" : inMillions(cost.instructions)} M instructions, ${inMillions(cost.peakBytes)} MB`;
        console.error(
          `SCALING ${shape.name}: 0: ${row(none)} | ${size} ${shape.counted}: ${row(once)} | ${2 * size}: ${row(twice)} | grows ${growth.instructions?.toFixed(2) ?? "-"} times in instructions, ${growth.peakBytes?.toFixed(2) ?? "-"} times in memory`,
        );

        const overTheBound = (times: number | undefined) =>
          times !== undefined && times > mostGrowth ? rounded(times) : undefined;
        const fast = { instructions: overTheBound(growth.instructions), peakBytes: overTheBound(growth.peakBytes) };
        const isWithinBudget = (megabytes: number) => !budget || megabytes <= budget.megabytes * slack;
        const now: Budget = {
          millionInstructions: twice.instructions === undefined ? undefined : inMillions(twice.instructions),
          megabytes: isWithinBudget(judgedMegabytes(none, twice))
            ? judgedMegabytes(none, twice)
            : await measureUntilWithinBounds(
                shape.name,
                async () => {
                  const [none, twice] = await Promise.all(
                    [0, 2 * size].map(size => slot(() => measure(shape, size, carrier))),
                  );
                  return judgedMegabytes(none, twice);
                },
                isWithinBudget,
              ),
          growth: fast.instructions === undefined && fast.peakBytes === undefined ? undefined : fast,
        };
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
          const allowed = allowedGrowth(what);
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
        if (budget && !isWithinBudget(now.megabytes))
          worse.push(
            `${2 * size} ${shape.counted} take ${now.megabytes} MB; the budget is ${budget.megabytes} and a fifth`,
          );
        expect(worse).toEqual([]);
      },
      1_800_000,
    );
  }

  if (parallelProgramsRow.includes(wanted))
    test.skipIf(availableParallelism() < 4)(
      parallelProgramsRow,
      async () => {
        const measured = await measureUntilWithinBounds(
          parallelProgramsRow,
          async () => ({
            onOne: await measureFrontEndMilliseconds(1, carrier),
            onEight: await measureFrontEndMilliseconds(8, carrier),
          }),
          ({ onOne, onEight }) => onEight <= onOne * maxRatioToOneThread,
        );
        console.error(
          `SCALING ${parallelProgramsRow}: ${Math.round(measured.onEight)} ms against ${Math.round(measured.onOne)} ms`,
        );
        expect(measured.onEight).toBeLessThanOrEqual(measured.onOne * maxRatioToOneThread);
      },
      1_800_000,
    );

  for (const [name, slackOfRow, measureMegabytes] of [
    [oneLine, slack, async () => inMillions((await slot(() => measureOneLine(carrier))).peakBytes)],
    [
      allShapesTogether,
      slackOfAllShapesTogether,
      async () => {
        const [nothing, all] = await Promise.all([
          slot(() => measureOneLine(carrier)),
          slot(() => measureAllShapesTogether(carrier)),
        ]);
        return judgedMegabytes(nothing, all);
      },
    ],
  ] as const)
    if (name.includes(wanted))
      test.concurrent(
        name,
        async () => {
          const budget = holdsBudgets ? budgets[name] : undefined;
          const megabytes = await measureUntilWithinBounds(
            name,
            measureMegabytes,
            megabytes => !budget || megabytes <= budget.megabytes * slackOfRow,
          );
          console.error(`SCALING ${name}: ${megabytes} MB`);
          if (!holdsBudgets) return;
          if (mode === "accept" || !budget) {
            budgets[name] = { megabytes };
            expect(["accept", "lower"]).toContain(mode);
            return;
          }
          if (mode === "lower") budget.megabytes = Math.min(budget.megabytes, megabytes);
          expect(megabytes).toBeLessThanOrEqual(budget.megabytes * slackOfRow);
        },
        1_800_000,
      );
});
