// What flow analysis finds follows from the program alone, so the order in which its rules run may not show in what the program prints.
// `--aot-testing=DelayFlowRules:<n>` runs them in another order for each n. Each stored program below has been broken by some order.
//
// Which orders break a program changes with every change to the compiler or to the library: the number seeds a hash over the statements of
// the whole build. Of 20 pairs of a program and an order that were red one night, 12 were green 70 minutes later, with nothing cured, and
// other orders were red in their place. So a program is not held to one order. It is asked under the first orders, as many as its row says.
//
// A build of one of these programs takes 4 to 37 seconds of a processor, and a test file has three minutes on four of them. So the rows are
// dealt to the files ../what-a-program-prints-does-not-follow-the-schedule-of-flow-rules-<n>.test.ts, at most about 180 seconds of a processor each.
//
//   held      no order may break it.
//   broken    over a fifth of all orders break it, so some of these do. Once none does the test fails: the row becomes `held`.
//   seldom    about one order in thirty breaks it, so these orders miss it every third time, and it can be held to nothing.
//             `bun test --todo` asks it all the same. Its cure makes the row `held`.
//
//   bun test/aot/run-parallel.ts --no-erased --more-flags=--aot-testing=DelayFlowRules:<n> test/aot/parallel/<program>      shows one order
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux } from "harness";
import { availableParallelism } from "os";
import { join, resolve } from "path";
import { test } from "../supported";

type Row = [file: number, state: "held" | "broken" | "seldom", orders: number, program: string, whatHappens: string];

// prettier-ignore
const rows: Row[] = [
  [1, "held", 16, "library-modules/file-handle-method-under-a-computed-key/main.mjs", "row 3703: the build leaves `readLines` of a file handle out, and the program dies"],
  [7, "held", 16, "commonjs/main-of-a-created-require-where-require-may-have-been-replaced.cjs", "row 3745: the `main` of a require made by createRequire() is undefined, and the program dies"],
  [2, "broken", 24, "closed-world/members-of-bun-under-names-that-unseen-text-hands-back.js", "row 3738: the build leaves Bun.peek out, and the program dies"],
  [3, "held", 16, "errors/frames-closures-function-code-runtime.mjs", "row 3739: the frames of the three closures print `at <anonymous>`, not the names that the text gave them"],
  [3, "held", 16, "errors/frames-closures-of-one-function-named-by-unseen-code.mjs", "row 3740: the frames print `at <anonymous>` throughout"],
  [8, "held", 16, "define-property/function-told-its-name.cjs", "row 3741: a class that defineProperty told its name prints `new Plain`, not `new told`"],
  [4, "held", 16, "closed-world/external-package-finds-the-realm-locked/main.cjs", "row 3742: Date is not locked: the package's `globalThis.Date = ..` and `Date.now = ..` go through"],
  [5, "seldom", 6, "host-object-writes/writes-after-the-first-use.mjs", "row 3743: TextEncoder.prototype.encode and TextDecoder.prototype.decode are not locked"],
  [6, "seldom", 8, "host-object-writes/writes-before-the-first-use.mjs", "row 3744: TextEncoder.prototype.encode and TextDecoder.prototype.decode are not locked"],
];

const tests = resolve(import.meta.dir, "..");
const jobs = Math.max(1, Number(process.env.AOT_PROGRAMS_JOBS) || Math.min(8, availableParallelism()));

async function passesUnder(order: number, program: string) {
  await using runner = Bun.spawn({
    cmd: [
      bunExe(),
      join(tests, "run-parallel.ts"),
      "--jobs=1",
      "--no-erased",
      `--more-flags=--aot-testing=DelayFlowRules:${order}`,
      join(tests, "parallel", program),
    ],
    env: { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" },
    stdout: "pipe",
    stderr: "ignore",
  });
  const states = (await runner.stdout.text())
    .split("\n")
    .filter(line => line.startsWith("{"))
    .map(line => JSON.parse(line).state)
    .filter(state => state !== "compiling");
  if (states.length !== 1)
    throw new Error(`${program} under order ${order}: the runner gave ${states.length} verdicts`);
  return states[0] === "pass";
}

async function ordersThatBreak(program: string, orders: number) {
  const broken: number[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: jobs }, async () => {
      while (next < orders) {
        const order = next++;
        if (!(await passesUnder(order, program))) broken.push(order);
      }
    }),
  );
  return broken.sort((a, b) => a - b);
}

/** Declares the tests of the rows that are dealt to one file. */
export function askTheRowsOfFile(file: number) {
  // A Bun that checks itself takes many times as long, and flow analysis is the same in it.
  const isSkipped = !isLinux || isASAN || isDebug;
  const where = test.skipIf(isSkipped);
  const asked = { held: where, broken: where, seldom: isSkipped ? where : where.todo };
  for (const [, state, orders, program, whatHappens] of rows.filter(row => row[0] === file))
    asked[state](
      `${state === "broken" ? "an" : "no"} order of the first ${orders} breaks ${program}${state === "held" ? "" : ` (${whatHappens})`}`,
      async () => {
        const broken = await ordersThatBreak(program, orders);
        if (state === "broken") expect(broken, "no order breaks it any more: its row becomes `held`").not.toEqual([]);
        else expect(broken).toEqual([]);
      },
      170_000,
    );
}
