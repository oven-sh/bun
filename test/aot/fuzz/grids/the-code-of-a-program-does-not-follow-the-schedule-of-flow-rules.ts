// The machine code of a program follows from the program alone, so how many threads the build has may not show in it.
// ../../tools/same-code-under-every-schedule.ts compares the code of stored programs function by function. Two of them hold it to both answers:
// it finds nothing where only the threads differ, and it reports code that does move. A failure names the first function that differs, and
//   bun test/aot/tools/same-code-under-every-schedule.ts test/aot/parallel/<program> --threads 1,8
// shows it alone.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { availableParallelism } from "os";
import { buildFlags } from "../../harness/flags";
import { test } from "../../supported";
import { findMovedCode, storedPrograms, threadCounts } from "../../tools/same-code-under-every-schedule";

// In ascending order, as findMovedCode() reports them.
const programs = [
  "access-sites/field-is-deleted-and-added-again.ts",
  "access-sites/name-of-a-class-in-a-namespace-that-is-never-read-points-to-layout.js",
];
const usual = { name: "usual", flags: [] };
const jobs = Math.max(1, Number(process.env.AOT_PROGRAMS_JOBS) || Math.min(9, availableParallelism()));

test(
  "the same code on one thread and on eight",
  async () => {
    using work = tempDir("aot-same-code-under-every-schedule", {});
    const ways = [usual, ...threadCounts([1, 8])];
    expect(await findMovedCode(bunExe(), storedPrograms, programs, ways, String(work), jobs)).toEqual({
      moved: [],
      notBuilt: [],
    });
  },
  170_000,
);

test(
  "code that does move is reported",
  async () => {
    using work = tempDir("aot-same-code-under-every-schedule", {});
    // Both programs keep objects in fields, and a reference to an object is twice as wide in a huge heap.
    const ways = [usual, { name: "wide references", flags: [buildFlags.hugeHeap] }];
    // A build that fails is booked as moved too, and shows nothing of what the tool sees.
    const differenceBetweenTwoBuilds = expect.not.stringMatching(/^it does not build$/);
    expect(await findMovedCode(bunExe(), storedPrograms, programs, ways, String(work), jobs)).toEqual({
      moved: programs.map(program => ({ program, under: ["wide references"], first: differenceBetweenTwoBuilds })),
      notBuilt: [],
    });
  },
  120_000,
);
