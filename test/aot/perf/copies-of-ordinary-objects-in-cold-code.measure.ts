// In cold code a spread or a rest whose source is not of the type of the literal is one call of the run time, which finds what it did for the copy before and does it again.
// Each row below names a loop of ./copies-of-ordinary-objects-in-cold-code/main.ts and how many more instructions per iteration it may take than the loop that makes the literal without the copy,
// in an executable whose code is all cold.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isMusl, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import { built, spawned, withoutDebugInformation } from "../harness/commands";
import { withSteadyCollections } from "../harness/counted-run";
import { beforeAll, describe, test } from "../supported";

const root = join(import.meta.dir, "copies-of-ordinary-objects-in-cold-code");
const iterations = 400_000;
const rows: [form: string, source: string, allowance: number][] = [
  ["a spread behind a member", "a parsed object", 665],
  ["a spread behind a member", "an instance", 810],
  ["a spread over defaults", "a parsed object", 770],
  ["a rest", "a parsed object", 715],
  ["a rest", "an instance", 752],
  ["a rest under a key", "a parsed object", 775],
];

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : !isLinux || process.arch !== "x64" || isMusl
      ? "the allowances are those of Linux x64 with glibc"
      : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/copies-of-ordinary-objects-in-cold-code.test.ts: ${skipped}`);

describe.skipIf(!!skipped)("compile/aot/perf/copies-of-ordinary-objects-in-cold-code", () => {
  const folder = String(tempDir("aot-copies-of-ordinary-objects-in-cold-code", {}));
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

  function costOf(loop: string) {
    let cost = costs.get(loop);
    if (!cost) {
      cost = (async () => {
        const few = iterations / 4;
        const less = await measureCommand(root, [executable, loop, String(few)], 300_000, env);
        const more = await measureCommand(root, [executable, loop, String(iterations)], 300_000, env);
        if (less.instructions === undefined || more.instructions === undefined) return undefined;
        return Math.round(((more.instructions - less.instructions) / (iterations - few)) * 10) / 10;
      })();
      costs.set(loop, cost);
    }
    return cost;
  }

  for (const [form, source, allowance] of rows) {
    test(`${form} of ${source}: at most ${allowance} instructions`, async () => {
      const [expected, measured] = [await costOf(`no copy of ${source}`), await costOf(`${form} of ${source}`)];
      if (expected === undefined || measured === undefined)
        return void console.error(`SKIPPED: ${form} of ${source}: instructions cannot be counted here`);
      console.error(
        `COPIES OF ORDINARY OBJECTS IN COLD CODE no copy\t${expected}\t| ${form} of ${source}\t${measured}`,
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
