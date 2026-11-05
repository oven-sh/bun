// The design's budget, enforced as a test.
//
// Builds the bench/compiler application at 100,000 lines on one thread, once typed and once with its types erased, and checks two kinds of limits:
//
//   instructions   retired per unit of work: lowering and the scan per value, walk and sweep per value walked, emit through encode per machine operation.
//                  The rest of Compile has no budget of its own, so Compile as a whole must fit in the walk and emit budgets combined.
//   touches        how many times a unit is touched: the ratio of two of the build's counters. Building is what creates an operation, so sweeping and emitting are
//                  counted per built operation. Appending is what creates a machine operation, so the other three back-end touches are counted per appended
//                  operation. The counters are exact and repeatable, so they are checked wherever the application builds.
//
// The limits are in ./budgets.json. Each number is the limit itself, with no slack added, and applies to both builds.
// Numbers in that file only go down. To accept a regression, edit the file by hand so a reviewer sees it. This test never raises a number.
//
// The same build retires a different number of instructions with musl than with glibc, so each stage has one number per libc, both for Linux x64.
//
//   bun test test/aot/compiler/budgets.test.ts
//   AOT_BUDGETS=lower bun test test/aot/compiler/budgets.test.ts     lowers each limit to 10% above the worse of the two builds, where that is below the limit;
//                                                                    a touch never goes below 1
//
// Each check prints one line that begins with BUDGET.
import { afterAll, expect } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { isASAN, isDebug, isLinux, isMusl, isWindows } from "harness";
import { join } from "path";
import { describe, test } from "../supported";
import { application, build, countsInstructions, stagesOf, type Build, type Dress, type StageName } from "./measure";

const lines = 100_000;
const dresses = ["typed", "erased"] as const satisfies readonly Dress[];
const libc = isMusl ? "musl" : "glibc";
const timeout = 1_800_000;
const headroomWhenLowered = 1.1;

const unitOfStage = {
  lowering: "ValuesLowered",
  scan: "ValuesRead",
  walk: "ValuesWalked",
  emit: "MachineOperationsAppended",
} as const satisfies Partial<Record<StageName, string>>;
type BudgetedStage = keyof typeof unitOfStage;
const budgetedStages = Object.keys(unitOfStage) as BudgetedStage[];

const budgetedPartsOf: Partial<Record<StageName, BudgetedStage[]>> = {
  lowering: ["lowering"],
  scan: ["scan"],
  walk: ["walk"],
  emit: ["emit"],
  compile: ["walk", "emit"],
};

// ValuesScanned counts one per visit, in every loop of the scan that goes over the values of a body: that of the index and that of the statements. It is a number of visits and not of values, so nothing is counted per ValuesScanned.
// ValuesWalkedAndKept leaves out every walk of a loop that was thrown away and repeated. It counts a value once for each call site its function is inlined at and once for each turn of a short loop that is written out.
// OperationsSwept counts one per visit, in every loop of the sweep that goes over operations. It is a number of visits and not of operations, so nothing is counted per OperationsSwept.
// FactsCarriedOverEdges counts one per edge per round, however many members cross in that round.
const unitOfTouch = {
  ValuesScanned: "ValuesRead",
  ValuesWalkedAndKept: "ValuesRead",
  ValuesWalked: "ValuesWalkedAndKept",
  OperationsSwept: "OperationsBuilt",
  OperationsEmitted: "OperationsBuilt",
  MachineOperationsScanned: "MachineOperationsAppended",
  MachineOperationsAllocated: "MachineOperationsAppended",
  MachineOperationsEncoded: "MachineOperationsAppended",
  FactsCarriedOverEdges: "FactEdges",
} as const;
type Touch = keyof typeof unitOfTouch;
const touches = Object.keys(unitOfTouch) as Touch[];

type Check = BudgetedStage | Touch;

interface Budgets {
  instructions: Record<BudgetedStage, { glibc: number; musl: number }>;
  touches: Record<Touch, number>;
}

const budgetsPath = join(import.meta.dir, "budgets.json");
const budgets: Budgets = JSON.parse(readFileSync(budgetsPath, "utf8"));
const limitOf = (stage: BudgetedStage) => budgets.instructions[stage][libc];

const whyNotBuilt = isWindows ? "a build is measured through /bin/sh" : undefined;
const whyNotCounted =
  isDebug || isASAN
    ? "debug and ASAN builds retire a different number of instructions"
    : !isLinux || process.arch !== "x64"
      ? "the numbers in budgets.json are for Linux x64"
      : countsInstructions()
        ? undefined
        : "perf_event_open() gives no counter here";
if (whyNotBuilt) console.error(`SKIPPED: test/aot/compiler/budgets.test.ts: ${whyNotBuilt}`);
else if (whyNotCounted) console.error(`SKIPPED: test/aot/compiler/budgets.test.ts: instructions: ${whyNotCounted}`);

// Goals of the design that are not yet met, with what one run measured. Each of them runs every time, and no limit is raised for it.
// Once one is met its test fails: take its entry out.
const measuredWhereNotYetMet: Record<Dress, Partial<Record<StageName | Touch, string>>> = {
  typed: { lowering: "1.81", scan: "1.57", walk: "1.77", compile: "1.20", ValuesWalked: "1.210" },
  erased: { lowering: "2.06", scan: "1.62", walk: "1.92", compile: "1.24", ValuesWalked: "1.214" },
};
const nameOfCheck = (name: string, measured: string | undefined, bound: string) =>
  measured ? `${name}: ${measured} ${bound}` : name;
const budgetOf = (parts: BudgetedStage[]) => parts.map(part => `${limitOf(part)} per ${unitOfStage[part]}`).join(" + ");

async function buildApplication(dress: Dress) {
  using program = application(lines, dress);
  return await build(program);
}

const builds = new Map<Dress, Promise<Build>>();
function built(dress: Dress) {
  let building = builds.get(dress);
  if (!building) builds.set(dress, (building = buildApplication(dress)));
  return building;
}

/** A counter that nothing increments would pass every check. */
function countOf(counts: Record<string, number>, name: string) {
  const count = counts[name];
  if (!(count > 0)) throw new Error(`the build reported no ${name}`);
  return count;
}

const measured = new Map<Check, number[]>();
const record = (check: Check, perUnit: number) => measured.set(check, [...(measured.get(check) ?? []), perUnit]);

/** To three significant digits. */
function roundedUp(value: number) {
  const step = 10 ** (Math.floor(Math.log10(value)) - 2);
  return Number((Math.ceil(value / step) * step).toPrecision(3));
}

/** The limit is unchanged unless both builds were measured. */
function lowered(check: Check, limit: number, floor: number) {
  const measurements = measured.get(check) ?? [];
  if (measurements.length < dresses.length) return limit;
  return Math.min(limit, Math.max(floor, roundedUp(Math.max(...measurements) * headroomWhenLowered)));
}

const inMillions = (count: number) => Math.round(count / 1e6);
const shapeOf = (value: unknown): unknown =>
  typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value).map(([name, member]) => [name, shapeOf(member)]))
    : typeof value;

describe.skipIf(!!whyNotBuilt)("compile/aot/compiler budgets", () => {
  afterAll(() => {
    if (process.env.AOT_BUDGETS !== "lower") return;
    for (const stage of budgetedStages) budgets.instructions[stage][libc] = lowered(stage, limitOf(stage), 0);
    for (const touch of touches) budgets.touches[touch] = lowered(touch, budgets.touches[touch], 1);
    writeFileSync(budgetsPath, JSON.stringify(budgets, null, 2) + "\n");
  });

  test("budgets.json has one number for each check, and nothing else", () => {
    expect(shapeOf(budgets)).toEqual({
      instructions: Object.fromEntries(budgetedStages.map(stage => [stage, { glibc: "number", musl: "number" }])),
      touches: Object.fromEntries(touches.map(touch => [touch, "number"])),
    });
  });

  for (const dress of dresses) {
    // `concurrent` comes first: with a sanitizer `test` is concurrent already, and only its own `concurrent` allows for that.
    for (const [stage, parts] of Object.entries(budgetedPartsOf) as [StageName, BudgetedStage[]][])
      (whyNotCounted
        ? test.concurrent.skipIf(true)
        : measuredWhereNotYetMet[dress][stage]
          ? test.failing
          : test.concurrent)(
        nameOfCheck(
          `${dress}: instructions of ${stage}`,
          measuredWhereNotYetMet[dress][stage],
          `of the budget (${budgetOf(parts)})`,
        ),
        async () => {
          const finished = await built(dress);
          const { instructions } = stagesOf(finished)[stage];
          if (!instructions) throw new Error(`the build printed no instruction count for ${stage}`);
          const units = parts.map(part => countOf(finished.counts, unitOfStage[part]));
          const allowed = parts.reduce((sum, part, index) => sum + limitOf(part) * units[index], 0);
          if (parts.length === 1) record(parts[0], instructions / units[0]);
          const line = `BUDGET ${dress}: ${stage}: ${inMillions(instructions)} M instructions, ${(instructions / allowed).toFixed(2)} of the budget (${budgetOf(parts)})`;
          console.error(line);
          expect(instructions, line).toBeLessThanOrEqual(allowed);
        },
        timeout,
      );

    for (const touch of touches)
      (measuredWhereNotYetMet[dress][touch] ? test.failing : test.concurrent)(
        nameOfCheck(
          `${dress}: ${touch} per ${unitOfTouch[touch]}`,
          measuredWhereNotYetMet[dress][touch],
          `against a limit of ${budgets.touches[touch]}`,
        ),
        async () => {
          const { counts } = await built(dress);
          const ratio = countOf(counts, touch) / countOf(counts, unitOfTouch[touch]);
          record(touch, ratio);
          const line = `BUDGET ${dress}: ${touch}: ${ratio.toFixed(3)} per ${unitOfTouch[touch]}, limit ${budgets.touches[touch]}`;
          console.error(line);
          expect(ratio, line).toBeLessThanOrEqual(budgets.touches[touch]);
        },
        timeout,
      );
  }
});
