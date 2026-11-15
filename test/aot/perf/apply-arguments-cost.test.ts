// `f.apply(receiver, arguments)` where the call of `apply` is not resolved, or where the arguments object was kept and comes from elsewhere: the run time copies the list and calls.
// A mapped arguments object of which nothing was overridden has its length and its elements as plain data, like an array. It was asked for its length and for each element by name:
// 823 instructions more than an array of three, which Babel's `_get` out of @babel/runtime paid at every call.
// Each row names a loop of ./apply-arguments-cost/main.cjs and how many instructions a turn of it may take more than a turn of the loop over arrays.
// Nothing is pinned: both are measured in the same executable. The allowances are those of x64. Elsewhere the numbers are printed and not judged.
// The program also prints what `apply` sees of an arguments object that something was done to, as plain Bun does.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import { without } from "../harness/capabilities";
import { built, spawned, withoutDebugInformation } from "../harness/commands";
import { beforeAll, describe, test } from "../supported";

// Otherwise what the collector's threads get done beside the program differs by some percent from run to run.
const withSteadyCollections = {
  BUN_GC_TIMER_DISABLE: "1",
  BUN_JSC_percentCPUPerMBForEdenTimer: "0",
  BUN_JSC_percentCPUPerMBForFullTimer: "0",
  BUN_JSC_useConcurrentGC: "0",
  BUN_JSC_numberOfGCMarkers: "1",
};

const root = join(import.meta.dir, "apply-arguments-cost");

const rows: [loop: string, instructions: number][] = [["mapped", 450]];
const [few, many] = [100_000, 400_000];

// A debug or ASAN build counts other instructions.
const isSlowBuild = isDebug || isASAN;

describe("compile/aot/perf/apply-arguments-cost", () => {
  const folder = String(tempDir("aot-apply-arguments-cost", {}));
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
          join(root, "main.cjs"),
          "--outfile",
          executable,
        ],
        root,
        bunEnv,
      ),
    );
  }, 300_000);

  test("what was done to an arguments object is seen as in plain Bun", async () => {
    const compiled = await spawned([executable], root, bunEnv);
    const plain = await spawned([bunExe(), "run", join(root, "main.cjs")], root, bunEnv);
    expect(compiled.stdout).toBe(plain.stdout);
  }, 300_000);

  async function costOf(loop: string) {
    const less = await measureCommand(root, [executable, loop, String(few)], 300_000, env);
    const more = await measureCommand(root, [executable, loop, String(many)], 300_000, env);
    if (less.instructions === undefined || more.instructions === undefined) return undefined;
    return (more.instructions - less.instructions) / (many - few);
  }

  for (const [loop, instructions] of rows) {
    test.skipIf(isSlowBuild || !!without("a counter of instructions"))(
      `${loop}: at most ${instructions} instructions more than an array`,
      async () => {
        const [array, list] = [await costOf("arrays"), await costOf(loop)];
        if (array === undefined || list === undefined)
          return void console.error(`SKIPPED: ${loop}: instructions cannot be counted here`);
        const more = Math.round(list - array);
        console.error(`AN ARGUMENTS OBJECT IS HANDED ON arrays\t${Math.round(array)}\t| ${loop} takes more\t${more}`);
        if (process.arch !== "x64") return;
        expect({ loop, more, isWithinAllowance: more <= instructions }).toEqual({
          loop,
          more,
          isWithinAllowance: true,
        });
      },
      900_000,
    );
  }
});
