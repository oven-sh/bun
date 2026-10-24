// Two forms of the language that say the same should cost about the same in compiled code. Each pair below names two loops of ./equivalent-syntax/main.ts
// and how many more instructions per iteration the second may take than the first. Nothing is pinned: both sides are measured in the same executable.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import { withSteadyCollections } from "../harness/counted-run";
import { built, spawned, withoutDebugInformation } from "../run-programs";
import { beforeAll, describe, test } from "../supported";

const root = join(import.meta.dir, "equivalent-syntax");

const pairs: [baseline: string, other: string, allowance: number, todo?: string][] = [
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
  ["comparisons of a string out of parsed text", "comparisons of one of a union of texts out of parsed text", 4],
];

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : isWindows
      ? "it counts with perf_event_open or /usr/bin/time -l"
      : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/equivalent-syntax.test.ts: ${skipped}`);

describe.skipIf(!!skipped)("compile/aot/perf/equivalent-syntax", () => {
  const folder = String(tempDir("aot-equivalent-syntax", {}));
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

  for (const [baseline, other, allowance, todo] of pairs) {
    (todo ? test.todo : test)(
      `${other}: at most ${allowance} instructions more than ${baseline}`,
      async () => {
        const [expected, measured] = [await costOf(baseline), await costOf(other)];
        if (expected === undefined || measured === undefined)
          return void console.error(`SKIPPED: ${other}: instructions cannot be counted here`);
        console.error(`EQUIVALENT SYNTAX ${baseline}\t${expected}\t| ${other}\t${measured}`);
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
