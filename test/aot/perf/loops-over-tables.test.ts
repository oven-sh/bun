// oven-sh/bun#48283: a loop over a Map or a Set whose body writes no collection reads the table once, in front of the loop, and each step reads only its entry.
// Before the fix every step read the collection's storage again, tested what kind of table it is and how wide its keys and values are, computed where the keys
// and the values lie and set the mark of a walked table: 69 instructions a step of `for (const [id, value] of map)` and 33 of `for (const v of set)`, where the
// compiler before the rewrite took 19 and 12.
// Each row names a loop of ./loops-over-tables/main.ts and how many instructions one entry of one walk may take. The allowances are those of x64, and the
// rows are skipped elsewhere. The program also prints its sums, which must be those of plain Bun.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import { without } from "../harness/capabilities";
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

const root = join(import.meta.dir, "loops-over-tables");
// The program builds its Map and its Set with as many entries as it is told.
const entries = 2000;

const rows: [loop: string, instructionsPerEntry: number][] = [
  ["map-iter", 40],
  ["set-iter", 28],
];
const [few, many] = [200, 800];

// A debug or ASAN build counts other instructions, and the allowances are those of x64.
const isJudged = !isDebug && !isASAN && process.arch === "x64";

describe("compile/aot/perf/loops-over-tables", () => {
  const folder = String(tempDir("aot-loops-over-tables", {}));
  const executable = join(folder, "main");
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
  }, 300_000);

  for (const loop of ["map-iter", "set-iter", "map-get"]) {
    test(`${loop}: the sums are those of plain Bun`, async () => {
      const words = [loop, "3", String(entries)];
      const compiled = await spawned([executable, ...words], root, bunEnv);
      const plain = await spawned([bunExe(), "run", join(root, "main.ts"), ...words], root, bunEnv);
      expect({ stdout: compiled.stdout, stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({
        stdout: plain.stdout,
        stderr: "",
        exitCode: 0,
      });
      expect(plain.stdout).toStartWith(`${loop} `);
    }, 300_000);
  }

  async function costOfEntry(loop: string) {
    const less = await measureCommand(root, [executable, loop, String(few), String(entries)], 300_000, env);
    const more = await measureCommand(root, [executable, loop, String(many), String(entries)], 300_000, env);
    if (less.instructions === undefined || more.instructions === undefined)
      throw new Error(`${loop}: the instructions were not counted, where a counter is declared`);
    return (more.instructions - less.instructions) / ((many - few) * entries);
  }

  for (const [loop, instructions] of rows) {
    test.skipIf(!isJudged || !!without("a counter of instructions"))(
      `${loop}: at most ${instructions} instructions an entry`,
      async () => {
        const perEntry = Math.round((await costOfEntry(loop)) * 10) / 10;
        console.error(`A WALK OF A TABLE ${loop}\tinstructions an entry\t${perEntry}`);
        expect({ loop, perEntry, isWithinAllowance: perEntry <= instructions }).toEqual({
          loop,
          perEntry,
          isWithinAllowance: true,
        });
      },
      900_000,
    );
  }
});
