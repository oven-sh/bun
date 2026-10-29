// A spread that overwrites what the literal already holds, out of a record of another type, is one call of a stub that walks the moves from the one layout to the other.
// Each row below names a loop of ./options-spread-over-what-a-literal-already-holds/main.ts and how many more instructions per iteration it may take than the loop that hands its argument back.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isMusl, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import { built, spawned, withoutDebugInformation } from "../harness/commands";
import { withSteadyCollections } from "../harness/counted-run";
import { beforeAll, describe, test } from "../supported";

const root = join(import.meta.dir, "options-spread-over-what-a-literal-already-holds");
const iterations = 400_000;
const rows: [form: string, source: string, allowance: number][] = [
  ["defaults and some", "parts", 235],
  ["members and some", "parts", 175],
  ["options and a member", "instances", 175],
];

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : !isLinux || process.arch !== "x64" || isMusl
      ? "the allowances are those of Linux x64 with glibc"
      : undefined;
if (skipped)
  console.error(`SKIPPED: test/aot/perf/options-spread-over-what-a-literal-already-holds.test.ts: ${skipped}`);

describe.skipIf(!!skipped)("compile/aot/perf/options-spread-over-what-a-literal-already-holds", () => {
  const folder = String(tempDir("aot-options-spread-over-what-a-literal-already-holds", {}));
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

  function costOf(loop: string) {
    let cost = costs.get(loop);
    if (!cost) {
      cost = (async () => {
        const few = iterations / 4;
        const less = await measureCommand(root, [executable, ...loop.split(" of "), String(few)], 300_000, env);
        const more = await measureCommand(root, [executable, ...loop.split(" of "), String(iterations)], 300_000, env);
        if (less.instructions === undefined || more.instructions === undefined) return undefined;
        return Math.round(((more.instructions - less.instructions) / (iterations - few)) * 10) / 10;
      })();
      costs.set(loop, cost);
    }
    return cost;
  }

  for (const [form, source, allowance] of rows) {
    test(`${form} of ${source}: at most ${allowance} instructions`, async () => {
      const [expected, measured] = [await costOf(`nothing of ${source}`), await costOf(`${form} of ${source}`)];
      if (expected === undefined || measured === undefined)
        return void console.error(`SKIPPED: ${form} of ${source}: instructions cannot be counted here`);
      console.error(
        `OPTIONS SPREAD OVER WHAT A LITERAL ALREADY HOLDS nothing\t${expected}\t| ${form} of ${source}\t${measured}`,
      );
      expect({ form, source, measured, isWithinAllowance: measured <= expected + allowance }).toEqual({
        form,
        source,
        measured,
        isWithinAllowance: true,
      });
    }, 900_000);
  }
});
