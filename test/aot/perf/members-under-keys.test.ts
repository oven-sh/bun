// A member of a class costs about the same under a symbol, or under a text that a constant holds, as under a plain name.
// Each pair names two loops of ./members-under-keys/main.js and how many more instructions a turn the second may take than the first. Nothing is pinned: both are measured in the same executable.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import { without } from "../harness/capabilities";
import { built, spawned, withoutDebugInformation } from "../harness/commands";
import { beforeAll, describe, test } from "../supported";

const root = join(import.meta.dir, "members-under-keys");
const withSteadyCollections = {
  BUN_GC_TIMER_DISABLE: "1",
  BUN_JSC_percentCPUPerMBForEdenTimer: "0",
  BUN_JSC_percentCPUPerMBForFullTimer: "0",
  BUN_JSC_useConcurrentGC: "0",
  BUN_JSC_numberOfGCMarkers: "1",
};
// A start varies by tens of thousands of instructions between runs: too much for an allowance of four instructions over fewer turns. Each length is counted three times, and the lowest count stands.
const [few, many, times] = [100_000, 1_600_000, 3];

const pairs: [baseline: string, other: string, allowance: number, today?: string][] = [
  // Two goals that are not met yet, the second on arm64 alone. The loops round a call under a plain name that a class below overrides, or that some objects lack, are built a second time and their calls are told apart by the shape;
  // the loops round the same calls under a symbol are not. Once one is met its case fails: take the fourth word out.
  ["a method under a plain name", "a method under a symbol that the module creates", 4],
  ["a method under a plain name", "a method under a symbol without a description", 4],
  ["a method under a plain name", "a method under a registered symbol", 4],
  ["a method under a plain name", "a method under a well-known symbol", 4],
  ["a method under a plain name", "a method under a constant that holds a text", 4],
  ["a method under a plain name", "a method under a symbol of another module", 4],
  ["a method under a plain name", "a method under a text of another module", 4],
  ["a getter under a plain name", "a getter under a symbol", 4],
  ["a getter and a setter under a plain name", "a getter and a setter under a symbol", 4],
  ["a static method under a plain name", "a static method under a symbol", 4],
  ["a method of two classes under a plain name", "a method of two classes under a symbol", 4, "23 more today"],
  [
    "a method that some objects have, read under a plain name and called",
    "a method that some objects have, read under a symbol and called",
    4,
    process.arch === "arm64" ? "4.3 more today" : undefined,
  ],
  ["a field under a plain name", "a field under a symbol", 8],
];

// A debug or ASAN build counts other instructions.
const isSlowBuild = isDebug || isASAN;

describe.skipIf(isSlowBuild || !!without("a counter of instructions"))("compile/aot/perf/members-under-keys", () => {
  const executable = join(String(tempDir("aot-members-under-keys", {})), "main");
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

  async function lowestCount(loop: string, turns: number) {
    let lowest: number | undefined;
    for (let i = 0; i < times; i++) {
      const { instructions } = await measureCommand(root, [executable, loop, String(turns)], 300_000, env);
      if (instructions === undefined) return undefined;
      lowest = lowest === undefined ? instructions : Math.min(lowest, instructions);
    }
    return lowest;
  }

  function costOf(loop: string) {
    let cost = costs.get(loop);
    if (!cost) {
      cost = (async () => {
        const [less, more] = [await lowestCount(loop, few), await lowestCount(loop, many)];
        return less === undefined || more === undefined ? undefined : (more - less) / (many - few);
      })();
      costs.set(loop, cost);
    }
    return cost;
  }

  for (const [baseline, other, allowance, today] of pairs) {
    const name = `${other}: at most ${allowance} instructions a turn more than ${baseline}`;
    (today ? test.failing : test)(
      today ? `${name} (${today})` : name,
      async () => {
        const [expected, measured] = [await costOf(baseline), await costOf(other)];
        if (expected === undefined || measured === undefined) {
          console.error(`SKIPPED: ${other}: instructions cannot be counted here`);
          return expect(today).toBeUndefined();
        }
        console.error(`MEMBERS UNDER KEYS ${baseline}\t${expected.toFixed(1)}\t| ${other}\t${measured.toFixed(1)}`);
        expect({ other, measured, isWithinAllowance: measured <= expected + allowance }).toEqual({
          other,
          measured,
          isWithinAllowance: true,
        });
      },
      900_000,
    );
  }
});
