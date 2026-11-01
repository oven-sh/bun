import { reasonTargetIsSkipped } from "../native-contract/targets";
import { types } from "node:util";
import { describeOrigin } from "./behaviors";
import { compare, selectFor, type Checked, type Difference } from "./compare";
import { createMemberProbe, releaseKeptValues } from "./instances";
import { Log, type Trap } from "./log";
import type { Invocation, Realm } from "./members";
import { runSets, type RunOptions } from "./observe";
import { isCallThatExists, planFor, reasonNeverCalled, withArgument, withReceiver, type Call, type Outcome } from "./operands";
import { checkPairs } from "./run-pairs";
import { changesIn, type OperandSet, type Run } from "./runs";
import { findChangedBuiltinObjects, haveChangedAgain, lookingAtBuiltinObjectsInEveryCall, takeBack, type Change } from "./snapshots";
import { isObject, type CallMode, type DumpedEntry, type OperandName } from "./table-description";

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
  // The first set for which a server, a connection or the like could not be made.
  setNotMade: string | undefined;
  unreachable: string | undefined;
  overloads: OverloadReport[];
};

function describeChange(change: Change): string {
  const key = "key" in change ? ` of ${String(change.key)}` : "";
  return `${change.kind}${key} on ${Object.prototype.toString.call(change.object)}`;
}

const maxProbedKeys = 24;
const probedCandidates = ["object:proxy", "object:empty"];

export function callsOf(realm: Realm, entry: DumpedEntry): Call[] {
  const modes = [...new Set(entry.overloads.map(overload => overload.mode))];
  return modes.map(mode => ({ entry, mode, overloads: realm.table.overloadsOf(entry, mode) }));
}

function optionsFor(realm: Realm, call: Call): RunOptions {
  return {
    lateDelay: /^(setTimeout|setInterval)$/.test(call.entry.path) ? 5 : 0,
    // What native code keeps beside an object cannot be seen, so the entry is taken at its word.
    leavesOperandsAsMade: run => changesIn(run).length === 0 && (run.completion.kind === "Threw" || selectFor(realm, call, run)?.writes.length === 0),
  };
}

function keysReadFrom(run: Run, operand: OperandName): PropertyKey[] {
  return run.log.events.flatMap(({ origin, trap, key, isOwnKey }) =>
    origin.kind === "Operand" && origin.operand === operand && trap === "get" && key !== undefined && !isOwnKey ? [key] : [],
  );
}

// Sets that give a name that the built-in was seen to read something to find. The first call that looks for a name shows it.
function probeSetsFor(run: Run, invocation: Invocation, probed: Map<OperandName, Set<PropertyKey>>): OperandSet[] {
  const { set } = run;
  if (run.log.events.length === 0) return [];
  const operands: [OperandName, string][] = [["this", set.receiver.name], ...set.arguments.map((candidate, index): [OperandName, string] => [index, candidate.name])];
  return operands.flatMap(([operand, name]) => {
    if (!probedCandidates.includes(name)) return [];
    const known = probed.getOrInsertComputed(operand, () => new Set());
    // What a receiver answers under the name of the entry itself is not the entry.
    const isNameOfEntry = (key: PropertyKey) => operand === "this" && invocation.callsWhatIsRead && key === invocation.key;
    const keys = [...new Set(keysReadFrom(run, operand))].filter(key => !isNameOfEntry(key) && !known.has(key)).slice(0, maxProbedKeys - known.size);
    return keys.flatMap(key => {
      known.add(key);
      return (["Object", "Function"] as const).map(held => {
        const probe = createMemberProbe(key, held);
        return operand === "this" ? withReceiver(set, probe) : withArgument(set, operand, probe);
      });
    });
  });
}

const numbersOfPrototypes = new WeakMap<object, number>();
let prototypeCount = 0;

function describeKind(log: Log, value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) return Number.isNaN(value) ? "NaN" : Number.isFinite(value) ? "fraction" : `${value}`;
    if (value === 0) return Object.is(value, -0) ? "-0" : "0";
    return `${value < 0 ? "negative" : "positive"} ${Math.abs(value) < 2 ** 31 ? "int32" : Math.abs(value) <= Number.MAX_SAFE_INTEGER ? "integer" : "number"}`;
  }
  if (typeof value === "string") return value === "" ? "empty string" : "string";
  if (!isObject(value)) return typeof value === "boolean" ? String(value) : value === null ? "null" : typeof value;
  const origin = log.originOf(value);
  if (origin !== undefined) return describeOrigin(origin);
  if (types.isProxy(value)) return "proxy";
  const prototype = Reflect.getPrototypeOf(value);
  const number = prototype === null ? 0 : numbersOfPrototypes.getOrInsertComputed(prototype, () => ++prototypeCount);
  return `${typeof value} ${number}`;
}

function describeThrown(log: Log, error: unknown): string {
  if (!isObject(error) || log.originOf(error) !== undefined || types.isProxy(error)) return describeKind(log, error);
  return `${describeKind(log, error)} ${String(Reflect.getOwnPropertyDescriptor(error, "code")?.value)}`;
}

const maxEventsInSignature = 48;
const trapsOfNames: readonly Trap[] = ["get", "has", "getOwnPropertyDescriptor"];

function outcomeOf(run: Run, checked: Checked | undefined): Outcome {
  const { log, completion } = run;
  const asked: Outcome["asked"] = new Map();
  const parts = [
    checked?.overload.token ?? "",
    completion.kind === "Returned" ? `returned ${describeKind(log, completion.value)}` : `threw ${describeThrown(log, completion.error)}`,
    String(checked?.differences.length ?? 0),
    String(run.yielded.length),
  ];
  for (const change of changesIn(run)) parts.push(`${change.kind} ${"key" in change ? String(change.key) : ""} ${describeKind(log, change.object)}`);
  log.events.forEach(({ origin, trap, key, isLate }, index) => {
    if (index < maxEventsInSignature) parts.push(`${trap} ${String(key)} ${describeOrigin(origin)} ${isLate}`);
    if (origin.kind !== "Operand") return;
    const ofOperand = asked.getOrInsertComputed(origin.operand, () => ({ names: new Set(), isMoreThanNames: false }));
    if (key !== undefined && trapsOfNames.includes(trap)) ofOperand.names.add(key);
    else if (trap !== "apply" && trap !== "construct") ofOperand.isMoreThanNames = true;
  });
  return { signature: parts.join("\n"), asked };
}

class Reports {
  readonly byToken = new Map<string, { report: OverloadReport; columns: Set<string> }>();
  readonly earlierResults = new WeakSet<object>();

  constructor(call: Call) {
    for (const { token, isUndeclared } of call.overloads) {
      if (!isUndeclared) this.byToken.set(token, { report: { token, returned: 0, threw: 0, differences: [] }, columns: new Set() });
    }
  }

  add(realm: Realm, call: Call, run: Run): Checked | undefined {
    const checked = compare(realm, call, run, this.earlierResults);
    const entry = checked && this.byToken.get(checked.overload.token);
    if (!entry) return checked;
    if (run.completion.kind === "Returned") entry.report.returned++;
    else entry.report.threw++;
    for (const difference of checked.differences) this.addDifference(checked.overload.token, difference);
    return checked;
  }

  addDifference(token: string, difference: Difference): void {
    const entry = this.byToken.get(token);
    if (!entry || entry.columns.has(difference.column)) return;
    entry.columns.add(difference.column);
    entry.report.differences.push(difference);
  }
}

function findInvocation(realm: Realm, { entry, mode }: Call): Invocation | string {
  // A function that a native binding answers is known by the name of its native code.
  const binding = realm.bindingAnswering(entry.token)?.binding;
  const reason = reasonNeverCalled(entry.path) ?? (binding && reasonTargetIsSkipped(binding.path));
  // A read or a store of the member calls nothing, and a read of such a binding only makes the function. What makes a standard stream is a getter.
  const isPlainRead = (mode === "Get" || mode === "Set") && (entry.kind === "DataProperty" || /^native:New(Cpp|Rust)Function:/.test(entry.path)) && !/^process\.std/.test(entry.path);
  if (reason !== undefined && !isPlainRead) return reason;
  const hasHolder = entry.holder === null || realm.valueOf(entry.holder) !== undefined;
  if (!hasHolder && realm.valueOf(entry.token) === undefined) return "this realm does not have its holder";
  return realm.invocationOf(entry, mode) ?? "this realm does not have it";
}

export function emptyReport({ entry, mode }: Call): CallReport {
  return { path: entry.path, mode, setCount: 0, skippedSetCount: 0, setNotMade: undefined, unreachable: undefined, overloads: [] };
}

const setsPerWait = 64;

async function checkSets(realm: Realm, call: Call, invocation: Invocation, onSet?: (name: string) => void): Promise<CallReport> {
  const reports = new Reports(call);
  const report = emptyReport(call);
  const options = optionsFor(realm, call);
  const plan = planFor(realm, call);
  const outcomes = new Map<string, Outcome>();
  const probed = new Map<OperandName, Set<PropertyKey>>();
  const seen = new Set<string>();

  const run = async (pending: OperandSet[]) => {
    for (let index = 0; index < pending.length; ) {
      const sets: OperandSet[] = [];
      for (; index < pending.length && sets.length < setsPerWait; index++) {
        const set = pending[index];
        if (seen.has(set.name)) continue;
        seen.add(set.name);
        if (plan.isTried(set) && isCallThatExists(realm, call, set)) sets.push(set);
      }
      if (onSet) for (const { name } of sets) onSet(name);
      for (const [position, made] of (await runSets(realm, invocation, sets, options)).entries()) {
        report.setCount++;
        if (!made) {
          report.skippedSetCount++;
          const { name, receiver, arguments: candidates } = sets[position];
          if ([receiver, ...candidates].some(candidate => candidate.prepare)) report.setNotMade ??= name;
          continue;
        }
        outcomes.set(made.set.name, outcomeOf(made, reports.add(realm, call, made)));
        if (!made.set.name.includes("member:")) pending.push(...probeSetsFor(made, invocation, probed));
      }
    }
  };

  await run([...plan.sets, ...plan.sweeps.flatMap(sweep => sweep.first())]);
  for (;;) {
    const told = plan.sweeps.flatMap(sweep => sweep.next(outcomes));
    if (told.length === 0) break;
    await run(told);
  }
  await run(plan.combinations(outcomes));
  releaseKeptValues();
  for (const { overload, difference } of await checkPairs(realm, call, invocation)) {
    reports.addDifference(overload.token, difference);
  }
  report.overloads = Array.from(reports.byToken.values(), ({ report: overload }) => overload);
  return report;
}

const logOfNoCall = new Log();

export async function checkCall(realm: Realm, call: Call, onSet?: (name: string) => void): Promise<CallReport> {
  const invocation = findInvocation(realm, call);
  if (typeof invocation === "string") return { ...emptyReport(call), unreachable: invocation };
  const report = await checkSets(realm, call, invocation, onSet);
  const changes = findChangedBuiltinObjects(logOfNoCall);
  if (changes.length === 0) return report;
  // Which of the calls it was, and whether its entry declares it, shows when they are made once more.
  takeBack(changes);
  const again = await lookingAtBuiltinObjectsInEveryCall(() => checkSets(realm, call, invocation, onSet));
  if (haveChangedAgain(logOfNoCall, changes)) return again;
  const message = `once in a process a built-in object changes: ${changes.map(describeChange).join(", ")}`;
  for (const overload of again.overloads) overload.differences.push({ column: "writes", message, set: "one of all sets" });
  return again;
}
