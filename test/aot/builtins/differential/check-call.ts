import { compare, type Difference } from "./compare";
import { createMemberProbe } from "./instances";
import type { Invocation, Realm } from "./members";
import { runSet, type RunOptions } from "./observe";
import { isCallThatExists, operandSetsFor, reasonNeverCalled, withArgument, withReceiver, type Call } from "./operands";
import { checkPairs } from "./run-pairs";
import type { OperandSet, Run } from "./runs";
import type { CallMode, DumpedEntry, OperandName } from "./table-description";

export type OverloadReport = {
  token: string;
  returned: number;
  threw: number;
  differences: Difference[];
};
export type CallReport = {
  path: string;
  mode: CallMode;
  setCount: number;
  skippedSetCount: number;
  slowestSet: string;
  slowestSetMilliseconds: number;
  unreachable: string | undefined;
  overloads: OverloadReport[];
};

const maxProbedKeys = 24;
const probedCandidates = ["object:proxy", "object:empty"];

export function callsOf(realm: Realm, entry: DumpedEntry): Call[] {
  const modes = [...new Set(entry.overloads.map(overload => overload.mode))];
  return modes.map(mode => ({ entry, mode, overloads: realm.table.overloadsOf(entry, mode) }));
}

function optionsFor({ entry }: Call): RunOptions {
  return /^(setTimeout|setInterval)$/.test(entry.path) ? { lateDelay: 5 } : {};
}

function keysReadFrom(run: Run, operand: OperandName): PropertyKey[] {
  return run.log.events.flatMap(({ origin, trap, key, isOwnKey }) =>
    origin.kind === "Operand" && origin.operand === operand && trap === "get" && key !== undefined && !isOwnKey ? [key] : [],
  );
}

// Sets that give a name that the built-in was seen to read something to find.
function probeSetsFor(run: Run): OperandSet[] {
  const { set } = run;
  const operands: [OperandName, string][] = [["this", set.receiver.name], ...set.arguments.map((candidate, index): [OperandName, string] => [index, candidate.name])];
  return operands.flatMap(([operand, name]) => {
    if (!probedCandidates.includes(name)) return [];
    const keys = [...new Set(keysReadFrom(run, operand))].slice(0, maxProbedKeys);
    return keys.flatMap(key =>
      (["Object", "Function"] as const).map(held => {
        const probe = createMemberProbe(key, held);
        return operand === "this" ? withReceiver(set, probe) : withArgument(set, operand, probe);
      }),
    );
  });
}

class Reports {
  readonly byToken = new Map<string, { report: OverloadReport; columns: Set<string> }>();
  readonly earlierResults = new WeakSet<object>();

  constructor(call: Call) {
    for (const { token, isUndeclared } of call.overloads) {
      if (!isUndeclared) this.byToken.set(token, { report: { token, returned: 0, threw: 0, differences: [] }, columns: new Set() });
    }
  }

  add(realm: Realm, call: Call, run: Run): void {
    const checked = compare(realm, call, run, this.earlierResults);
    const entry = checked && this.byToken.get(checked.overload.token);
    if (!entry) return;
    if (run.completion.kind === "Returned") entry.report.returned++;
    else entry.report.threw++;
    for (const difference of checked.differences) this.addDifference(checked.overload.token, difference);
  }

  addDifference(token: string, difference: Difference): void {
    const entry = this.byToken.get(token);
    if (!entry || entry.columns.has(difference.column)) return;
    entry.columns.add(difference.column);
    entry.report.differences.push(difference);
  }
}

function findInvocation(realm: Realm, { entry, mode }: Call): Invocation | string {
  const reason = reasonNeverCalled(entry.path);
  const isPlainRead = mode === "Get" && entry.kind === "DataProperty" && !entry.path.startsWith("process.");
  if (reason !== undefined && !isPlainRead) return reason;
  if (entry.holder !== null && realm.valueOf(entry.holder) === undefined) return "this realm does not have its holder";
  return realm.invocationOf(entry, mode) ?? "this realm does not have it";
}

export function emptyReport({ entry, mode }: Call): CallReport {
  return { path: entry.path, mode, setCount: 0, skippedSetCount: 0, slowestSet: "", slowestSetMilliseconds: 0, unreachable: undefined, overloads: [] };
}

export async function checkCall(realm: Realm, call: Call, onSet?: (name: string) => void): Promise<CallReport> {
  const reports = new Reports(call);
  const report = emptyReport(call);
  const invocation = findInvocation(realm, call);
  if (typeof invocation === "string") return { ...report, unreachable: invocation };

  const options = optionsFor(call);
  const seen = new Set<string>();
  const pending = operandSetsFor(realm, call);
  for (let index = 0; index < pending.length; index++) {
    const set = pending[index];
    if (seen.has(set.name) || !isCallThatExists(realm, call, set)) continue;
    seen.add(set.name);
    onSet?.(set.name);
    const start = performance.now();
    const run = await runSet(realm, invocation, set, options);
    const elapsed = performance.now() - start;
    if (elapsed > report.slowestSetMilliseconds) {
      report.slowestSet = set.name;
      report.slowestSetMilliseconds = Math.round(elapsed);
    }
    report.setCount++;
    if (!run) {
      report.skippedSetCount++;
      continue;
    }
    reports.add(realm, call, run);
    if (!set.name.includes("member:")) pending.push(...probeSetsFor(run));
  }
  for (const { overload, difference } of await checkPairs(realm, call, invocation)) {
    reports.addDifference(overload.token, difference);
  }
  report.overloads = Array.from(reports.byToken.values(), ({ report: overload }) => overload);
  return report;
}
