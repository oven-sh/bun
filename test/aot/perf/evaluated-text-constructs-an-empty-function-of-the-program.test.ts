// In text that is evaluated when the program runs, `new Empty()` of a function of the program that does nothing costs little more than `{}`: the object is made where the text runs and nothing is entered.
// Nothing is pinned: both loops of ./evaluated-text-constructs-an-empty-function-of-the-program/main.js are measured in the same executable. The allowance is that of x64. Elsewhere the numbers are printed and not judged.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";
import { countsInstructions, measureCommand } from "../analysis-scaling/measure-check";
import { built, spawned, withoutDebugInformation } from "../harness/commands";
import { withSteadyCollections } from "../harness/counted-run";
import { beforeAll, describe, test } from "../supported";

const root = join(import.meta.dir, "evaluated-text-constructs-an-empty-function-of-the-program");
const [literal, constructed, turns] = ["a literal", "an object of an empty function", 1.25] as const;
const [few, many] = [100_000, 400_000];

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : !countsInstructions()
      ? "instructions are not counted here"
      : undefined;
if (skipped)
  console.error(
    `SKIPPED: test/aot/perf/evaluated-text-constructs-an-empty-function-of-the-program.test.ts: ${skipped}`,
  );

describe.skipIf(!!skipped)("compile/aot/perf/evaluated-text-constructs-an-empty-function-of-the-program", () => {
  const folder = String(tempDir("aot-evaluated-text-constructs-an-empty-function", {}));
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

  test(`${constructed} costs at most ${turns} turns of ${literal}`, async () => {
    const [withLiteral, withConstruction] = [await costOf(literal), await costOf(constructed)];
    if (withLiteral === undefined || withConstruction === undefined)
      return void console.error(`SKIPPED: ${constructed}: instructions cannot be counted here`);
    console.error(
      `EVALUATED TEXT CONSTRUCTS AN EMPTY FUNCTION ${literal}\t${Math.round(withLiteral)}\t| ${constructed}\t${Math.round(withConstruction)}`,
    );
    if (process.arch !== "x64") return;
    expect({ withConstruction, isWithinAllowance: withConstruction <= withLiteral * turns }).toEqual({
      withConstruction,
      isWithinAllowance: true,
    });
  }, 900_000);
});
