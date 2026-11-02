// The compiler takes native code about which the table of built-ins declares nothing for code that may read, call, keep and pass on what
// it is handed, and that does not store into it, delete from it, redefine, freeze or reparent it, write its contents or inherit from it.
// Every overload without a declaration, every native binding and every function of the objects that native bindings answer is called
// here with recording proxies and with real objects that are compared before and after. One that changes an operand in a way that no
// entry declares needs a declaration.
//
//   AOT_BUILTINS_FILTER=<r>  only the functions whose path matches the regular expression
import { aotBuiltinEntries } from "bun:internal-for-testing";
import { expect } from "bun:test";
import { bunEnv, bunExe, isGlibc, tempDir } from "harness";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { beforeAll, test } from "../supported";
import type { TargetReport } from "./native-contract/check-target";
import { knownChanges } from "./native-contract/known-changes";
import { runWorkers, type Report, type Results } from "./native-contract/run-workers";
import { isDescribedByNobody } from "./native-contract/targets";

const filter = process.env.AOT_BUILTINS_FILTER ?? ".";
const undeclared = aotBuiltinEntries().entries.flatMap(entry =>
  new RegExp(filter).test(entry.path)
    ? entry.overloads.filter(isDescribedByNobody).map(overload => overload.token)
    : [],
);

// Each process warms up anew.
const maxWorkers = 2;
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

function defineTests() {
  if (undeclared.length === 0) return void test.skip("this build of Bun has no ahead-of-time compiler", () => {});

  beforeAll(async () => {
    using folder = tempDir("aot-native-contract", {});
    results = await runWorkers({
      executable: bunExe(),
      environment: bunEnv,
      folder: String(folder),
      filter,
      workerCount: Math.min(availableParallelism(), maxWorkers),
    });
  }, 30 * 60_000);

  // An opener that makes nothing takes the methods of its class out of this test and out of differential.test.ts, and neither says so.
  test.skipIf(!isGlibc)("every opener makes an instance of a class that the table has", async () => {
    using folder = tempDir("aot-host-instances", {});
    await using run = Bun.spawn({
      cmd: [
        bunExe(),
        "--no-install",
        "--expose-internals",
        join(import.meta.dir, "native-contract/openers-fixture.ts"),
      ],
      cwd: String(folder),
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([run.stdout.text(), run.exited]);
    expect(JSON.parse(stdout)).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test("every overload without a declaration has a report", () => {
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
    if (filter !== ".") return;
    const seen = new Map(calledReports().map(({ name, changes }) => [name, new Set(changes.map(({ use }) => use))]));
    const stale = [...knownChanges].flatMap(([name, uses]) =>
      uses.filter(use => !seen.get(name)?.has(use)).map(use => `${name}: ${use}`),
    );
    expect(stale).toEqual([]);
  });
}

defineTests();
