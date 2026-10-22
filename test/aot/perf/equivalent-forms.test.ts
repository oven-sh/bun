// Two ways to write the same thing should cost about the same in compiled code. Each pair below names two loops of ./equivalent-forms/main.ts
// and how many more instructions per iteration the second may take than the first. Nothing is pinned: both sides are measured in the same executable.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import { withSteadyCollections } from "../harness/counted-run";
import { built, spawned, withoutDebugInformation } from "../run-programs";
import { beforeAll, describe, test } from "../supported";

const root = join(import.meta.dir, "equivalent-forms");

const pairs: [baseline: string, other: string, allowance: number][] = [
  ["index", "at", 8],
  ["index", "at of a literal", 8],
  ["spread", "concat", 0],
  ["switch on a number tag", "switch on a text tag", 8],
];

const skipped = isDebug || isASAN ? "a debug or ASAN build counts other instructions" : isWindows ? "it counts with perf_event_open or /usr/bin/time -l" : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/equivalent-forms.test.ts: ${skipped}`);

describe.skipIf(!!skipped)("compile/aot/perf/equivalent-forms", () => {
  const folder = String(tempDir("aot-equivalent-forms", {}));
  const executable = join(folder, "main");
  const env = { ...bunEnv, ...withSteadyCollections };
  const costs = new Map<string, Promise<number | undefined>>();

  beforeAll(async () => {
    built(await spawned([bunExe(), "build", "--compile", "--aot", ...withoutDebugInformation(), join(root, "main.ts"), "--outfile", executable], root, bunEnv));
    const compiled = await spawned([executable], root, bunEnv);
    const plain = await spawned([bunExe(), "run", join(root, "main.ts")], root, bunEnv);
    expect(compiled.stdout).toBe(plain.stdout);
  }, 300_000);

  function costOf(loop: string) {
    let cost = costs.get(loop);
    if (!cost) {
      cost = (async () => {
        const [few, many] = [100_000, 400_000];
        const less = await measureCommand(root, [executable, loop, String(few)], 300_000, env);
        const more = await measureCommand(root, [executable, loop, String(many)], 300_000, env);
        if (less.instructions === undefined || more.instructions === undefined) return undefined;
        return Math.round(((more.instructions - less.instructions) / (many - few)) * 10) / 10;
      })();
      costs.set(loop, cost);
    }
    return cost;
  }

  for (const [baseline, other, allowance] of pairs) {
    test(
      `${other}: at most ${allowance} instructions more than ${baseline}`,
      async () => {
        const [expected, measured] = [await costOf(baseline), await costOf(other)];
        if (expected === undefined || measured === undefined) return void console.error(`SKIPPED: ${other}: instructions cannot be counted here`);
        console.error(`EQUIVALENT FORMS ${baseline}\t${expected}\t| ${other}\t${measured}`);
        expect({ other, measured, isWithinAllowance: measured <= expected + allowance }).toEqual({ other, measured, isWithinAllowance: true });
      },
      900_000,
    );
  }
});
