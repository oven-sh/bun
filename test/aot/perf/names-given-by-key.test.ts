// An object that is given its names by key costs about the same whether the names come again or for the first time, and once it is built it serves like one whose names were written out.
// Each row names a program of ./names-given-by-key, two of its loops, and how many times the instructions of the first the second may take. Nothing is pinned: both are measured in the same executable.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import { withSteadyCollections } from "../harness/counted-run";
import { built, spawned, withoutDebugInformation } from "../run-programs";
import { beforeAll, describe, test } from "../supported";

const root = join(import.meta.dir, "names-given-by-key");

const rows: [program: string, baseline: string, other: string, times: number, few: number, many: number][] = [
  ["main.ts", "forty names that come again and again", "forty names that come once", 9, 2_000, 8_000],
  ["main.ts", "forty names that come again and again", "forty more names for one object", 4, 500, 1_500],
  [
    "main.ts",
    "a loop over names that were written out",
    "a loop over names that were given by key",
    1.3,
    20_000,
    80_000,
  ],
  [
    "main.ts",
    "questions to names that were written out",
    "questions to names that were given by key",
    1.3,
    20_000,
    80_000,
  ],
  [
    "registry.js",
    "a loop over the names",
    "a loop over the names, the last of which came behind such a loop",
    1.3,
    10_000,
    40_000,
  ],
  ["registry.js", "Object.keys", "Object.keys, the last of which came behind Object.keys", 1.3, 10_000, 40_000],
  [
    "records.js",
    "reads by name of the second object that was given the names",
    "reads by name of the first object that was given the names",
    1.2,
    100_000,
    400_000,
  ],
  [
    "records.js",
    "names come and go on an object that has given many up",
    "names come and go on a new object",
    1.3,
    20_000,
    80_000,
  ],
];
const programs = [...new Set(rows.map(([program]) => program))];

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : isWindows
      ? "it counts with perf_event_open or /usr/bin/time -l"
      : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/names-given-by-key.test.ts: ${skipped}`);

describe.skipIf(!!skipped)("compile/aot/perf/names-given-by-key", () => {
  const folder = String(tempDir("aot-names-given-by-key", {}));
  const executableOf = (program: string) => join(folder, program.replace(/\.[a-z]+$/, ""));
  const env = { ...bunEnv, ...withSteadyCollections };

  beforeAll(async () => {
    for (const program of programs) {
      built(
        await spawned(
          [
            bunExe(),
            "build",
            "--compile",
            "--aot",
            ...withoutDebugInformation(),
            join(root, program),
            "--outfile",
            executableOf(program),
          ],
          root,
          bunEnv,
        ),
      );
      const compiled = await spawned([executableOf(program)], root, bunEnv);
      const plain = await spawned([bunExe(), "run", join(root, program)], root, bunEnv);
      expect(compiled.stdout).toBe(plain.stdout);
    }
  }, 300_000);

  async function costOf(program: string, loop: string, few: number, many: number) {
    const less = await measureCommand(root, [executableOf(program), loop, String(few)], 300_000, env);
    const more = await measureCommand(root, [executableOf(program), loop, String(many)], 300_000, env);
    if (less.instructions === undefined || more.instructions === undefined) return undefined;
    return Math.round((more.instructions - less.instructions) / (many - few));
  }

  for (const [program, baseline, other, times, few, many] of rows) {
    test(`${other}: at most ${times} times ${baseline}`, async () => {
      const [expected, measured] = [
        await costOf(program, baseline, few, many),
        await costOf(program, other, few, many),
      ];
      if (expected === undefined || measured === undefined)
        return void console.error(`SKIPPED: ${other}: instructions cannot be counted here`);
      console.error(`NAMES GIVEN BY KEY ${baseline}\t${expected}\t| ${other}\t${measured}`);
      expect({ other, measured, isWithinAllowance: measured <= expected * times }).toEqual({
        other,
        measured,
        isWithinAllowance: true,
      });
    }, 900_000);
  }
});
