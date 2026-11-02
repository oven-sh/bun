// In text that is evaluated when the program runs, a call of one of the text's own functions costs about what a turn of the loop around it costs.
// Each row names two loops of ./evaluated-text-calls-its-own-functions/main.js, the second being the first with a call in it, and how many turns of the first the call may cost.
// Nothing is pinned: both are measured in the same executable. The allowances are those of x64. Elsewhere the numbers are printed and not judged.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";
import { countsInstructions, measureCommand } from "../analysis-scaling/measure-check";
import { built, spawned, withoutDebugInformation } from "../harness/commands";
import { withSteadyCollections } from "../harness/counted-run";
import { beforeAll, describe, test } from "../supported";

const root = join(import.meta.dir, "evaluated-text-calls-its-own-functions");

const rows: [without: string, withCall: string, turns: number][] = [
  ["a sum", "a sum of what a function returns", 1.2],
  ["a sum", "a sum of what a method returns", 1.4],
];
const [few, many] = [100_000, 400_000];

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : !countsInstructions()
      ? "instructions are not counted here"
      : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/evaluated-text-calls-its-own-functions.test.ts: ${skipped}`);

describe.skipIf(!!skipped)("compile/aot/perf/evaluated-text-calls-its-own-functions", () => {
  const folder = String(tempDir("aot-evaluated-text-calls-its-own-functions", {}));
  const executable = join(folder, "main");
  const env = { ...bunEnv, ...withSteadyCollections };

  beforeAll(async () => {
    built(
      await spawned(
        [
          bunExe(),
          "build",
          "--compile",
          "--aot",
          ...withoutDebugInformation(),
          join(root, "main.js"),
          "--outfile",
          executable,
        ],
        root,
        bunEnv,
      ),
    );
    const compiled = await spawned([executable], root, bunEnv);
    const plain = await spawned([bunExe(), "run", join(root, "main.js")], root, bunEnv);
    expect(compiled.stdout).toBe(plain.stdout);
  }, 300_000);

  async function costOf(loop: string) {
    const less = await measureCommand(root, [executable, loop, String(few)], 300_000, env);
    const more = await measureCommand(root, [executable, loop, String(many)], 300_000, env);
    if (less.instructions === undefined || more.instructions === undefined) return undefined;
    return (more.instructions - less.instructions) / (many - few);
  }

  for (const [without, withCall, turns] of rows) {
    test(`${withCall}: the call costs at most ${turns} turns of ${without}`, async () => {
      const [turn, turnWithCall] = [await costOf(without), await costOf(withCall)];
      if (turn === undefined || turnWithCall === undefined)
        return void console.error(`SKIPPED: ${withCall}: instructions cannot be counted here`);
      const call = Math.round(turnWithCall - turn);
      console.error(
        `EVALUATED TEXT CALLS ITS OWN FUNCTIONS ${without}\t${Math.round(turn)}\t| the call in ${withCall}\t${call}`,
      );
      if (process.arch !== "x64") return;
      expect({ withCall, call, isWithinAllowance: call <= turn * turns }).toEqual({
        withCall,
        call,
        isWithinAllowance: true,
      });
    }, 900_000);
  }
});
