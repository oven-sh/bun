import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { measureCommandWithMemory } from "./analysis-scaling/measure-check";
import { withThreads } from "./harness/flags";
import type { Program } from "./long-functions-programs";

async function costOfBuild(program: Program) {
  using dir = tempDir("aot-long-functions-counted", { "main.js": program.source });
  const cwd = String(dir);
  const command = [bunExe(), "build", "--compile", "--aot", withThreads(1), "./main.js", "--outfile", "./main"];
  const cost = await measureCommandWithMemory(cwd, command, 200_000);
  await using ran = Bun.spawn({ cmd: ["./main"], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [output, errors, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  expect({ output, errors, exitCode }).toEqual({ output: program.output, errors: "", exitCode: 0 });
  return cost;
}

const emptyProgram = { source: "console.log(0);", output: "0\n" };

// Instructions on one thread are the same at any load, so the bound is closer to four than a bound on time can be.
// What a build of nothing costs is left out.
export async function expectLinearInstructionCount(
  few: number,
  writeProgramOfSize: (size: number) => Program,
  mostGrowth: number,
) {
  const programs = [emptyProgram, writeProgramOfSize(few), writeProgramOfSize(4 * few)];
  const [withNone, withFew, withMany] = (await Promise.all(programs.map(costOfBuild))).map(cost => cost.instructions);
  if (withNone === undefined || withFew === undefined || withMany === undefined) return;
  expect((withMany - withNone) / (withFew - withNone)).toBeLessThan(mostGrowth);
}

// What is measured: the memory that a build needs for the items, which is the least that a build of the program has resident at
// its peak, less the least that a build of nothing has. One build's peak wavers by some 20 MB with how the allocator and the
// threads of the process happen to meet, on both sides, so each side is built three times and its least peak counts: the program
// only until a build is within the bound. For the build of nothing that asks more than one build did. A peak that only some builds
// of one program reach is not what this holds.
// The program has to add many times what a peak wavers by.
// A step that keeps something for each pair of items passes a bound on the bytes for each item as the size grows.
export async function expectPeakBytesForEachItem(
  size: number,
  writeProgramOfSize: (size: number) => Program,
  mostBytesForEachItem: number,
) {
  const leastPeakBytesOf = async (program: Program, isLowEnough: (peakBytes: number) => boolean) => {
    let least = Infinity;
    for (let build = 0; build < 3 && !isLowEnough(least); build++)
      least = Math.min(least, (await costOfBuild(program)).peakBytes);
    return least;
  };
  const withNone = await leastPeakBytesOf(emptyProgram, () => false);
  const withAll = await leastPeakBytesOf(
    writeProgramOfSize(size),
    peakBytes => (peakBytes - withNone) / size < mostBytesForEachItem,
  );
  expect((withAll - withNone) / size).toBeLessThan(mostBytesForEachItem);
}
