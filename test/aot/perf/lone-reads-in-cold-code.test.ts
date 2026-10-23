// In a cold function of a very large program a read that shares its tests with nobody costs the test of the receiver, the test of the slot and the load, and out of the way the read by name:
// the check for undefined and null is made behind the failed test, and the load goes by what the field declares, not by what the read by name may answer.
// A form of such a read that took 2 to 12 instructions more went unseen by ten sessions of a large application a side: the operation is counted here.
// Each row names a reader of ./lone-reads-in-cold-code/main.ts and how many more instructions a call of it may take than a call of the function that reads nothing.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import { withSteadyCollections } from "../harness/counted-run";
import { built, spawned, withoutDebugInformation } from "../run-programs";
import { beforeAll, describe, test } from "../supported";

const root = join(import.meta.dir, "lone-reads-in-cold-code");
// As counted on Linux x64. Elsewhere a few more are let through: a test or a load may take another instruction there.
const slack = process.platform === "linux" && process.arch === "x64" ? 0 : 6;
const rows: [reader: string, allowance: number][] = [
  ["readInteger", 9],
  ["readDouble", 20],
  ["readString", 8],
  ["readObject", 8],
  ["readBoolean", 11],
  ["readUntyped", 8],
];
const iterations = 2_000_000;

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : isWindows
      ? "it counts with perf_event_open or /usr/bin/time -l"
      : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/lone-reads-in-cold-code.test.ts: ${skipped}`);

describe.skipIf(!!skipped)("compile/aot/perf/lone-reads-in-cold-code", () => {
  const folder = String(tempDir("aot-lone-reads-in-cold-code", {}));
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
          "--aot-limit=MaxWarmCodeValues:1",
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

  function costOf(reader: string) {
    let cost = costs.get(reader);
    if (!cost) {
      cost = (async () => {
        const few = iterations / 4;
        const less = await measureCommand(root, [executable, reader, String(few)], 300_000, env);
        const more = await measureCommand(root, [executable, reader, String(iterations)], 300_000, env);
        if (less.instructions === undefined || more.instructions === undefined) return undefined;
        return Math.round(((more.instructions - less.instructions) / (iterations - few)) * 10) / 10;
      })();
      costs.set(reader, cost);
    }
    return cost;
  }

  for (const [reader, allowance] of rows) {
    test(`${reader}: at most ${allowance + slack} instructions`, async () => {
      const [expected, measured] = [await costOf("readNothing"), await costOf(reader)];
      if (expected === undefined || measured === undefined)
        return void console.error(`SKIPPED: ${reader}: instructions cannot be counted here`);
      console.error(`LONE READS IN COLD CODE readNothing\t${expected}\t| ${reader}\t${measured}`);
      expect({ reader, measured, isWithinAllowance: measured <= expected + allowance + slack + 0.5 }).toEqual({
        reader,
        measured,
        isWithinAllowance: true,
      });
    }, 900_000);
  }
});
