// Runs alone: it judges by how the memory that a build holds grows.
//
// Twice the lines may cost the compiler at most 2.1 times as much, in every stage. A step that visits everything once per
// thing costs 4 times as much: nobody notices it in a small program, and in a large one it takes minutes or gigabytes.
//
// The application of bench/compiler is built at 0, 50,000 and 100,000 lines, in every dress, on one thread. What the empty
// application costs has nothing to do with the lines, so it is subtracted:
//
//   growth = (cost at 100,000 - cost at 0) / (cost at 50,000 - cost at 0), scaled to exactly twice the lines
//
// Each of these is a row with a growth of its own: the instructions of the build and of each stage, each touch count, and
// the peak memory of each engine stage. No clock is read.
//
// No row is left out for being small: a threshold on a total is where a quadratic step hides until the program is large
// enough to hurt. Instead, what two measurements of one thing can differ by is taken from what the larger size adds and
// given to what the smaller size adds. A row that noise could explain passes, and every other row is judged.
//
// A row over the bound is measured once more, from 25,000 to 50,000 lines, before it fails. A number may jump once, where a
// table doubles or a true bit width is passed. What is superlinear grows too fast at half the size too.
//
// Work that is done function by function has a lower bound as well. A limit that reads a total of the program turns a
// quadratic step into a line by doing less for each function once the program is large: fewer calls inlined, fewer
// operations built. That shows as a count that fails to double. It is not asked again at half the size, where such a limit
// has not been reached yet.
//
// Each dress prints one line that begins with LINEAR COST.
//
//   bun test test/aot/compiler/linear-cost.test.ts -t erased          one dress
import { expect } from "bun:test";
import { isASAN, isDebug, isLinux, isWindows } from "harness";
import { describe, test } from "../supported";
import {
  application,
  build,
  countsInstructions,
  dresses,
  stageNames,
  stagesOf,
  type Dress,
  type StageName,
} from "./measure";

const smallSize = 50_000;
const maxGrowth = 2.1;
const minGrowth = 1.9;

const budgetStages: StageName[] = ["frontEnd", "read", "scan", "passes", "solve", "plan", "walk", "emit", "image"];
// Walk and emit take turns within compile, so the three have one number.
const engineStages: StageName[] = ["read", "scan", "solve", "passes", "plan", "compile", "image"];
const perFunctionStages: StageName[] = ["lower", "scan", "compile", "walk", "emit"];

type Kind = "instructions" | "bytes" | "touches";

// What two measurements of one thing can differ by.
//   instructions   on one thread a build retires nearly the same number every time
//   bytes          the engine's allocator returns freed memory by the clock
//   touches        exact from run to run: what differs is which features the second half of the application holds
const noise: Record<Kind, (cost: number) => number> = {
  instructions: cost => cost / 1000,
  bytes: () => 16 * 2 ** 20,
  touches: () => 1000,
};

const instructionsOf = (stage: StageName | "build") => `${stage} instructions`;
const bytesOf = (stage: StageName) => `${stage} bytes`;

// On Linux the build tells the instructions and the memory of each of its stages. A row that is owed here and missing
// fails: a stage whose line the build no longer prints would otherwise pass as a stage that costs nothing.
const canCount = countsInstructions();
const countedStages: StageName[] = canCount && isLinux ? budgetStages : [];
const expectedRows = [
  ...(canCount ? [instructionsOf("build")] : []),
  ...countedStages.map(instructionsOf),
  ...(isLinux ? engineStages.map(bytesOf) : []),
];

interface Row {
  kind: Kind;
  cost: number;
  isPerFunctionWork: boolean;
}

interface Measurement {
  lines: number;
  rows: Map<string, Row>;
}

async function measure(lines: number, dress: Dress): Promise<Measurement> {
  using program = application(lines, dress);
  const built = await build(program);
  const stages = stagesOf(built);
  const rows = new Map<string, Row>();
  const add = (name: string, kind: Kind, cost: number | undefined, isPerFunctionWork = false) => {
    if (cost !== undefined) rows.set(name, { kind, cost, isPerFunctionWork });
  };
  add(instructionsOf("build"), "instructions", built.instructions);
  for (const stage of stageNames) {
    const { instructions, bytes, touches } = stages[stage];
    add(instructionsOf(stage), "instructions", instructions);
    if (engineStages.includes(stage)) add(bytesOf(stage), "bytes", bytes);
    for (const [touch, count] of Object.entries(touches))
      add(touch, "touches", count, perFunctionStages.includes(stage));
  }
  return { lines: program.lines, rows };
}

type Doubling = [empty: Measurement, small: Measurement, large: Measurement];

type Reading = "least" | "measured" | "most";

// The share of the noise that is taken from what the larger size adds and given to what the smaller size adds.
const shareOfNoiseMoved: Record<Reading, number> = { least: 1, measured: 0, most: -1 };

/** The least, the measured or the most growth that the numbers allow. */
function growth(name: string, [empty, small, large]: Doubling, reading: Reading) {
  const rowAt = ({ lines, rows }: Measurement) => {
    const row = rows.get(name);
    if (!row) throw new Error(`${name} has a number at some sizes and none at ${lines} lines`);
    return row;
  };
  const noiseMoved = shareOfNoiseMoved[reading] * noise[rowAt(large).kind](rowAt(large).cost);
  const addedBySmall = rowAt(small).cost - rowAt(empty).cost + noiseMoved;
  const addedByLarge = rowAt(large).cost - rowAt(empty).cost - noiseMoved;
  const growthOfLines = (large.lines - empty.lines) / (small.lines - empty.lines);
  return (addedByLarge / Math.max(addedBySmall, 0)) * (2 / growthOfLines);
}

const costs = (name: string, ...measurements: Measurement[]) =>
  measurements.map(({ lines, rows }) => `${rows.get(name)!.cost} at ${lines} lines`).join(", ");

/** A sentence for each row that is owed and missing, or that grows as it may not. Half the smaller size is measured only where a row is over the bound. */
async function judge(doubling: Doubling, owedRows: string[], measureHalf: () => Promise<Measurement>) {
  const [empty, small, large] = doubling;
  const names = [...large.rows.keys()];
  const failures = owedRows.filter(name => !large.rows.has(name)).map(name => `${name}: the build reports no number`);

  const suspects = names.filter(name => growth(name, doubling, "least") > maxGrowth);
  if (suspects.length) {
    const half = await measureHalf();
    for (const name of suspects) {
      const timesFromHalf = growth(name, [empty, half, small], "least");
      if (timesFromHalf > maxGrowth)
        failures.push(
          `${name} grows at least ${timesFromHalf.toFixed(2)} times and then ${growth(name, doubling, "least").toFixed(2)} times as the lines double, and may grow ${maxGrowth} times: ${costs(name, empty, half, small, large)}`,
        );
    }
  }

  for (const name of names) {
    const times = growth(name, doubling, "most");
    if (large.rows.get(name)!.isPerFunctionWork && times < minGrowth)
      failures.push(
        `${name} grows at most ${times.toFixed(2)} times as the lines double, and must grow ${minGrowth} times, or a function of the larger program gets less work: ${costs(name, empty, small, large)}`,
      );
  }
  return failures;
}

// The judge itself, on numbers that no build has made: it must refuse what it is there to refuse, and nothing else.
test("the judge refuses a step that visits everything once per thing, and a count that stops growing", async () => {
  const judged = (cost: (lines: number) => number, isPerFunctionWork = true, owedRows = ["row"]) => {
    const at = (lines: number): Measurement => ({
      lines,
      rows: new Map([["row", { kind: "touches", cost: cost(lines), isPerFunctionWork }]]),
    });
    return judge([at(0), at(smallSize), at(2 * smallSize)], owedRows, async () => at(smallSize / 2));
  };
  const line = (lines: number) => 70_000 + 12 * lines;
  expect(await judged(line)).toEqual([]);
  expect(await judged(line, true, ["row", "owed"])).toEqual(["owed: the build reports no number"]);

  expect(await judged(lines => line(lines) + lines ** 2 / 1000)).toEqual([
    expect.stringContaining("row grows at least 3.35 times and then 3.61 times"),
  ]);
  // A table that doubles once, between the two sizes: half the size acquits it, and only it.
  expect(await judged(lines => line(lines) + (lines > 1.5 * smallSize ? 1_000_000 : 0))).toEqual([]);

  const cutOffByATotal = (lines: number) => line(Math.min(lines, 1.5 * smallSize));
  expect(await judged(cutOffByATotal)).toEqual([expect.stringContaining("row grows at most 1.50 times")]);
  expect(await judged(cutOffByATotal, false)).toEqual([]);
});

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build runs checks that no shipped build runs, and holds other memory"
    : isWindows
      ? "a command is measured through /bin/sh"
      : undefined;
if (skipped) console.error(`SKIPPED: test/aot/compiler/linear-cost.test.ts: ${skipped}`);

describe.skipIf(!!skipped)("compile/aot/linear cost", () => {
  for (const dress of dresses)
    test.concurrent(
      dress,
      async () => {
        // A slot goes to whoever asks first, so the longest build asks first.
        const [large, small, empty] = await Promise.all(
          [2 * smallSize, smallSize, 0].map(lines => measure(lines, dress)),
        );
        const doubling: Doubling = [empty, small, large];
        const names = [...large.rows.keys()];
        const shown = names.flatMap(name => {
          const times = growth(name, doubling, "measured");
          return Number.isFinite(times) ? [`${name} ${times.toFixed(2)}`] : [];
        });
        console.error(`LINEAR COST ${dress}, ${small.lines} and ${large.lines} lines: ${shown.join(" | ")}`);

        expect(await judge(doubling, expectedRows, () => measure(smallSize / 2, dress))).toEqual([]);
      },
      1_800_000,
    );
});
