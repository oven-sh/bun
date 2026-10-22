// A pass proves that what a built-in was observed to do is within what its entry declares, for what JavaScript can see:
// which code of its operands runs, with what, and when; what it stores, deletes, freezes and keeps; what it returns and throws;
// which memory its result depends on. Retention in native memory that nothing hands back, and allocation of strings, cannot be seen.
//
//   AOT_BUILTINS_UPDATE=1   checks every hand-written overload and writes the two lists of the hashes of those that pass
//   AOT_BUILTINS_TABLE=<f>  takes the table from the generator's aot_builtin_table.json in place of the one in this build of Bun
//   AOT_BUILTINS_FILTER=<r> only the entries whose path matches the regular expression
import { aotBuiltinEntries } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import {
  formatVerifiedList,
  needsDifferentialTest,
  parseVerifiedList,
  verifiedListPaths,
} from "../../../src/codegen/builtins/dump.ts";
import { checkCall } from "./differential/check-call";
import { formatDifference } from "./differential/compare";
import { Realm } from "./differential/members";
import {
  Table,
  type CallMode,
  type DumpedEntry,
  type DumpedOverload,
  type OperandUse,
  type Origin,
  type TableDump,
} from "./differential/table-description";
import type { WorkerReport, WorkerRequest } from "./differential/worker";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const webKitRoot = resolve(repositoryRoot, process.env.BUN_WEBKIT_PATH || "vendor/WebKit");
const listPaths = verifiedListPaths(repositoryRoot, join(webKitRoot, "Source/JavaScriptCore"));
const isUpdate = !!process.env.AOT_BUILTINS_UPDATE;
const tablePath = process.env.AOT_BUILTINS_TABLE ?? null;
const filter = new RegExp(process.env.AOT_BUILTINS_FILTER ?? ".");
const secondsPerAttempt = 600;
const maxAttemptsPerWorker = 40;

const dump: TableDump = tablePath === null ? aotBuiltinEntries() : JSON.parse(readFileSync(tablePath, "utf8"));
const table = new Table(dump);
const origins: Origin[] = ["Engine", "Host"];
const pathOfList = (origin: Origin) => (origin === "Engine" ? listPaths.engine : listPaths.host);

function readListedHashes(origin: Origin): Set<string> {
  const path = pathOfList(origin);
  return existsSync(path) ? parseVerifiedList(readFileSync(path, "utf8")) : new Set();
}

const listedHashes = new Map(origins.map(origin => [origin, readListedHashes(origin)]));
const isListed = (entry: DumpedEntry, overload: DumpedOverload) => listedHashes.get(entry.origin)!.has(overload.textHash);
const isChecked = (entry: DumpedEntry, overload: DumpedOverload) =>
  needsDifferentialTest(overload) && (isUpdate || isListed(entry, overload));

type CheckedCall = { entry: DumpedEntry; mode: CallMode; overloads: DumpedOverload[] };

const checkedCalls = dump.entries
  .filter(entry => filter.test(entry.path))
  .flatMap((entry): CheckedCall[] => {
    const overloads = entry.overloads.filter(overload => isChecked(entry, overload));
    return [...new Set(overloads.map(({ mode }) => mode))].map(mode => ({
      entry,
      mode,
      overloads: overloads.filter(overload => overload.mode === mode),
    }));
  });

const keyOf = (entry: string, mode: CallMode) => `${entry} ${mode}`;
const reports = new Map<string, WorkerReport>();
const endedProcess = new Set<string>();

function readReports(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line === "") continue;
    const report: WorkerReport = JSON.parse(line);
    reports.set(keyOf(report.entry, report.mode), report);
  }
}

// A call that ends its process or outlasts the time is left out of the next attempt, which goes on behind it.
async function runWorker(folder: string, index: number, calls: WorkerRequest["calls"]): Promise<void> {
  const requestPath = join(folder, `request.${index}.json`);
  const reportsPath = join(folder, `reports.${index}.jsonl`);
  let remaining = calls;
  for (let attempt = 0; attempt < maxAttemptsPerWorker && remaining.length > 0; attempt++) {
    writeFileSync(requestPath, JSON.stringify({ tablePath, calls: remaining } satisfies WorkerRequest));
    await using worker = Bun.spawn({
      cmd: [bunExe(), "--expose-internals", join(import.meta.dir, "differential/worker.ts"), requestPath, reportsPath],
      cwd: folder,
      env: bunEnv,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      timeout: secondsPerAttempt * 1000,
    });
    await worker.exited;
    const current: [string, CallMode] | null = JSON.parse(readFileSync(`${reportsPath}.current`, "utf8"));
    if (current === null) break;
    endedProcess.add(keyOf(...current));
    const position = remaining.findIndex(([entry, mode]) => entry === current[0] && mode === current[1]);
    remaining = remaining.slice(position + 1);
  }
  readReports(reportsPath);
}

async function runWorkers(): Promise<void> {
  using folder = tempDir("aot-builtins-differential", {});
  const workerCount = Math.min(availableParallelism(), 32, checkedCalls.length);
  const slices = Array.from({ length: workerCount }, (): WorkerRequest["calls"] => []);
  checkedCalls.forEach(({ entry, mode }, index) => slices[index % workerCount].push([entry.token, mode]));
  await Promise.all(slices.map((calls, index) => runWorker(String(folder), index, calls)));
}

function findProblems({ entry, mode }: CheckedCall, overload: DumpedOverload): string[] {
  const key = keyOf(entry.token, mode);
  if (endedProcess.has(key)) return [`${overload.token}: the process ended or did not come back`];
  const report = reports.get(key);
  if (!report) return [`${overload.token}: no report`];
  if (report.unreachable !== undefined) return [`${overload.token}: it is not called: ${report.unreachable}`];
  const checked = report.overloads.find(({ token }) => token === overload.token);
  if (!checked || checked.returned + checked.threw === 0) return [`${overload.token}: no set of operands selects it`];
  return checked.differences.map(difference => formatDifference(overload, difference));
}

function writeLists(): void {
  for (const origin of origins) {
    const handWritten = dump.entries
      .filter(entry => entry.origin === origin)
      .flatMap(entry => entry.overloads.filter(needsDifferentialTest).map(overload => ({ entry, overload })));
    const passed = handWritten.filter(({ entry, overload }) => {
      // A filter leaves entries out of the run: nothing was learned about them, so their lines stay.
      const call = checkedCalls.find(other => other.entry === entry && other.mode === overload.mode);
      return call ? findProblems(call, overload).length === 0 : isListed(entry, overload);
    });
    writeFileSync(pathOfList(origin), formatVerifiedList(origin, passed.map(({ overload }) => overload)));
  }
}

type WrongEntry = { title: string; path: string; mode: CallMode; column: string; applyTo(overload: DumpedOverload): DumpedOverload };

function withoutReceiverUses(...removed: OperandUse[]): WrongEntry["applyTo"] {
  return overload => ({
    ...overload,
    receiver: overload.receiver && { ...overload.receiver, uses: overload.receiver.uses.filter(use => !removed.includes(use)) },
  });
}

const wrongEntries: WrongEntry[] = [
  {
    title: "Array.prototype.push that writes no contents",
    path: "Array.prototype.push",
    mode: "Call",
    column: "receiver.uses",
    applyTo: withoutReceiverUses("WritesContents"),
  },
  {
    title: "Array.prototype.push that keeps no argument",
    path: "Array.prototype.push",
    mode: "Call",
    column: "parameters[0].uses",
    applyTo: overload => ({ ...overload, transfers: [], propertyActions: [] }),
  },
  {
    title: "Array.prototype.indexOf that never answers -1",
    path: "Array.prototype.indexOf",
    mode: "Call",
    column: "result.type",
    applyTo: overload => ({
      ...overload,
      result: { ...overload.result, type: { ...overload.result.type, integers: { minimum: 0, maximum: 2 ** 32 - 1 } } },
    }),
  },
  {
    title: "Object.freeze that leaves its operand as it is",
    path: "Object.freeze",
    mode: "Call",
    column: "parameters[0].uses",
    applyTo: overload => ({
      ...overload,
      propertyActions: [],
      parameters: overload.parameters.map(parameter => ({ ...parameter, uses: parameter.uses.filter(use => use !== "ChangesIntegrity") })),
    }),
  },
  {
    title: "Map.prototype.set that keeps no value",
    path: "Map.prototype.set",
    mode: "Call",
    column: "parameters[1].uses",
    applyTo: overload => ({ ...overload, transfers: overload.transfers.filter(({ from }) => JSON.stringify(from) !== '{"place":"Operand","operand":{"argument":1}}') }),
  },
  {
    title: "JSON.parse that does not throw",
    path: "JSON.parse",
    mode: "Call",
    column: "throws",
    applyTo: overload => ({ ...overload, throws: false }),
  },
  {
    title: "JSON.parse that has no error of its own",
    path: "JSON.parse",
    mode: "Call",
    column: "throws",
    applyTo: overload => ({ ...overload, onlyPropagatesErrors: true }),
  },
  {
    title: "new Uint8Array that admits every length",
    path: "Uint8Array",
    mode: "Construct",
    column: "throws",
    applyTo: overload => ({ ...overload, parameters: overload.parameters.map(parameter => ({ ...parameter, admitted: null })) }),
  },
  {
    title: "Array.prototype.sort whose comparator gets one argument",
    path: "Array.prototype.sort",
    mode: "Call",
    column: "callbacks[0].arguments",
    applyTo: overload => ({ ...overload, callbacks: overload.callbacks.map(callback => ({ ...callback, arguments: callback.arguments.slice(0, 1) })) }),
  },
  {
    title: "Object.keys that runs no code",
    path: "Object.keys",
    mode: "Call",
    column: "capability",
    applyTo: overload => ({ ...overload, capability: "heap" }),
  },
];

function defineWrongEntryTests(): void {
  describe("a wrong entry is noticed:", () => {
    for (const { title, path, mode, column, applyTo } of wrongEntries) {
      test(title, async () => {
        const entry = dump.entries.find(other => other.path === path);
        if (!entry) throw new Error(`the table has no ${path}`);
        const overloads = table.overloadsOf(entry, mode).map(overload => (overload.isUndeclared ? overload : applyTo(overload)));
        const report = await checkCall(new Realm(table), { entry, mode, overloads });
        expect(report.overloads.flatMap(({ differences }) => differences.map(difference => difference.column))).toContain(column);
      });
    }
  });
}

if (dump.entries.length === 0) {
  test.skip("this build of Bun has no ahead-of-time compiler", () => {});
} else {
  if (isUpdate && !existsSync(join(webKitRoot, "Source/JavaScriptCore/aot/builtins"))) {
    throw new Error("AOT_BUILTINS_UPDATE needs a WebKit checkout: set BUN_WEBKIT_PATH or clone it to vendor/WebKit");
  }

  beforeAll(runWorkers, maxAttemptsPerWorker * secondsPerAttempt * 1000);
  if (isUpdate) afterAll(writeLists);

  test("the tokens and the hashes of the overloads are unique", () => {
    const overloads = dump.entries.flatMap(entry => entry.overloads);
    expect(new Set(overloads.map(({ token }) => token)).size).toBe(overloads.length);
    expect(overloads.filter(({ textHash }) => !/^[0-9a-f]{16}$/.test(textHash)).map(({ token }) => token)).toEqual([]);
  });

  for (const origin of origins) {
    describe(origin, () => {
      for (const call of checkedCalls.filter(({ entry }) => entry.origin === origin)) {
        for (const overload of call.overloads) {
          test(overload.token, () => {
            expect(findProblems(call, overload)).toEqual([]);
          });
        }
      }
    });

    test(`the list of checked ${origin} overloads names only overloads of this table`, () => {
      const hashes = new Set(dump.entries.flatMap(entry => entry.overloads.map(({ textHash }) => textHash)));
      expect([...listedHashes.get(origin)!].filter(hash => !hashes.has(hash))).toEqual([]);
    });
  }

  defineWrongEntryTests();
}
