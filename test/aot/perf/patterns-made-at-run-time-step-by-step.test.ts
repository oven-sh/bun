// A pattern whose text the build cannot know is matched step by step, by a machine and not by code of its own. Three things that made a match dearer than it has to be went unseen,
// because every pin holds a whole match: here one row of ./patterns-made-at-run-time-step-by-step/main.js is held against another of the same executable.
// - `x[a-z]*[0-9]` can begin where two characters say so. Eight units were copied into a buffer and looked through by vectors to learn that the match begins at the first: 154 instructions for one more step.
// - `(?=([a-z]*))\1` spells a run that gives nothing back. It took a lookahead, a group, a run with a frame, the end of the lookahead and a reference that reads the run again: it is one step.
// - A text with a surrogate pair under the flag u goes to the machine that can do everything. It kept its position, its step and its stack in memory, and read and wrote them at every step.
// - `^(?:break|case|catch)$` asks whether the text is one of a few words. The machine was set up, chose by the first letter and compared: the word is looked up by its length and its ends.
// - A text of 16-bit units, or a slice of one, went to the operation that can do everything, 200 instructions more than the same text in 8 bits: it goes to the program as straight as that.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";
import { countsInstructions, measureCommand } from "../analysis-scaling/measure-check";
import { built, spawned, withoutDebugInformation } from "../harness/commands";
import { withSteadyCollections } from "../harness/counted-run";
import { beforeAll, describe, test } from "../supported";

const root = join(import.meta.dir, "patterns-made-at-run-time-step-by-step");
// As counted on Linux x64: 455 against 405 (it was 560 against 406), 890 against 993 (it was 1,094), 9,967 against 9,013 (it was 11,169), 229 against 288 (it was 366), and 264 against 231 (it was 442). Elsewhere a step may take another instruction.
const slack = process.platform === "linux" && process.arch === "x64" ? 0 : 0.05;
const rows: [row: string, yardstick: string, times: number][] = [
  ["a-digit-behind-a-run-behind-a-letter", "a-run-behind-a-letter", 1.2 + slack],
  ["three-runs-in-lookaheads-read-again", "three-runs-in-groups", 1 + slack],
  ["many-steps-behind-a-surrogate-pair", "many-steps-behind-a-wide-character", 1.17 + slack],
  ["one-word-of-a-list-of-words", "one-word", 1 + slack],
  ["one-wide-word-of-a-list-of-words", "one-word-of-a-list-of-words", 1.2 + slack],
];
const turns = 400_000;

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : !countsInstructions()
      ? "instructions are not counted here"
      : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/patterns-made-at-run-time-step-by-step.test.ts: ${skipped}`);

describe.skipIf(!!skipped)("compile/aot/perf/patterns-made-at-run-time-step-by-step", () => {
  const folder = String(tempDir("aot-patterns-made-at-run-time-step-by-step", {}));
  const executable = join(folder, "main");
  const env = { ...bunEnv, ...withSteadyCollections };
  const costs = new Map<string, Promise<number | undefined>>();

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

  function costOf(row: string) {
    let cost = costs.get(row);
    if (!cost) {
      cost = (async () => {
        const few = turns / 4;
        const less = await measureCommand(root, [executable, row, String(few)], 300_000, env);
        const more = await measureCommand(root, [executable, row, String(turns)], 300_000, env);
        if (less.instructions === undefined || more.instructions === undefined) return undefined;
        return Math.round(((more.instructions - less.instructions) / (turns - few)) * 10) / 10;
      })();
      costs.set(row, cost);
    }
    return cost;
  }

  for (const [row, yardstick, times] of rows) {
    test(`${row}: at most ${times === 1 ? "as many instructions as" : `${times} times the instructions of`} ${yardstick}`, async () => {
      const [allowed, measured] = [await costOf(yardstick), await costOf(row)];
      if (allowed === undefined || measured === undefined)
        return void console.error(`SKIPPED: ${row}: instructions cannot be counted here`);
      console.error(`PATTERNS STEP BY STEP ${yardstick}\t${allowed}\t| ${row}\t${measured}`);
      expect({ row, measured, allowed, isWithin: measured <= allowed * times }).toEqual({
        row,
        measured,
        allowed,
        isWithin: true,
      });
    }, 900_000);
  }
});
