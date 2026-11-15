// One async function that is twice as long may cost walk and sweep at most 2.1 times as much.
//
// linear-cost.test.ts makes its application larger by adding functions, so a step that costs (awaits) x (values) of ONE function never shows there.
// Here one function grows: each stretch of it branches, awaits on one arm and goes on, and eight values of its first lines are read in its last line,
// so every await holds them. What is live at an await stays the same however long the function is, so what the sweep lists for the saved frames doubles with the awaits.
//
// The function is built with 0, 1,000 and 2,000 stretches, on one thread. What the program costs without a stretch is subtracted:
//
//   growth = (cost at 2,000 - cost at 0) / (cost at 1,000 - cost at 0)
//
//   OperationsSwept        visits of operations in the loops of the sweep. Exact, the same on every machine
//   walk instructions      walk and sweep together, which is what the build counts. Where a stage has a counter
//
// And the sweep visits an operation once, and once more where it is found needed behind the sweep's way: what the stretches add to OperationsSwept is at most twice
// what they add to OperationsBuilt.
//
// It prints one line that begins with LONG ASYNC FUNCTION.
import { expect } from "bun:test";
import { isASAN, isDebug, isWindows, tempDir } from "harness";
import { describe, test } from "../supported";
import { build, stagesOf } from "./measure";

const stretches = 1_000;
const maxGrowth = 2.1;
const maxVisitsOfOneOperation = 2;
const numberOfValuesHeldThroughout = 8;

function sourceWith(numberOfStretches: number) {
  const held = Array.from({ length: numberOfValuesHeldThroughout }, (_, index) => `held${index}`);
  const lines = [
    "async function run(step, seed) {",
    ...held.map((name, index) => `  const ${name} = step(seed, ${index});`),
    "  let sum = seed;",
  ];
  for (let index = 0; index < numberOfStretches; index++)
    lines.push(`  if (sum & 1) sum += await step(sum, ${index});`, `  else sum -= ${index};`);
  lines.push(
    `  return sum + (await Promise.all([${held.join(", ")}])).length;`,
    "}",
    "const step = async (sum, index) => (sum ^ index) & 1023;",
    "console.log(String(await run(step, 1)));",
    "",
  );
  return lines.join("\n");
}

async function measure(numberOfStretches: number) {
  using folder = tempDir(`aot-long-async-function-${numberOfStretches}`, { "main.js": sourceWith(numberOfStretches) });
  const { walk } = stagesOf(await build({ folder: String(folder), entry: "main.js" }));
  return { swept: walk.touches.OperationsSwept, built: walk.touches.OperationsBuilt, instructions: walk.instructions };
}

// A build is measured through /bin/sh.
describe.skipIf(isWindows)("compile/aot/long async function", () => {
  test("twice the awaits cost walk and sweep at most 2.1 times as much", async () => {
    const [large, small, empty] = await Promise.all([2 * stretches, stretches, 0].map(measure));
    const growthOf = (cost: (measured: typeof large) => number) =>
      (cost(large) - cost(empty)) / (cost(small) - cost(empty));

    const growthOfVisits = growthOf(measured => measured.swept);
    const visitsOfOneOperation = (large.swept - empty.swept) / (large.built - empty.built);
    // A debug or ASAN build runs checks that no shipped build runs.
    const countsInstructions = large.instructions !== undefined && !isDebug && !isASAN;
    const growthOfInstructions = countsInstructions ? growthOf(measured => measured.instructions!) : undefined;
    console.error(
      `LONG ASYNC FUNCTION, ${stretches} and ${2 * stretches} awaits: OperationsSwept ${growthOfVisits.toFixed(2)} | OperationsSwept per OperationsBuilt ${visitsOfOneOperation.toFixed(2)} | walk instructions ${growthOfInstructions?.toFixed(2) ?? "not counted"}`,
    );

    expect(large.built - empty.built).toBeGreaterThan(stretches);
    expect(growthOfVisits).toBeLessThanOrEqual(maxGrowth);
    expect(visitsOfOneOperation).toBeLessThanOrEqual(maxVisitsOfOneOperation);
    if (growthOfInstructions !== undefined) expect(growthOfInstructions).toBeLessThanOrEqual(maxGrowth);
  }, 1_800_000);
});
