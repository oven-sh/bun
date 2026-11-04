// Two ways to write the same thing should cost about the same in compiled code. Each pair below names two loops of one program under ./equivalent-forms
// and how many more instructions per iteration the second may take than the first. Nothing is pinned: both sides are measured in the same executable.
// A pair that is further apart today is listed as a todo, with what was last measured.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";
import { countsInstructions, measureCommand } from "../analysis-scaling/measure-check";
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

const root = join(import.meta.dir, "equivalent-forms");

type Pair = [baseline: string, other: string, allowance: number, today?: string];
/** Each length is counted so many times, and the lowest count stands. */
type Plan = { few: number; many: number; times: number };
const usualPlan: Plan = { few: 100_000, many: 400_000, times: 1 };
// A start varies by tens of thousands of instructions between runs: too much for an allowance of four instructions over 300,000 turns.
const planForSmallAllowances: Plan = { few: 100_000, many: 1_600_000, times: 3 };
const programs: [entry: string, pairs: Pair[], plan?: Plan][] = [
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
  [
    "loops-behind-a-seldom-taken-path.js",
    [
      ["a list of eight", "a list of seven that gets its eighth in the loop", 1],
      ["a list of eight beside a box", "a list of seven beside a box that gets its eighth in the loop", 1],
    ],
  ],
  [
    "loops-of-many-turns.ts",
    [
      ["members of a first list added up in few turns", "members of a first list added up in many turns", 1],
      ["members of a second list added up in few turns", "members of a second list added up in many turns", 1],
      ["members of a third list added up in few turns", "members of a third list added up in many turns", 1],
      ["members of a fourth list added up in few turns", "members of a fourth list added up in many turns", 1],
    ],
  ],
  [
    "counters-handed-to-functions-out-of-lists.js",
    [
      ["a function called by its name", "a function read out of a list", 1],
      ["two functions called by their names", "two functions read out of two lists", 1],
      [
        "a function called by its name in a while loop that steps by two",
        "a function read out of a list in a while loop that steps by two",
        1,
      ],
      ["a function called by its name in a method", "a function read out of a list in a field", 1],
      ["a function called by its name in a method", "a function read out of a list of the module in a method", 1],
    ],
  ],
  [
    "counters-of-loops-that-seldom-run-code-comes-back-into.js",
    [["a function called by its name", "a function read out of a member that is deleted now and then", 1]],
  ],
  [
    "bytes-copied-into-a-list-that-grows.ts",
    [
      ["from the first on", "from the last on", 1],
      ["from the first on", "up to a count, tested above", 1],
      ["in pairs, by one counter", "in pairs, by two counters that meet", 1],
    ],
  ],
  [
    "members-under-keys.js",
    [
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
      ["a method of two classes under a plain name", "a method of two classes under a symbol", 4],
      [
        "a method that some objects have, read under a plain name and called",
        "a method that some objects have, read under a symbol and called",
        4,
      ],
      ["a field under a plain name", "a field under a symbol", 8],
    ],
  ],
  [
    "members-of-a-class-made-on-demand.js",
    [
      [
        "a method under a plain name that is called",
        "a method under a plain name that is read, compared with undefined and called",
        2,
      ],
      [
        "a method under a symbol that is called",
        "a method under a symbol that is read, compared with undefined and called",
        2,
      ],
    ],
  ],
  ["wrappers.js", [["a wrapper that is called", "a wrapper that is called through call", 4]]],
  ["errors.js", [["an error that is kept", "an error that is returned at once", 32]]],
  [
    "strings.js",
    [
      ["a string made from scratch in each iteration", "a string made from scratch in each iteration inside a try", 16],
      [
        "a string made from scratch in each iteration",
        "a string made from scratch in each iteration of a while loop",
        16,
      ],
    ],
  ],
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
  [
    "merged-options.ts",
    [
      ["members that a literal spells out", "members that two spreads bring behind a member of the literal", 2],
      ["members that a literal spells out", "members that Object.assign brings to a literal with a member", 2],
      [
        "members that two spreads bring behind a member of the literal",
        "members that two spreads bring under the interface of the defaults",
        2,
      ],
      [
        "members that Object.assign brings to a literal with a member",
        "members that Object.assign brings to an empty literal under the interface of the defaults",
        2,
      ],
      [
        "members that two spreads bring behind a member of the literal",
        "members that two spreads bring under what Required makes of the options",
        2,
      ],
      [
        "members that a literal gives numbers written in place",
        "members that two spreads bring behind a member of the literal",
        4,
      ],
      [
        "members that a literal gives numbers written in place",
        "members that Object.assign brings to a literal with a member",
        4,
      ],
    ],
  ],
  [
    "syntax.ts",
    [
      ["fields that are declared", "fields with initializers", 4],
      ["fields that are declared", "parameter properties", 4],
      ["private keyword", "private names", 4],
      ["method", "getter", 4],
      ["method of the class", "arrow function in a field", 4],
      ["members", "object pattern", 4],
      ["members", "object pattern as the parameter", 4],
      ["nested members", "nested object pattern", 4],
      ["elements", "array pattern", 16],
      ["tests with &&", "optional chain", 4],
      ["comparison with undefined and null", "nullish coalescing", 4],
      ["call behind a test", "optional call", 4],
      ["default in the body", "default parameter", 4],
      ["three parameters", "rest parameter", 4],
      ["arguments one by one", "spread argument", 6],
      ["loop by index", "for-of", 4],
      ["loop by index", "forEach", 10, "TODO: 18 more over three elements"],
      ["literal that lists the members", "literal with a spread", 60],
      ["concatenation", "template literal", 4],
      ["chain of ifs", "switch", 4],
      ["counted loop", "generator", 4],
      ["Number(text)", "+text", 4],
      ["template literal of a number", "String(number)", 4],
      ["typeof compared with undefined", "typeof above u", 4],
      ["class below a class", "class below a class as written for ES5", 60],
      ["names that the type of the literal lists", "names under the index signature of the type of the literal", 4],
      ["keys out of a list of strings", "keys out of a list of a union of texts", 4],
      ["comparisons of a string out of a list", "comparisons of one of a union of texts out of a list", 4],
      ["comparisons of a string out of a list", "comparisons of a string taken for one of a union of texts", 4],
      ["comparisons of a string cut out of another", "comparisons of one of a union of texts cut out of another", 4],
      ["comparisons of a string out of parsed text", "comparisons of one of a union of texts out of parsed text", 1],
    ],
    planForSmallAllowances,
  ],
];

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : !countsInstructions()
      ? "instructions are not counted here"
      : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/equivalent-forms.test.ts: ${skipped}`);

const folder = String(tempDir("aot-equivalent-forms", {}));

describe.skipIf(!!skipped).each(programs)("compile/aot/perf/equivalent-forms/%s", (entry, pairs, plan = usualPlan) => {
  const executable = join(folder, entry.split(".")[0]);
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

  async function countInstructions(loop: string, iterations: number) {
    let lowest: number | undefined;
    for (let run = 0; run < plan.times; run++) {
      const { instructions } = await measureCommand(root, [executable, loop, String(iterations)], 300_000, env);
      if (instructions === undefined) return undefined;
      lowest = Math.min(lowest ?? instructions, instructions);
    }
    return lowest;
  }

  function costOf(loop: string) {
    let cost = costs.get(loop);
    if (!cost) {
      cost = (async () => {
        const less = await countInstructions(loop, plan.few);
        const more = await countInstructions(loop, plan.many);
        if (less === undefined || more === undefined) return undefined;
        return Math.round(((more - less) / (plan.many - plan.few)) * 10) / 10;
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
