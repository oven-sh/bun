// Text that is evaluated when the program runs reads a name that lies above a compiled function for about what the name costs above an object.
// Each row names a program of ./evaluated-text-reads-names-above-functions, two of its loops, and how many times the instructions of the first the second may take. Nothing is pinned: both are measured in the same executable.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import { withSteadyCollections } from "../harness/counted-run";
import { built, spawned, withoutDebugInformation } from "../run-programs";
import { beforeAll, describe, test } from "../supported";

const root = join(import.meta.dir, "evaluated-text-reads-names-above-functions");

const rows: [program: string, baseline: string, other: string, times: number, few: number, many: number][] = [
  ["main.js", "a name above an object", "a name above a function of the program", 1.5, 100_000, 400_000],
  ["main.js", "a name above an object", "a name above a function of a library module", 1.5, 100_000, 400_000],
  [
    "main.js",
    "a function that the text made is called through call",
    "a function of the program is called through call",
    2,
    100_000,
    400_000,
  ],
];
const programs = [...new Set(rows.map(([program]) => program))];

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : isWindows
      ? "it counts with perf_event_open or /usr/bin/time -l"
      : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/evaluated-text-reads-names-above-functions.test.ts: ${skipped}`);

describe.skipIf(!!skipped)("compile/aot/perf/evaluated-text-reads-names-above-functions", () => {
  const folder = String(tempDir("aot-evaluated-text-reads-names-above-functions", {}));
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
      console.error(`EVALUATED TEXT READS NAMES ABOVE FUNCTIONS ${baseline}\t${expected}\t| ${other}\t${measured}`);
      expect({ other, measured, isWithinAllowance: measured <= expected * times }).toEqual({
        other,
        measured,
        isWithinAllowance: true,
      });
    }, 900_000);
  }
});
