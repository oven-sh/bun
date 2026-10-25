// Two ways to write the same thing should cost about the same in compiled code. Each pair below names two loops of one program under ./equivalent-forms
// and how many more instructions per iteration the second may take than the first. Nothing is pinned: both sides are measured in the same executable.
// A pair that is further apart today is listed as a todo, with what was last measured.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import { withSteadyCollections } from "../harness/counted-run";
import { built, spawned, withoutDebugInformation } from "../run-programs";
import { beforeAll, describe, test } from "../supported";

const root = join(import.meta.dir, "equivalent-forms");

type Pair = [baseline: string, other: string, allowance: number, today?: string];
const programs: [entry: string, pairs: Pair[]][] = [
  [
    "main.ts",
    [
      ["index", "at", 8],
      ["index", "at of a literal", 8],
      ["spread", "concat", 0],
      ["switch on a number tag", "switch on a text tag", 8],
    ],
  ],
  [
    "objects.js",
    [
      ["a literal that spells the names of its spread", "a literal that gets names from its spread", 8],
      ["a literal below Object.prototype", "a literal without a prototype", 16, "88 | 164"],
      ["an empty literal filled by key", "an instance of an empty function filled by key", 16, "289 | 461"],
      ["names and a getter on an object", "names and a getter on a function", 16, "56 | 152"],
    ],
  ],
  [
    "prototype-methods.js",
    [["methods assigned to the prototype of a function", "methods assigned to a variable that holds the prototype", 8]],
  ],
  ["names-in-a-list.js", [["a name found by a loop", "a name found by indexOf", 0]]],
  ["wrappers.js", [["a wrapper that is called", "a wrapper that is called through call", 4]]],
  [
    "creation-order.ts",
    [
      ["members stored in the order of their declarations", "members stored in the reverse order", 8],
      ["two arms that store in one order", "two arms that store in two orders", 8],
      ["an undeclared member stored last", "an undeclared member stored first", 16, "87 | 499"],
    ],
  ],
  [
    "values.js",
    [
      ["instanceof a constant that holds Promise", "instanceof the global Promise", 2],
      ["the elements of a literal", "the elements of what map answers", 16, "56 | 664"],
      ["an index compared as it is", "an index compared as an unsigned number", 4, "69 | 91"],
    ],
  ],
  [
    "optional-members.ts",
    [
      ["given members compared with what was kept", "omitted members compared with what was kept", 64],
      ["given members compared with each other", "omitted members compared with each other", 32],
      ["given members compared loosely", "omitted members compared loosely", 32],
      ["given members asked whether truthy", "omitted members asked whether truthy", 16],
      ["given members replaced where missing", "omitted members replaced where missing", 16],
      ["given members destructured with defaults", "omitted members destructured with defaults", 32],
      ["given members arguments with defaults", "omitted members arguments with defaults", 32],
      ["given members handed on to built-in functions", "omitted members handed on to built-in functions", 64],
      ["given members switched on", "omitted members switched on", 16],
      ["given members stored and returned", "omitted members stored and returned", 32],
      ["given members printed", "omitted members printed", 64, "249 | 802"],
    ],
  ],
];

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : isWindows
      ? "it counts with perf_event_open or /usr/bin/time -l"
      : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/equivalent-forms.test.ts: ${skipped}`);

describe.skipIf(!!skipped).each(programs)("compile/aot/perf/equivalent-forms/%s", (entry, pairs) => {
  const folder = String(tempDir("aot-equivalent-forms", {}));
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
          join(root, entry),
          "--outfile",
          executable,
        ],
        root,
        bunEnv,
      ),
    );
    const compiled = await spawned([executable], root, bunEnv);
    const plain = await spawned([bunExe(), "run", join(root, entry)], root, bunEnv);
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

  for (const [baseline, other, allowance, today] of pairs) {
    (today ? test.todo : test)(
      `${other}: at most ${allowance} instructions more than ${baseline}`,
      async () => {
        const [expected, measured] = [await costOf(baseline), await costOf(other)];
        if (expected === undefined || measured === undefined)
          return void console.error(`SKIPPED: ${other}: instructions cannot be counted here`);
        console.error(`EQUIVALENT FORMS ${baseline}\t${expected}\t| ${other}\t${measured}`);
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
