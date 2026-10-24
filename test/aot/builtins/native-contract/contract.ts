import { aotBuiltinEntries } from "bun:internal-for-testing";
import { beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isGlibc, tempDir } from "harness";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import type { TargetReport } from "./check-target";
import { knownChanges } from "./known-changes";
import { runWorkers, type Report, type Results } from "./run-workers";
import { isDescribedByNobody } from "./targets";

const filter = process.env.AOT_BUILTINS_FILTER ?? ".";
const undeclared = aotBuiltinEntries().entries.flatMap(entry =>
  new RegExp(filter).test(entry.path)
    ? entry.overloads.filter(isDescribedByNobody).map(overload => overload.token)
    : [],
);

let results: Results;
const isCalled = (report: Report): report is TargetReport => !("reason" in report);
const calledReports = () => [...results.reports.values()].filter(isCalled);

function describeChanges(reports: TargetReport[]): string[] {
  return reports.flatMap(({ name, changes }) =>
    changes
      .filter(({ use }) => !knownChanges.get(name)?.includes(use))
      .map(({ use, where, what, set }) => `${name}: ${use}: ${what} on ${where}, called as ${set}`),
  );
}

/** Whether the calls come in parts with this Bun. */
export const comesInParts = isASAN || isDebug;

export function nativeContractInParts(part: number, parts: number) {
  if (!comesInParts)
    return void test.skip("test/aot/builtins/native-contract.test.ts makes the calls in one go", () => {});
  nativeContract(part, parts);
}

/** Part `part` of `parts`: every `parts`-th function. What can only be said of all of them is said where there is one part. */
export function nativeContract(part: number, parts: number) {
  if (undeclared.length === 0) return void test.skip("this build of Bun has no ahead-of-time compiler", () => {});

  beforeAll(async () => {
    using folder = tempDir("aot-native-contract", {});
    results = await runWorkers({
      executable: bunExe(),
      environment: bunEnv,
      folder: String(folder),
      filter,
      workerCount: Math.min(availableParallelism(), 32),
      part,
      parts,
    });
  }, 30 * 60_000);

  // An opener that makes nothing takes the methods of its class out of this test and out of differential-cases.ts, and neither says so.
  test.skipIf(!isGlibc || part !== 1)("every opener makes an instance of a class that the table has", async () => {
    using folder = tempDir("aot-host-instances", {});
    await using run = Bun.spawn({
      cmd: [bunExe(), "--no-install", "--expose-internals", join(import.meta.dir, "openers-fixture.ts")],
      cwd: String(folder),
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([run.stdout.text(), run.exited]);
    expect(JSON.parse(stdout)).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test.skipIf(parts !== 1)("every overload without a declaration has a report", () => {
    expect(undeclared.filter(token => !results.reports.has(token) && !results.ended.includes(token))).toEqual([]);
  });

  test("no call ends its process or stays away", () => {
    expect(results.howEnded).toEqual([]);
  });

  test("an overload without a declaration changes no operand", () => {
    expect(describeChanges(calledReports().filter(report => report.isInTable))).toEqual([]);
  });

  test("what a native binding answers changes an operand only as the entry of the binding declares", () => {
    expect(describeChanges(calledReports().filter(report => !report.isInTable))).toEqual([]);
  });

  test("the list of known changes names only changes that are seen", () => {
    if (filter !== "." || parts !== 1) return;
    const seen = new Map(calledReports().map(({ name, changes }) => [name, new Set(changes.map(({ use }) => use))]));
    const stale = [...knownChanges].flatMap(([name, uses]) =>
      uses.filter(use => !seen.get(name)?.has(use)).map(use => `${name}: ${use}`),
    );
    expect(stale).toEqual([]);
  });
}
