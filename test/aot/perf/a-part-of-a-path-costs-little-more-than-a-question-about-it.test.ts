// `dirname`, `basename` and `extname` of node:path look at the end of a path of a few dozen characters and answer with a part of it.
// Each row names a loop of ./a-part-of-a-path-costs-little-more-than-a-question-about-it/main.js and how many instructions a turn of it may take more than a turn
// of the loop that asks `isAbsolute`, which reads one character and makes nothing. What the two have in common, the loop and the call out of compiled code, is not counted.
// Nothing is pinned: both are measured in the same executable. The allowances are those of x64. Elsewhere the numbers are printed and not judged.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";
import { countsInstructions, measureCommand } from "../analysis-scaling/measure-check";
import { built, spawned, withoutDebugInformation } from "../harness/commands";
import { withSteadyCollections } from "../harness/counted-run";
import { beforeAll, describe, test } from "../supported";

const root = join(import.meta.dir, "a-part-of-a-path-costs-little-more-than-a-question-about-it");

const rows: [loop: string, instructions: number][] = [
  ["dirname", 113],
  ["basename", 112],
  ["extname", 112],
];
const [few, many] = [100_000, 400_000];

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : !countsInstructions()
      ? "instructions are not counted here"
      : undefined;
if (skipped)
  console.error(
    `SKIPPED: test/aot/perf/a-part-of-a-path-costs-little-more-than-a-question-about-it.test.ts: ${skipped}`,
  );

describe.skipIf(!!skipped)("compile/aot/perf/a-part-of-a-path-costs-little-more-than-a-question-about-it", () => {
  const folder = String(tempDir("aot-a-part-of-a-path", {}));
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

  for (const [loop, instructions] of rows) {
    test(`${loop}: at most ${instructions} instructions more than isAbsolute`, async () => {
      const [question, part] = [await costOf("isAbsolute"), await costOf(loop)];
      if (question === undefined || part === undefined)
        return void console.error(`SKIPPED: ${loop}: instructions cannot be counted here`);
      const more = Math.round(part - question);
      console.error(`A PART OF A PATH isAbsolute\t${Math.round(question)}\t| ${loop} takes more\t${more}`);
      if (process.arch !== "x64") return;
      expect({ loop, more, isWithinAllowance: more <= instructions }).toEqual({ loop, more, isWithinAllowance: true });
    }, 900_000);
  }
});
