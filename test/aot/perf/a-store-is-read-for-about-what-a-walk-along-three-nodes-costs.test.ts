// AsyncLocalStorage.getStore() under three nested run() walks three frames. It may cost so many times what a walk along three nodes costs that the program writes itself.
// Nothing is pinned: both loops are measured in the same executable. The allowance is that of x64. Elsewhere the numbers are printed and not judged.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";
import { countsInstructions, measureCommand } from "../analysis-scaling/measure-check";
import { built, spawned, withoutDebugInformation } from "../harness/commands";
import { withSteadyCollections } from "../harness/counted-run";
import { beforeAll, describe, test } from "../supported";

const root = join(import.meta.dir, "a-store-is-read-for-about-what-a-walk-along-three-nodes-costs");
const [walk, read, times] = ["a walk along three nodes", "a store read under three runs", 2] as const;
const [few, many] = [100_000, 400_000];

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : !countsInstructions()
      ? "instructions are not counted here"
      : undefined;
if (skipped)
  console.error(
    `SKIPPED: test/aot/perf/a-store-is-read-for-about-what-a-walk-along-three-nodes-costs.test.ts: ${skipped}`,
  );

describe.skipIf(!!skipped)("compile/aot/perf/a-store-is-read-for-about-what-a-walk-along-three-nodes-costs", () => {
  const folder = String(tempDir("aot-a-store-is-read", {}));
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

  test(`${read} costs at most ${times} times ${walk}`, async () => {
    const [ofWalk, ofRead] = [await costOf(walk), await costOf(read)];
    if (ofWalk === undefined || ofRead === undefined)
      return void console.error(`SKIPPED: ${read}: instructions cannot be counted here`);
    console.error(`A STORE IS READ ${walk}\t${Math.round(ofWalk)}\t| ${read}\t${Math.round(ofRead)}`);
    if (process.arch !== "x64") return;
    expect({ ofRead: Math.round(ofRead), isWithinAllowance: ofRead <= ofWalk * times }).toEqual({
      ofRead: Math.round(ofRead),
      isWithinAllowance: true,
    });
  }, 900_000);
});
