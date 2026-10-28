// What counts as hot is a share of the program, so other code decides it. A short loop that adds up fields which may be missing keeps its likely paths to itself, and then adds in integers,
// whether it is hot or only expected to run. A hot loop may be as long as MaxBytesOfSeparatedLoop and any other an eighth of that, which is how the last test tells the two apart.
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { readBuildReport } from "./harness/build-report";
import { built, spawned } from "./run-programs";
import { test } from "./supported";

setDefaultTimeout(240_000);

/** Three loops deep, where the loop that is asked about is two deep. */
const hotterCode = (functions: number) =>
  Array.from(
    { length: functions },
    (_, index) => `
function product${index}(left, right, size) {
  const result = new Array(size * size).fill(0);
  for (let row = 0; row < size; row++)
    for (let column = 0; column < size; column++)
      for (let k = 0; k < size; k++)
        result[row * size + column] = (result[row * size + column] + left[row * size + k] * right[k * size + column] + ${index}) | 0;
  return result;
}
console.log(product${index}([1, 2, 3, 4], [5, 6, 7, 8], 2).join());`,
  ).join("\n");

/** `merged` makes objects with other names too, so each field of `assigned` may be missing. No field of `literal` may. */
const program = (summed: "assigned" | "literal", hotterFunctions: number) => `
function merged(one, other) {
  return Object.assign({}, one, other);
}
const assigned = merged({ a: 1, b: 2 }, { c: 3 });
const others = merged({ d: 4 }, { e: 5 });
const literal = { a: 1, b: 2, c: 3 };
function repeated(runs, loop) {
  let last = 0;
  for (let run = 0; run < runs; run++) last = loop();
  return last;
}
${hotterCode(hotterFunctions)}
const sum = repeated(3, () => {
  let sum = 0;
  for (let i = 0; i < 100_000; i++) sum = (sum + ${summed}.a + ${summed}.b + ${summed}.c + i) | 0;
  return sum;
});
console.log(sum, JSON.stringify(assigned), JSON.stringify(others), JSON.stringify(literal));
`;

async function countSeparatedLoops(summed: "assigned" | "literal", hotterFunctions: number, flags: string[]) {
  using folder = tempDir("aot-loop-beside-hotter-code", { "program.cjs": program(summed, hotterFunctions) });
  const cwd = String(folder);
  const report = join(cwd, "report.json");
  const executable = join(cwd, isWindows ? "program.exe" : "program");
  built(
    await spawned(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "--aot-report=" + report,
        ...flags,
        "./program.cjs",
        "--outfile",
        executable,
      ],
      cwd,
      bunEnv,
    ),
  );
  const [compiled, plain] = await Promise.all([
    spawned([executable], cwd, bunEnv),
    spawned([bunExe(), "program.cjs"], cwd, bunEnv),
  ]);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  return readBuildReport(report).statistics.LoopsSeparatedFromUnlikelyPaths ?? 0;
}

/** Whatever else the executable holds is in both. */
async function isSeparated(hotterFunctions: number, flags: string[] = []) {
  const [withFieldsThatMayBeMissing, without] = await Promise.all([
    countSeparatedLoops("assigned", hotterFunctions, flags),
    countSeparatedLoops("literal", hotterFunctions, flags),
  ]);
  return withFieldsThatMayBeMissing > without;
}

const longerThanAnEighth = ["--aot-limit=MaxBytesOfSeparatedLoop:600"];

test("the loop has a path of its own where nothing is hotter", async () => {
  expect(await isSeparated(0)).toBe(true);
});

test("the loop has a path of its own beside hotter code", async () => {
  expect(await isSeparated(12)).toBe(true);
});

test("beside hotter code the loop is not hot: it goes by an eighth of the limit", async () => {
  expect({
    alone: await isSeparated(0, longerThanAnEighth),
    besideHotterCode: await isSeparated(12, longerThanAnEighth),
  }).toEqual({ alone: true, besideHotterCode: false });
});
