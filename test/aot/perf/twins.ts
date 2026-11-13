// The same work in two spellings, measured in one executable: the second may take at most so many times the instructions of the first.
import { afterAll, beforeAll, describe, expect } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import { without } from "../harness/capabilities";
import { built, spawned, withoutDebugInformation } from "../harness/commands";
import { eachRow } from "../supported";

export type Row = [file: string, baseline: string, other: string, times: number];
/** A loop whose twin got cheaper than it: it may take at most so many instructions a turn, whatever its twin takes. */
export type CountedRow = [file: string, loop: string, most: number];

// A debug or ASAN build counts other instructions.
const isSlowBuild = isDebug || isASAN;

// A collection starts only when enough has been allocated, never on a timer, and runs entirely on the program's thread.
const withSteadyCollections = {
  BUN_GC_TIMER_DISABLE: "1",
  BUN_JSC_percentCPUPerMBForEdenTimer: "0",
  BUN_JSC_percentCPUPerMBForFullTimer: "0",
  BUN_JSC_useConcurrentGC: "0",
  BUN_JSC_numberOfGCMarkers: "1",
};
// Two processes that do the same differ by up to 35,000 instructions, so what is compared is a thousand times that. A counted loop of over 2 ** 20 turns goes through another copy of it.
const instructionsOfReading = 20_000_000;
const mostTurns = 2 ** 20;

/** Each row names a file of `folder` and two of its loops. `programOf` names the program that has the loops of a file: without arguments it prints what every loop returns, and `<file> <loop> <turns>` runs one. */
export function describeTwins(
  title: string,
  folder: string,
  rows: Row[],
  programOf: (file: string) => string,
  counted: CountedRow[] = [],
) {
  describe.skipIf(isSlowBuild || !!without("a counter of instructions"))(`compile/aot/perf/${title}`, () => {
    const executables = String(tempDir(`aot-${title}`, {}));
    const executableOf = (program: string) => join(executables, program.replaceAll(".", "-"));
    const env = { ...bunEnv, ...withSteadyCollections };

    beforeAll(async () => {
      for (const program of new Set([...rows, ...counted].map(([file]) => programOf(file)))) {
        const executable = executableOf(program);
        built(
          await spawned(
            [
              bunExe(),
              "build",
              "--compile",
              "--aot",
              ...withoutDebugInformation(),
              join(folder, program),
              "--outfile",
              executable,
            ],
            folder,
            bunEnv,
          ),
        );
        const compiled = await spawned([executable], folder, bunEnv);
        const plain = await spawned([bunExe(), "run", join(folder, program)], folder, bunEnv);
        expect({ program, stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
          program,
          stdout: plain.stdout,
          exitCode: 0,
        });
      }
    }, 240_000);
    afterAll(() => rmSync(executables, { recursive: true, force: true }));

    async function aTurn(file: string, loop: string, few: number, many: number) {
      const command = [executableOf(programOf(file)), file, loop];
      const less = await measureCommand(folder, [...command, String(few)], 60_000, env);
      const more = await measureCommand(folder, [...command, String(many)], 60_000, env);
      if (less.instructions === undefined || more.instructions === undefined)
        throw new Error("instructions are not counted here, and the lane says they are");
      return Math.max(1, (more.instructions - less.instructions) / (many - few));
    }
    const costs = new Map<string, number>();
    async function costOf(file: string, loop: string, again = false) {
      const name = file + " " + loop;
      const known = costs.get(name);
      if (known !== undefined && !again) return known;
      const turns = Math.min(
        mostTurns,
        Math.max(400, Math.round(instructionsOfReading / (known ?? (await aTurn(file, loop, 50, 250))))),
      );
      const cost = Math.min(known ?? Infinity, await aTurn(file, loop, turns >> 2, turns));
      costs.set(name, cost);
      return cost;
    }

    eachRow(rows)(
      "%s: %s | %s: at most %d times",
      async (file, baseline, other, times) => {
        let expected = await costOf(file, baseline);
        let measured = await costOf(file, other);
        for (let again = 0; again < 2 && measured > expected * times && measured < expected * times * 1.1; again++) {
          expected = await costOf(file, baseline, true);
          measured = await costOf(file, other, true);
        }
        const ratio = Math.round((100 * measured) / expected) / 100;
        console.error(
          `${title.toUpperCase().replaceAll("-", " ")} ${file}\t${baseline}\t${Math.round(expected)}\t| ${other}\t${Math.round(measured)}\t${ratio} of ${times}`,
        );
        expect({ other, ratio, isWithinAllowance: measured <= expected * times }).toEqual({
          other,
          ratio,
          isWithinAllowance: true,
        });
      },
      60_000,
    );

    eachRow(counted)(
      "%s: %s: at most %d instructions a turn",
      async (file, loop, most) => {
        let measured = await costOf(file, loop);
        for (let again = 0; again < 2 && measured > most && measured < most * 1.1; again++)
          measured = await costOf(file, loop, true);
        const instructions = Math.round(100 * measured) / 100;
        console.error(`${title.toUpperCase().replaceAll("-", " ")} ${file}\t${loop}\t${instructions} of ${most}`);
        expect({ loop, instructions, isWithinAllowance: measured <= most }).toEqual({
          loop,
          instructions,
          isWithinAllowance: true,
        });
      },
      60_000,
    );
  });
}
