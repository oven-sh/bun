// A program twice as large costs the compiler about twice as much: in work and in memory. A step that looks at everything once for each thing costs four
// times as much, and one that does so in rounds eight times. On the programs of the other tests such a step takes no time at all, and on a large
// application it takes minutes or gigabytes.
//
// Each shape of ./shapes.ts is built at a size, at twice that size and at size 0, on one thread. Two things are counted: the instructions that the build
// executes in user mode, and the most memory it has resident. Both are counts: no clock. The instructions are the same at any load; the memory of one
// and the same build wavers by some 20 MB from run to run.
//
//   growth     (cost at twice the size - cost at size 0) / (cost at the size - cost at size 0)     may not pass 2.1
//
// The bound is the same for every shape, on every platform, but for what a shape says of its own.
//
// By default the allocator returns freed memory to the system after a delay, by the clock, so a build has resident what it needs plus whatever is still
// waiting to be returned. Two runs of one compiler then differ by up to 40 MB, and the growth of one shape by up to 28%. A build runs with
// MIMALLOC_PURGE_DELAY=0, which returns freed memory at once: two runs differ by a few MB, and a growth by 2%.
// What is left: up to 30 MB more in one run than in the next where the setting has no effect. Where the smaller size adds under 100 MB, three
// such numbers make a quotient that is off by a half. A growth in memory that is over its bound is measured again, and each of the three sizes keeps the
// least that it was seen to take: what a build needs it takes every time. Size 0 keeps the least of all the shapes of the file that are the
// same program there: one shape in ten is.
//
// A step that takes a hundredth of a build may grow four times and the build not show it. The build counts the steps of much such work, and what it
// emits, and prints the counts under --explain=statistics: they are exact, the same from run to run, and the growth of each is held to the same bound,
// but for the counts of characters. A count may leap once, where a table doubles; what grows too fast does so at half the size too, so a count that is
// over its bound is asked there again, in one more build. The counts that a shape names (`counts`) are judged however small, by the two sizes alone.
// A test run prints no counts, and neither does a build that is refused.
//
// Instructions are counted with perf_event_open on Linux; where it may not be used the memory and the counts are judged. The growth
// of memory is judged only where the size adds enough of it to tell it from what the allocators keep for themselves. A size that nothing is judged by is not built.
// On macOS every shape is built and the counts alone are judged: /usr/bin/time -l counts what the kernel does for the build with the rest, and says a number only where the agent is no virtual
// machine, so the same commit rang or not by the agent that took the job; and the growth of one shape in memory, by one compiler, read 1.86, 1.94, 2.03 and 2.10 there.
//
// CI tests Linux under three distributions, on x64 and on arm64. Alpine on x64 is where it may count instructions. Debian on x64 judges what grows in memory
// and in counts with glibc, and Alpine on arm64 with the other back end. The other lanes would judge that once more, and build nothing.
//
// The shapes are dealt out over the files build-scaling-<part>.test.ts in turn.
//
//   bun test test/aot/build-scaling                                     all shapes (a minute on eight cores)
//   AOT_BUILD_SCALING=wrappers bun test test/aot/build-scaling          the shapes whose name contains the text
//   AOT_BUILD_SCALING_FACTOR=2 bun test test/aot/build-scaling          all sizes twice as large
//
// Each shape prints one line that begins with SCALING.
import { expect } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isMacOS, isMusl, isWindows, tempDir } from "harness";
import { join } from "path";
import { countsInstructions, measureCommandWithMemory, type Cost } from "../analysis-scaling/measure-check";
import { countsIn } from "../compiler/measure";
import { slot, spawned, withoutDebugInformation } from "../harness/commands";
import { withThreads } from "../harness/flags";
import { describe, test } from "../supported";
import { mostGrowth } from "./recorded-growth";
import { shapes, type Shape } from "./shapes";

type Built = Cost & { counts: Record<string, number> };

const leastBytesJudged = 96 * 1024 * 1024;
const leastInstructionsJudged = 300_000_000;
const leastCountJudged = 20_000;
const factor = Number(process.env.AOT_BUILD_SCALING_FACTOR) || 1;
const wanted = process.env.AOT_BUILD_SCALING ?? "";
// .buildkite/ci.ts sets it.
const distribution = process.env.EXPECTED_PLATFORM_DISTRO;
const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions and bytes"
    : isWindows
      ? "it counts with perf_event_open or /usr/bin/time -l"
      : distribution && !isMusl && !(distribution === "debian" && process.arch === "x64")
        ? "Debian on x64 and Alpine judge all that would be judged here"
        : undefined;
if (skipped) console.error(`SKIPPED: test/aot/build-scaling: ${skipped}`);

const envOfShapeBuilds = { ...bunEnv, MIMALLOC_PURGE_DELAY: "0" };
// `bun test --aot` takes no number of threads: it compiles on as many as there are processors that it may use, and what threads execute while they wait
// for one another is counted with the rest. One program read 3,930, 4,168 and 4,535 million instructions on one machine, and its growth 1.80 to 2.03, and
// 3.32 on a busier one. Held to one processor it compiles on one thread, as a build with --aot-threads=1 does: 3,867, 3,870 and 3,872 million.
const taskset = isLinux ? Bun.which("taskset") : null;
const onOneProcessor = taskset
  ? [taskset, "-c", /^Cpus_allowed_list:\s*(\d+)/m.exec(readFileSync("/proc/self/status", "utf8"))![1]]
  : [];
const printsCounts = (shape: Shape) => !shape.isTestRun && !shape.isRefused;
const judgesCountsAlone = isMacOS;
// A later name is longer (e9999, e10000), so twice as many names are more than twice the characters: 2.13 times from 16,000 names to 32,000.
// A file that is read again shows in SourceLines and its like, and a text that is written again in TableBytesEmitted, which counts the text of the image too.
const countsOfCharacters = new Set([
  "SourceBytes",
  "SourceBytesOfPackages",
  "SourceBytesOfDeclarations",
  "SourceBytesOfBun",
  "TextBytesEmitted",
]);
// The code of an image is laid out in whole pages of 16 KB, so what the last page of size 0 has left over is filled for nothing: 127,205 bytes of functions
// and then 254,705 were counted as 114,688 and 245,760, which is 2.14 times. Its parts are counted to the byte and judged: FunctionBytesEmitted,
// SharedCodeBytesEmitted, WasmCodeBytesEmitted, FFICodeBytesEmitted, RegExpCodeBytesEmitted.
const countsOfWholePages = new Set(["CodeBytesEmitted"]);
// What is laid between two things so that the second begins on a boundary goes by where the first happens to end.
const countsOfPadding = new Set(["PaddingBytesBetweenFunctions", "PaddingBytesBetweenCodeParts", "PaddingBytesBetweenConstants"]);

// The code of an image ends on a boundary of 16 KB, and so do parts of its tables. So what a size adds to these counts is up to a step more or less than what the program added: 28 KB more code for each
// thousand names read as one step, then three: "3.00 times". They are judged by the least growth that the steps allow.
const bytesOfStep = 16384;
const countsThatMoveInSteps = new Set(["CodeBytesEmitted", "TableBytesEmitted"]);

async function measure(shape: Shape, size: number, carrier: string[]): Promise<Built> {
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
    const cost = await measureCommandWithMemory(
      cwd,
      shape.isTestRun
        ? [...onOneProcessor, bunExe(), "test", "--aot", ...(shape.flags ?? []), entry]
        : [
            bunExe(),
            "build",
            "--compile",
            "--aot",
            withThreads(1),
            ...(shape.flags ?? []),
            ...(shape.isRefused ? [] : ["--explain=statistics"]),
            ...carrier,
            entry,
            "--outfile",
            executable,
          ],
      900_000,
      envOfShapeBuilds,
      shape.isRefused ? 1 : 0,
    );
    return { ...cost, counts: printsCounts(shape) ? countsIn(cost.stderr) : {} };
  } finally {
    rmSync(executable, { force: true });
  }
}

// CI ends a test file that has run for five minutes.
const lastStart = 200_000;

/** Other work on the machine only adds to a peak of memory. What is over its bound is measured again, four times at most: code that costs more does so every time. */
async function measureUntilWithinBounds<T>(
  name: string,
  measureOnce: () => Promise<T>,
  isWithinBounds: (measured: T) => boolean,
): Promise<T> {
  for (let attemptsLeft = 3; ; attemptsLeft--) {
    const measured = await measureOnce();
    if (attemptsLeft === 0 || isWithinBounds(measured) || performance.now() > lastStart) return measured;
    console.error(`ASKED AGAIN: ${name}`);
  }
}

const inMillions = (count: number) => Math.round(count / 1e6);
const leastPeakOfNothing = new Map<string, number>();

export const buildScaling = (part: number, parts: number) =>
  describe.skipIf(!!skipped)("compile/aot/build scaling", () => {
    const carrier = skipped ? [] : withoutDebugInformation();
    const countsInstructionsHere = !judgesCountsAlone && countsInstructions();
    for (const [index, shape] of shapes.entries()) {
      if (!shape.name.includes(wanted) || index % parts !== part - 1) continue;
      const growsSoFar =
        shape.growsSoFar ??
        (countsInstructionsHere ? shape.growsSoFarInInstructions : undefined) ??
        (countsInstructionsHere && isMusl ? shape.growsSoFarInInstructionsUnderMusl : undefined) ??
        (isLinux && process.arch === "arm64" ? shape.growsSoFarOnLinuxArm64 : undefined);
      (growsSoFar ? test.concurrent.failing : test.concurrent)(
        growsSoFar ? `${shape.name}: ${growsSoFar}; the bound is ${mostGrowth}` : shape.name,
        async () => {
          const size = shape.size * factor;
          const mostGrowthInMemory = shape.mostGrowthInMemory ?? mostGrowth;
          const mostGrowthInInstructions = shape.mostGrowthInInstructions ?? mostGrowth;
          type Costs = [none: Built, once: Built | undefined, twice: Built];
          const grown = ([none, once, twice]: Costs, name: keyof Cost, least: number, leastDivisor: number) => {
            if (none[name] === undefined || once?.[name] === undefined || twice[name] === undefined) return undefined;
            const [added, addedByTwice] = [once[name] - none[name], twice[name] - none[name]];
            // What the smaller size adds may be next to nothing, or little beside what wavers from run to run: then the quotient says little more than "much".
            return addedByTwice < least ? undefined : addedByTwice / Math.max(added, leastDivisor);
          };
          // Some shapes are the same program at size 0: each of its builds says what that program needs.
          const nothing = JSON.stringify([
            shape.write(0),
            shape.entry,
            shape.flags,
            shape.isBundledFirst,
            shape.isTestRun,
          ]);
          const grownInMemory = ([none, once, twice]: Costs) => {
            const peakBytes = Math.min(none.peakBytes, leastPeakOfNothing.get(nothing) ?? Infinity);
            leastPeakOfNothing.set(nothing, peakBytes);
            return grown([{ ...none, peakBytes }, once, twice], "peakBytes", leastBytesJudged, leastBytesJudged / 2);
          };
          const grownInCount = ([none, once, twice]: Costs, name: string) => {
            const step = countsThatMoveInSteps.has(name) ? bytesOfStep : 0;
            return (twice.counts[name] - none.counts[name] - step) / Math.max(once!.counts[name] - none.counts[name] + step, 1);
          };
          let leastSeen: Costs | undefined;
          const costs = await measureUntilWithinBounds(
            shape.name,
            async () => {
              const build = (size: number) => slot(() => measure(shape, size, carrier));
              // A slot goes to whoever asked first.
              const largest = build(2 * size);
              // Its counts or its instructions are judged, so the smaller size is wanted whatever else turns out.
              const early = printsCounts(shape) || countsInstructionsHere ? build(size) : undefined;
              const [none, twice] = await Promise.all([build(0), largest]);
              const isOnceJudged =
                !judgesCountsAlone &&
                (none.instructions !== undefined || twice.peakBytes - none.peakBytes >= leastBytesJudged);
              const once = await (early ?? (isOnceJudged ? build(size) : undefined));
              const least = (cost: Built, seen: Built | undefined) => ({
                ...cost,
                peakBytes: Math.min(cost.peakBytes, seen?.peakBytes ?? Infinity),
              });
              leastSeen = [
                least(none, leastSeen?.[0]),
                once && least(once, leastSeen?.[1]),
                least(twice, leastSeen?.[2]),
              ];
              return leastSeen;
            },
            costs => judgesCountsAlone || (grownInMemory(costs) ?? 0) <= mostGrowthInMemory,
          );
          const [none, once, twice] = costs;
          const growth: { instructions: number | undefined; peakBytes: number | undefined } = judgesCountsAlone
            ? { instructions: undefined, peakBytes: undefined }
            : {
                instructions: grown(costs, "instructions", leastInstructionsJudged, leastInstructionsJudged / 8),
                peakBytes: grownInMemory(costs),
              };
          const suspects = !once
            ? []
            : Object.keys(twice.counts).filter(
                name =>
                  !countsOfCharacters.has(name) &&
                  !countsOfWholePages.has(name) &&
                  !countsOfPadding.has(name) &&
                  !shape.counts?.includes(name) &&
                  twice.counts[name] - none.counts[name] >= leastCountJudged &&
                  grownInCount(costs, name) > mostGrowth,
              );
          const growsInMemory = once && growth.peakBytes !== undefined && growth.peakBytes > mostGrowthInMemory;
          const half =
            suspects.length || growsInMemory ? await slot(() => measure(shape, Math.round(size / 2), carrier)) : undefined;
          // A build of nothing may hold its most memory in another stage than the one that grows with the shape. Then the memory is a straight line that starts BELOW what size 0 takes, and measured from
          // there twice the size adds more than twice as much: 113 MB at 0, 201 at 40,000 cases, 299 at 80,000 reads 2.11, and 152 at 20,000 shows 49, then 98 more. So a growth over the bound is judged
          // again by what each doubling adds. Of a square the second doubling adds four times what the first added.
          if (growsInMemory)
            growth.peakBytes = Math.min(
              growth.peakBytes!,
              (twice.peakBytes - once.peakBytes) / Math.max(once.peakBytes - half!.peakBytes, leastBytesJudged / 4),
            );
          // What a doubling adds still wavers where it adds little: tables double and the allocators take memory in pieces of tens of MB. 2,000 texts more add 40 MB, 4,000 more 88, and that reads 2.2;
          // 8,000 more add 169, 16,000 more 324, 32,000 more 645: a straight line. So where the work has not grown past its bound, memory that is still over its own is asked at twice the size again.
          // Of a square that doubling too adds four times what the one before it added.
          let builtAtFourTimes: Promise<Built> | undefined;
          const buildAtFourTimes = () => (builtAtFourTimes ??= slot(() => measure(shape, 4 * size, carrier)));
          if (growsInMemory && growth.peakBytes! > mostGrowthInMemory && (growth.instructions ?? 0) <= mostGrowthInInstructions) {
            const fourTimes = await buildAtFourTimes();
            growth.peakBytes = Math.min(
              growth.peakBytes!,
              (fourTimes.peakBytes - twice.peakBytes) / Math.max(twice.peakBytes - once.peakBytes, leastBytesJudged / 4),
            );
          }
          // Where half the size adds nothing there is no growth to read.
          // A count may begin to rise only past a limit of the compiler: an object lists 4,095 names, data is nested 2,000 deep, a text of 64 KB is made: past it each name, level or line counts, and in front of it
          // none. That is a straight line that starts to the right of size 0: 80,000 and 160,000 bytes of text read (160,000 - 65,536) / (80,000 - 65,536) = 6.53 times. What each doubling adds tells it from a
          // square, of which the second doubling adds four times what the first added.
          const growsAtHalfTheSizeToo = (name: string) =>
            half!.counts[name] > none.counts[name] &&
            grownInCount([none, half, once!], name) > mostGrowth &&
            (twice.counts[name] - once!.counts[name]) / Math.max(once!.counts[name] - half!.counts[name], 1) > mostGrowth;
          // Past such a limit each may also count for more than in front of it: a name adds 5 edges to Link's flow up to 4,095 names and 12 from there on. That is a straight line with a bend, and with the bend
          // between half the size and the size all three readings take it for a square: 2.66, 2.89, 2.54. Behind the bend it is straight, so it is asked at twice the size again, as memory is: 2.00.
          let growing = suspects.filter(growsAtHalfTheSizeToo);
          if (growing.length && (growth.instructions ?? 0) <= mostGrowthInInstructions) {
            const fourTimes = await buildAtFourTimes();
            growing = growing.filter(
              name =>
                (fourTimes.counts[name] - twice.counts[name]) / Math.max(twice.counts[name] - once!.counts[name], 1) > mostGrowth,
            );
          }
          const growthOfCounts = [...(shape.counts ?? []), ...growing].map(
            name => [name, grownInCount(costs, name)] as const,
          );
          const row = (cost: Cost | undefined) =>
            !cost
              ? "not built"
              : `${cost.instructions === undefined ? "?" : inMillions(cost.instructions)} M instructions, ${inMillions(cost.peakBytes)} MB`;
          console.error(
            `SCALING ${shape.name}: 0: ${row(none)} | ${size} ${shape.counted}: ${row(once)} | ${2 * size}: ${row(twice)} | grows ${growth.instructions?.toFixed(2) ?? "-"} times in instructions, ${growth.peakBytes?.toFixed(2) ?? "-"} times in memory${growthOfCounts.map(([name, times]) => `, ${times.toFixed(2)} times in ${name} (${twice.counts[name]})`).join("")}`,
          );

          const worse: string[] = [];
          for (const [what, most] of [["instructions", mostGrowthInInstructions], ["peakBytes", mostGrowthInMemory]] as const) {
            if (growth[what] !== undefined && growth[what] > most)
              worse.push(
                `twice as many ${shape.counted} cost ${growth[what].toFixed(2)} times the ${what}; allowed: ${most}`,
              );
          }
          for (const [name, times] of growthOfCounts)
            if (!(times <= mostGrowth))
              worse.push(
                `twice as many ${shape.counted} cost ${times.toFixed(2)} times the ${name}; allowed: ${mostGrowth}`,
              );
          expect(worse).toEqual([]);
        },
        1_800_000,
      );
    }
  });
