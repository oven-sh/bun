// A pass proves that what a built-in was observed to do is within what its entry declares, for what JavaScript can see:
// which code of its operands runs, with what, and when; what it stores, deletes, freezes and keeps; what it returns and throws;
// which memory its result depends on. Retention in native memory that nothing hands back, and allocation of strings, cannot be seen.
// The table is about executables, and an executable describes a value that a native function rejects without running code of the
// program (docs/bundler/aot-compatibility.mdx). So do the processes that make the calls here: executableEnv.
//
//   AOT_BUILTINS_UPDATE=1   checks every hand-written overload and writes differential/not-checked.txt: those that do not pass, each with the reason
//   AOT_BUILTINS_TABLE=<f>  takes the table from the generator's aot_builtin_table.json in place of the one in this build of Bun
//   AOT_BUILTINS_FILTER=<r> only the entries whose path matches the regular expression
import { aotBuiltinEntries } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isGlibc, tempDir } from "harness";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { needsDifferentialTest } from "../../../src/codegen/builtins/dump.ts";
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

const notCheckedPath = join(import.meta.dir, "differential/not-checked.txt");
const isUpdate = !!process.env.AOT_BUILTINS_UPDATE;
const tablePath = process.env.AOT_BUILTINS_TABLE ?? null;
const filter = new RegExp(process.env.AOT_BUILTINS_FILTER ?? ".");
const secondsPerAttempt = 600;
const executableEnv = { ...bunEnv, BUN_INTERNAL_DESCRIBE_VALUES_WITHOUT_SCRIPT: "1" };
const maxAttemptsPerWorker = 40;

const dump: TableDump = tablePath === null ? aotBuiltinEntries() : JSON.parse(readFileSync(tablePath, "utf8"));
const table = new Table(dump);
const origins: Origin[] = ["Engine", "Host"];
// The list says what the calls do where it is written.
const callsOverloads = isGlibc && !isASAN && !isDebug;
const notCheckedHeader =
  "# The hand-written overloads that test/aot/builtins/differential.test.ts does not call or that do not pass: `<overload>: <why>`.\n" +
  "# Written by: AOT_BUILTINS_UPDATE=1 bun test test/aot/builtins/differential.test.ts\n";

const notChecked = new Map(
  readFileSync(notCheckedPath, "utf8")
    .split("\n")
    .filter(line => line !== "" && !line.startsWith("#"))
    .map((line): [string, string] => [line.slice(0, line.indexOf(": ")), line.slice(line.indexOf(": ") + 2)]),
);
const isChecked = (overload: DumpedOverload) =>
  needsDifferentialTest(overload) && (isUpdate || (callsOverloads && !notChecked.has(overload.token)));

type CheckedCall = { entry: DumpedEntry; mode: CallMode; overloads: DumpedOverload[] };

const checkedCalls = dump.entries
  .filter(entry => filter.test(entry.path))
  .flatMap((entry): CheckedCall[] => {
    const overloads = entry.overloads.filter(isChecked);
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
      // Without --no-install `require("a")` fetches the package of that name from the registry and runs it.
      cmd: [
        bunExe(),
        "--no-install",
        "--expose-internals",
        join(import.meta.dir, "differential/worker.ts"),
        requestPath,
        reportsPath,
      ],
      cwd: folder,
      env: executableEnv,
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
  const report = reports.get(key);
  if (report?.failure !== undefined) return [`${overload.token}: the test itself threw: ${report.failure}`];
  if (endedProcess.has(key)) return [`${overload.token}: the process ended or did not come back`];
  if (!report) return [`${overload.token}: no report`];
  if (report.unreachable !== undefined) return [`${overload.token}: it is not called: ${report.unreachable}`];
  const checked = report.overloads.find(({ token }) => token === overload.token);
  if (!checked || checked.returned + checked.threw === 0) return [`${overload.token}: no set of operands selects it`];
  return checked.differences.map(difference => formatDifference(overload, difference));
}

const handWrittenOverloads = dump.entries.flatMap(entry =>
  entry.overloads.filter(needsDifferentialTest).map(overload => ({ entry, overload })),
);

function findReason({ entry, mode }: CheckedCall, overload: DumpedOverload): string | null {
  const checked = reports.get(keyOf(entry.token, mode))?.overloads.find(({ token }) => token === overload.token);
  const [problem] = findProblems({ entry, mode, overloads: [overload] }, overload);
  if (problem === undefined) return null;
  if (!checked || checked.differences.length === 0) {
    const [firstLine] = problem.slice(`${overload.token}: `.length).split("\n", 1);
    const thrown = /^error: (.*)$/m.exec(problem)?.[1];
    return thrown === undefined ? firstLine : `${firstLine.slice(0, firstLine.indexOf(": "))}: ${thrown}`;
  }
  return `it differs in ${[...new Set(checked.differences.map(({ column }) => column))].sort().join(", ")}`;
}

function writeList(): void {
  const lines = handWrittenOverloads.flatMap(({ entry, overload }) => {
    // A filter leaves entries out of the run: nothing was learned about them, so their lines stay.
    const call = checkedCalls.find(other => other.entry === entry && other.mode === overload.mode);
    const reason = call ? findReason(call, overload) : (notChecked.get(overload.token) ?? null);
    return reason === null ? [] : [`${overload.token}: ${reason}\n`];
  });
  writeFileSync(notCheckedPath, notCheckedHeader + lines.sort().join(""));
}

type WrongEntry = {
  title: string;
  path: string;
  mode: CallMode;
  column: string;
  applyTo(overload: DumpedOverload): DumpedOverload;
};

function withoutReceiverUses(...removed: OperandUse[]): WrongEntry["applyTo"] {
  return overload => ({
    ...overload,
    receiver: overload.receiver && {
      ...overload.receiver,
      uses: overload.receiver.uses.filter(use => !removed.includes(use)),
    },
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
    title: "Array.prototype.indexOf that reads no memory",
    path: "Array.prototype.indexOf",
    mode: "Call",
    column: "reads",
    applyTo: overload => ({ ...overload, reads: [] }),
  },
  {
    title: "Array.prototype.at that reads no memory",
    path: "Array.prototype.at",
    mode: "Call",
    column: "reads",
    applyTo: overload => ({ ...overload, reads: [] }),
  },
  {
    title: "Array.prototype.pop that reads no memory",
    path: "Array.prototype.pop",
    mode: "Call",
    column: "reads",
    applyTo: overload => ({ ...overload, reads: [] }),
  },
  {
    title: "%TypedArray%.prototype.forEach that reads no memory",
    path: "%TypedArray%.prototype.forEach",
    mode: "Call",
    column: "reads",
    applyTo: overload => ({ ...overload, reads: [] }),
  },
  {
    title: "Array.prototype.reverse that reads no memory",
    path: "Array.prototype.reverse",
    mode: "Call",
    column: "reads",
    applyTo: overload => ({ ...overload, reads: [] }),
  },
  {
    title: "Buffer.prototype.copy that reads no memory",
    path: "Buffer.prototype.copy",
    mode: "Call",
    column: "reads",
    applyTo: overload => ({ ...overload, reads: [] }),
  },
  {
    title: "Map.prototype.get that reads no memory",
    path: "Map.prototype.get",
    mode: "Call",
    column: "reads",
    applyTo: overload => ({ ...overload, reads: [] }),
  },
  {
    title: "DataView.prototype.getInt8 that reads no memory",
    path: "DataView.prototype.getInt8",
    mode: "Call",
    column: "reads",
    applyTo: overload => ({ ...overload, reads: [] }),
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
      parameters: overload.parameters.map(parameter => ({
        ...parameter,
        uses: parameter.uses.filter(use => use !== "ChangesIntegrity"),
      })),
    }),
  },
  {
    title: "Map.prototype.set that keeps no value",
    path: "Map.prototype.set",
    mode: "Call",
    column: "parameters[1].uses",
    applyTo: overload => ({
      ...overload,
      transfers: overload.transfers.filter(
        ({ from }) => JSON.stringify(from) !== '{"place":"Operand","operand":{"argument":1}}',
      ),
    }),
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
    applyTo: overload => ({
      ...overload,
      parameters: overload.parameters.map(parameter => ({ ...parameter, admitted: null })),
    }),
  },
  {
    title: "Array.prototype.sort whose comparator gets one argument",
    path: "Array.prototype.sort",
    mode: "Call",
    column: "callbacks[0].arguments",
    applyTo: overload => ({
      ...overload,
      callbacks: overload.callbacks.map(callback => ({ ...callback, arguments: callback.arguments.slice(0, 1) })),
    }),
  },
  {
    title: "Object.keys that runs no code",
    path: "Object.keys",
    mode: "Call",
    column: "capability",
    applyTo: overload => ({ ...overload, capability: "heap" }),
  },
  {
    title: "Bun.ArrayBufferSink.prototype.start that is handed its options and runs no other code",
    path: "Bun.ArrayBufferSink.prototype.start",
    mode: "Call",
    column: "parameters[0].protocols",
    applyTo: overload => ({ ...overload, runsOnlyOperandCode: true }),
  },
  {
    title: "Array.prototype.push that stores nothing by key",
    path: "Array.prototype.push",
    mode: "Call",
    column: "parameters[0].protocols",
    applyTo: overload => ({ ...overload, propertyActions: [] }),
  },
  {
    title: "Function.prototype.bind whose result has the prototype of every function",
    path: "Function.prototype.bind",
    mode: "Call",
    column: "receiver.protocols",
    applyTo: overload => ({ ...overload, result: { ...overload.result, prototypeSource: null } }),
  },
  {
    title: "JSON.stringify that reads no key of its list",
    path: "JSON.stringify",
    mode: "Call",
    column: "parameters[0].uses",
    applyTo: overload => ({ ...overload, propertyActions: [] }),
  },
  {
    title: "Intl.DateTimeFormat.prototype.format that asks no receiver for its prototype",
    path: "Intl.DateTimeFormat.prototype.format",
    mode: "Get",
    column: "receiver.protocols",
    applyTo: overload => ({ ...overload, receiver: overload.receiver && { ...overload.receiver, protocols: [] } }),
  },
  {
    title: "Object.create that takes nothing out of the descriptors",
    path: "Object.create",
    mode: "Call",
    column: "parameters[1].uses",
    applyTo: overload => ({
      ...overload,
      propertyActions: overload.propertyActions.filter(({ action }) => action !== "DescribesResult"),
    }),
  },
];

function defineWrongEntryTests(): void {
  describe("a wrong entry is noticed:", () => {
    for (const { title, path, mode, column, applyTo } of wrongEntries) {
      test(title, async () => {
        const entry = dump.entries.find(other => other.path === path);
        if (!entry) throw new Error(`the table has no ${path}`);
        const overloads = table
          .overloadsOf(entry, mode)
          .map(overload => (overload.isUndeclared ? overload : applyTo(overload)));
        const report = await checkCall(new Realm(table), { entry, mode, overloads });
        expect(
          report.overloads.flatMap(({ differences }) => differences.map(difference => difference.column)),
        ).toContain(column);
      });
    }
  });
}

function defineDescriptionTests(): void {
  const programs = join(import.meta.dir, "../programs/builtin-modules");
  describe("the processes that make the calls describe a rejected value as an executable does:", () => {
    for (const program of ["rejected-argument-description", "rejected-argument-whose-fields-nobody-reads"]) {
      test(program, async () => {
        await using run = Bun.spawn({
          cmd: [bunExe(), join(programs, `${program}.ts`)],
          env: executableEnv,
          stdout: "pipe",
          stderr: "inherit",
        });
        const [stdout, exitCode] = await Promise.all([run.stdout.text(), run.exited]);
        expect(stdout).toBe(readFileSync(join(programs, `${program}.expected.txt`), "utf8"));
        expect(exitCode).toBe(0);
      });
    }
  });
}

if (dump.entries.length === 0) {
  test.skip("this build of Bun has no ahead-of-time compiler", () => {});
} else {
  beforeAll(runWorkers, maxAttemptsPerWorker * secondsPerAttempt * 1000);
  if (isUpdate) afterAll(writeList);

  test("the tokens of the overloads are unique", () => {
    const overloads = dump.entries.flatMap(entry => entry.overloads);
    expect(new Set(overloads.map(({ token }) => token)).size).toBe(overloads.length);
  });

  test("the list of what is not checked names only hand-written overloads of this table", () => {
    const tokens = new Set(handWrittenOverloads.map(({ overload }) => overload.token));
    expect([...notChecked.keys()].filter(token => !tokens.has(token))).toEqual([]);
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
  }

  defineWrongEntryTests();
  defineDescriptionTests();
}
