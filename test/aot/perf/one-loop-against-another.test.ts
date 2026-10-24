// One loop of a program may take a few times the instructions of another loop of the same program, and not many times.
// Each row names a program of ./one-loop-against-another, how it is built, two of its loops, and how many times the instructions of the first the second may take.
// Both are measured in the same executable: no clock, the same at any load.
// A row that is over its bound says how many times it takes today, and that number is held: more is red, and so is a row that has come under its bound, whose `today` goes out.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isMusl, isWindows, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import { withSteadyCollections } from "../harness/counted-run";
import { built, spawned, withoutDebugInformation } from "../run-programs";
import { beforeAll, describe, test } from "../supported";

const root = join(import.meta.dir, "one-loop-against-another");
const erased = ["--aot-erase-types"];

type Row = [program: string, flags: string[], baseline: string, other: string, times: number, today?: number];
const rows: Row[] = [
  ["a-count-by-one.ts", [], "under 2 ** 31", "past 2 ** 31", 10, 15.6],
  ["a-sum-of-bytes.ts", [], "under two gibibytes", "past two gibibytes", 10, 28.9],
  ["the-field-beside-a-sum.ts", [], "beside a small sum", "beside a sum past two gibibytes", 5, 14.8],
  ["the-constructor-of-an-instance.ts", [], "by a method", "by the constructor", 3],
  ["the-constructor-of-an-instance.ts", erased, "by a method", "by the constructor", 3],
  [
    "beside-a-file-that-asks-for-its-module-object/main.cjs",
    [],
    "a class of its own file",
    "a class out of a required file",
    5,
    10.5,
  ],
  [
    "beside-a-file-that-requires-through-its-module-object/main.cjs",
    [],
    "a class of its own file",
    "a class out of a required file",
    5,
    10.2,
  ],
  [
    "beside-a-file-with-a-direct-eval/main.cjs",
    [],
    "a class of its own file",
    "a class out of a required file",
    5,
    8.9,
  ],
  ["imported-by-default/main.mjs", [], "out of a module", "out of a CommonJS file", 3],
];
const [few, many] = [100_000, 400_000];

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : isWindows
      ? "it counts with perf_event_open or /usr/bin/time -l"
      : !isLinux || isMusl || process.arch !== "x64"
        ? "the numbers of today are those of Linux x64 with glibc"
        : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/one-loop-against-another.test.ts: ${skipped}`);

describe.skipIf(!!skipped)("compile/aot/perf/one-loop-against-another", () => {
  const folder = String(tempDir("aot-one-loop-against-another", {}));
  const env = { ...bunEnv, ...withSteadyCollections };
  const executableOf = (program: string, flags: string[]) =>
    join(folder, [program, ...flags].join("").replaceAll(/[^a-z0-9]+/gi, "-"));

  beforeAll(async () => {
    for (const [program, flags] of rows) {
      built(
        await spawned(
          [
            bunExe(),
            "build",
            "--compile",
            "--aot",
            ...flags,
            ...withoutDebugInformation(),
            join(root, program),
            "--outfile",
            executableOf(program, flags),
          ],
          root,
          bunEnv,
        ),
      );
      const compiled = await spawned([executableOf(program, flags)], root, bunEnv);
      const plain = await spawned([bunExe(), "run", join(root, program)], root, bunEnv);
      expect(compiled.stdout).toBe(plain.stdout);
    }
  }, 600_000);

  async function costOf(executable: string, loop: string) {
    const less = await measureCommand(root, [executable, loop, String(few)], 300_000, env);
    const more = await measureCommand(root, [executable, loop, String(many)], 300_000, env);
    if (less.instructions === undefined || more.instructions === undefined) return undefined;
    return (more.instructions - less.instructions) / (many - few);
  }

  for (const [program, flags, baseline, other, times, today] of rows) {
    const title = `${program}${flags.length ? " " + flags.join(" ") : ""}: ${other}: at most ${times} times ${baseline}`;
    test(
      title,
      async () => {
        const executable = executableOf(program, flags);
        const [expected, measured] = [await costOf(executable, baseline), await costOf(executable, other)];
        if (expected === undefined || measured === undefined)
          return void console.error(`SKIPPED: ${title}: instructions cannot be counted here`);
        const ratio = Math.round((measured / expected) * 10) / 10;
        console.error(
          `ONE LOOP AGAINST ANOTHER ${program} ${flags.join(" ")}\t${baseline}\t${Math.round(expected * 10) / 10}\t| ${other}\t${Math.round(measured * 10) / 10}\t| ${ratio} times`,
        );
        const verdict =
          ratio <= times
            ? today === undefined
              ? "within its bound"
              : "within its bound: `today` goes out"
            : today !== undefined && ratio <= today * 1.15
              ? "as today"
              : "over its bound";
        expect({ ratio, verdict }).toEqual({ ratio, verdict: today === undefined ? "within its bound" : "as today" });
      },
      900_000,
    );
  }
});
