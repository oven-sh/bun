// A generator function that nobody has asked for its `prototype` has none, and its generators are made without one. The first question that needs the object,
// `it instanceof Other` is enough, gives every such generator of the function its prototype, so they have to be found. They lie by themselves on the heap, so
// that costs what the generators cost and not what the heap holds.
// Each way is measured as the instructions of a run that asks less those of a run that does not, over few objects and over many. Nothing is pinned.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";
import { countsInstructions, measureCommand } from "../analysis-scaling/measure-check";
import { built, spawned, withoutDebugInformation } from "../harness/commands";
import { withSteadyCollections } from "../harness/counted-run";
import { beforeAll, describe, test } from "../supported";

const name = "generator-first-question";
const root = join(import.meta.dir, name);
const [few, many] = [100_000, 3_000_000];
/** A walk over the heap takes some ten instructions an object: thirty million more over `many`. */
const mostInstructionsMore = 3_000_000;

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : !countsInstructions()
      ? "instructions are not counted here"
      : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/${name}.test.ts: ${skipped}`);

describe.skipIf(!!skipped)(`compile/aot/perf/${name}`, () => {
  const folder = String(tempDir("aot-first-question-to-a-generator", {}));
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
  }, 300_000);

  async function costOf(way: string, objects: number) {
    const asked = await measureCommand(root, [executable, String(objects), way], 300_000, env);
    const notAsked = await measureCommand(root, [executable, String(objects)], 300_000, env);
    if (asked.instructions === undefined || notAsked.instructions === undefined) return undefined;
    return asked.instructions - notAsked.instructions;
  }

  test.each(["instanceof", "getPrototypeOf", "inspect"])(
    "%s",
    async way => {
      const compiled = await spawned([executable, "10", way], root, bunEnv);
      const plain = await spawned([bunExe(), "run", join(root, "main.js"), "10", way], root, bunEnv);
      expect(compiled.stdout).toBe(plain.stdout);
      const [overFew, overMany] = [await costOf(way, few), await costOf(way, many)];
      if (overFew === undefined || overMany === undefined)
        return void console.error(`SKIPPED: ${way}: instructions cannot be counted here`);
      const more = overMany - overFew;
      console.error(
        `THE FIRST QUESTION TO A GENERATOR ${way}\tover ${few} objects\t${overFew}\t| over ${many}\t${overMany}`,
      );
      expect({ way, more, isWithinAllowance: more <= mostInstructionsMore }).toEqual({
        way,
        more,
        isWithinAllowance: true,
      });
    },
    900_000,
  );
});
