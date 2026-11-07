// The same deed over another kind of data, by another road or in another spelling may take so many times the instructions of its twin. Nothing is pinned: both are measured in the same executable.
// Each row names a file of ./everyday-twins, two of its loops, and how many times the instructions of the first the second may take. `list.map(x => x * 1.2)` once took 249 instructions an element over fractions and
// 36 over whole numbers: every pin was met, and no count of calls could see it.
// A row that is not met yet stands in gap(), with what it takes today: it is measured at every run and is red once it is met.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isMusl, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import { without } from "../harness/capabilities";
import { built, spawned, withoutDebugInformation } from "../harness/commands";
import { beforeAll, describe, eachRow, gap } from "../supported";

type Row = [file: string, baseline: string, other: string, times: number];
const rows: Row[] = [
  ["map.ts", "map over whole numbers", "map over fractions", 1.5],
  ["map.ts", "map over fractions", "map over fractions out of data", 1.5],
  gap("1.9 times", ["filter.ts", "filter over whole numbers", "filter over fractions", 1.5]),
  ["filter.ts", "some over whole numbers", "some over fractions", 1.5],
  ["filter.ts", "a fold over whole numbers", "a fold over fractions", 1.5],
  ["sort-by-a-table.js", "a sort by a comparator with a name", "a sort by a comparator out of a table", 1.3],
  ["sort-by-a-table.js", "a sort by a comparator with a name", "a search for what a table answers", 1],
  // It makes a view over the storage of another. Under glibc it takes 4.17 times the instructions of its twin, under musl 4.59.
  // The words of the new object are copied by the memcpy of the C library, which is taken to be what differs: that is read, and was not run on a machine with musl.
  ["parts-of-views.js", "a view between two positions", "a part of a view", isMusl ? 5 : 4.5],
  // These two make a view with storage of its own, of 32 and of 64 bytes, and fill it. Under glibc they take 5.69 and 5.4 times the instructions of their twin, under musl 6.15 and 6.13.
  // The compiled code is the same text on both, so what differs is taken to be the memmove and the memset of the C library: that is read, and was not run on a machine with musl.
  ["parts-of-views.js", "a view between two positions", "a copy of a part of a view", isMusl ? 6.5 : 6],
  ["parts-of-views.js", "a view between two positions", "a view that from makes", isMusl ? 6.5 : 6],
  ["a-compound-assignment.js", "a sum written out", "a sum by a compound assignment", 1.2],
  ["a-compound-assignment.js", "a sum written out", "a sum with a default", 1.6],
  ["a-field-that-is-counted.ts", "a total in a local", "a total in a field", 2.8],
  ["a-field-that-is-counted.ts", "a counter in a local", "a counter in a field", 2.5],
  ["a-field-that-is-counted.ts", "the greatest, from a number on", "the greatest, from the first on", 1.5],
  ["a-record-spread.ts", "a record written out", "a record spread", 2],
  ["two-records-in-one-literal.ts", "both written out", "two records in one literal", 3],
  ["a-record-without-one-of-its-names.ts", "the other names written out", "a record without one of its names", 4],
  ["a-row-without-two-of-its-names.js", "the other names written out", "the rest of a pattern", 3.3],
  ["texts-compared.js", "texts of the program", "texts out of data", 1.7],
  ["texts-compared.js", "texts of the program", "texts that were cut out", 2],
  ["characters.js", "characters by index, the caller seen", "characters by code", 2],
  ["characters.js", "characters by index, the caller seen", "characters by index", 2],
  ["characters.js", "characters by index, the caller seen", "characters by charAt", 2],
  ["characters.js", "bits by charAt", "bits by charAt, begun behind the end", 1.6],
  gap("23 times", ["characters.js", "characters by index, the caller seen", "characters by a for-of", 2]),
  ["an-emitter.js", "two functions out of a list", "two listeners, one argument", 2.4],
  ["an-emitter.js", "two functions out of a list", "two listeners, the rest of the arguments", 3.5],
  ["an-emitter.js", "two functions out of a list", "nobody listens", 1.1],
  ["a-router.js", "routes tried by index", "routes tried by a for-of", 1.3],
  ["a-keyed-store.js", "counts in a map", "counts in an object", 1.5],
  ["a-keyed-store.js", "counts in a map", "counts by a step", 1.5],
  ["a-keyed-store.js", "counts in an object", "under a key of two parts", 2],
  ["a-keyed-store.js", "under a key of two parts", "under a key that a helper makes", 1.3],
  ["a-list-filled-to-a-bound.ts", "seventeen values", "nine values", 0.8],
  ["methods-that-a-helper-stores.js", "methods written in the literal", "methods that a helper stores", 1.3],
  [
    "a-commonjs-file-imported.js",
    "names imported from a CommonJS file",
    "members of the namespace of a CommonJS file",
    2.5,
  ],
];

// A debug or ASAN build counts other instructions.
const isSlowBuild = isDebug || isASAN;

// A collection starts only when enough has been allocated, never on a timer, and runs entirely on the program's thread.
const withSteadyCollections = {
  BUN_GC_TIMER_DISABLE: "1",
  BUN_JSC_percentCPUPerMBForEdenTimer: "0",
  BUN_JSC_percentCPUPerMBForFullTimer: "0",
  BUN_JSC_useConcurrentGC: "0",
  BUN_JSC_numberOfGCMarkers: "1",
};
// Two processes that do the same differ by up to 35,000 instructions, so what is compared is a thousand times that. A counted loop of over 2 ** 20 turns goes through another copy of it.
const instructionsOfReading = 20_000_000;
const mostTurns = 2 ** 20;

describe.skipIf(isSlowBuild || !!without("a counter of instructions"))("compile/aot/perf/everyday-twins", () => {
  const root = join(import.meta.dir, "everyday-twins");
  const executable = join(String(tempDir("aot-everyday-twins", {})), "main");
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
  }, 120_000);

  async function aTurn(file: string, loop: string, few: number, many: number) {
    const less = await measureCommand(root, [executable, file, loop, String(few)], 60_000, env);
    const more = await measureCommand(root, [executable, file, loop, String(many)], 60_000, env);
    if (less.instructions === undefined || more.instructions === undefined)
      throw new Error("instructions are not counted here, and the lane says they are");
    return Math.max(1, (more.instructions - less.instructions) / (many - few));
  }
  const costs = new Map<string, number>();
  async function costOf(file: string, loop: string, again = false) {
    const name = file + " " + loop;
    const known = costs.get(name);
    if (known !== undefined && !again) return known;
    const turns = Math.min(
      mostTurns,
      Math.max(400, Math.round(instructionsOfReading / (known ?? (await aTurn(file, loop, 50, 250))))),
    );
    const cost = Math.min(known ?? Infinity, await aTurn(file, loop, turns >> 2, turns));
    costs.set(name, cost);
    return cost;
  }

  eachRow(rows)(
    "%s: %s | %s: at most %d times",
    async (file, baseline, other, times) => {
      let expected = await costOf(file, baseline);
      let measured = await costOf(file, other);
      for (let again = 0; again < 2 && measured > expected * times && measured < expected * times * 1.1; again++) {
        expected = await costOf(file, baseline, true);
        measured = await costOf(file, other, true);
      }
      const ratio = Math.round((100 * measured) / expected) / 100;
      console.error(
        `EVERYDAY TWINS ${file}\t${baseline}\t${Math.round(expected)}\t| ${other}\t${Math.round(measured)}\t${ratio} of ${times}`,
      );
      expect({ other, ratio, isWithinAllowance: measured <= expected * times }).toEqual({
        other,
        ratio,
        isWithinAllowance: true,
      });
    },
    60_000,
  );
});
