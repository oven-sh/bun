import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { measureCommand } from "./analysis-scaling/measure-check";
import { withThreads } from "./harness/flags";
import type { Program } from "./long-functions-programs";

async function instructionsOfBuild(program: Program) {
  using dir = tempDir("aot-long-functions-counted", { "main.js": program.source });
  const cwd = String(dir);
  const command = [bunExe(), "build", "--compile", "--aot", withThreads(1), "./main.js", "--outfile", "./main"];
  const { instructions } = await measureCommand(cwd, command, 200_000);
  await using ran = Bun.spawn({ cmd: ["./main"], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [output, errors, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  expect({ output, errors, exitCode }).toEqual({ output: program.output, errors: "", exitCode: 0 });
  return instructions;
}

// Instructions on one thread are the same at any load, so the bound is closer to four than a bound on time can be.
// What a build of nothing costs is left out.
export async function expectLinearInstructionCount(
  few: number,
  writeProgramOfSize: (size: number) => Program,
  mostGrowth: number,
) {
  const programs = [{ source: "console.log(0);", output: "0\n" }, writeProgramOfSize(few), writeProgramOfSize(4 * few)];
  const [withNone, withFew, withMany] = await Promise.all(programs.map(instructionsOfBuild));
  if (withNone === undefined || withFew === undefined || withMany === undefined) return;
  expect((withMany - withNone) / (withFew - withNone)).toBeLessThan(mostGrowth);
}
