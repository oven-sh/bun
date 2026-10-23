// In cold code a copy by a spread is one call of the run time, which copies a record by its words (a stub in front of the operation does, where the literal has the type of the record), or by a map from its layout to the layout of the literal.
// Each row below names a loop of ./copies-in-cold-code/main.ts, the loop that does the same without the copy, how many more instructions per iteration it may take than that one,
// and over how many iterations, in an executable whose code is all cold.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isMusl, isWindows, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import { withSteadyCollections } from "../harness/counted-run";
import { built, spawned, withoutDebugInformation } from "../run-programs";
import { beforeAll, describe, test } from "../supported";

const root = join(import.meta.dir, "copies-in-cold-code");
// ARM64 compares with memory by a load and a compare, and the stub copies 16 bytes by two loads and two stores: the first loop takes 164 instructions there and 130 on x86-64.
const isArm64 = process.arch === "arm64";
// With musl the third loop takes 855 instructions more than its baseline and the fourth 4,200.
const rows: [loop: string, baseline: string, allowance: number, iterations: number][] = [
  ["a copy where the type is written", "no copy", isArm64 ? 190 : 150, 400_000],
  ["a copy of anything", "no copy", 345, 400_000],
  ["a copy into another type", "no copy into another type", isMusl ? 950 : 800, 400_000],
  ["a copy of a kind never met", "no copy of a kind never met", isMusl ? 4_700 : 3_700, 8_000],
];

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : isWindows
      ? "it counts with perf_event_open or /usr/bin/time -l"
      : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/copies-in-cold-code.test.ts: ${skipped}`);

describe.skipIf(!!skipped)("compile/aot/perf/copies-in-cold-code", () => {
  const folder = String(tempDir("aot-copies-in-cold-code", {}));
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
          "--aot-heat=EverythingIsCold",
          ...withoutDebugInformation(),
          join(root, "main.ts"),
          "--outfile",
          executable,
        ],
        root,
        bunEnv,
      ),
    );
    const compiled = await spawned([executable], root, bunEnv);
    const plain = await spawned([bunExe(), "run", join(root, "main.ts")], root, bunEnv);
    expect(compiled.stdout).toBe(plain.stdout);
  }, 300_000);

  function costOf(loop: string, many: number) {
    let cost = costs.get(loop);
    if (!cost) {
      cost = (async () => {
        const few = many / 4;
        const less = await measureCommand(root, [executable, loop, String(few)], 300_000, env);
        const more = await measureCommand(root, [executable, loop, String(many)], 300_000, env);
        if (less.instructions === undefined || more.instructions === undefined) return undefined;
        return Math.round(((more.instructions - less.instructions) / (many - few)) * 10) / 10;
      })();
      costs.set(loop, cost);
    }
    return cost;
  }

  for (const [loop, baseline, allowance, iterations] of rows) {
    test(`${loop}: at most ${allowance} instructions`, async () => {
      const [expected, measured] = [await costOf(baseline, iterations), await costOf(loop, iterations)];
      if (expected === undefined || measured === undefined)
        return void console.error(`SKIPPED: ${loop}: instructions cannot be counted here`);
      console.error(`COPIES IN COLD CODE ${baseline}\t${expected}\t| ${loop}\t${measured}`);
      expect({ loop, measured, isWithinAllowance: measured <= expected + allowance }).toEqual({
        loop,
        measured,
        isWithinAllowance: true,
      });
    }, 900_000);
  }
});
