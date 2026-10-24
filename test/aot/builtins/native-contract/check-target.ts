import type { Candidate } from "../differential/instances";
import type { Realm } from "../differential/members";
import { runSet } from "../differential/observe";
import type { OperandSet, Run } from "../differential/runs";
import { isObject, operandUses, type OperandUse } from "../differential/table-description";
import { findOperandChanges, keyOfChange, type OperandChange } from "./changes";
import {
  collectNamesRead,
  combinedSets,
  createSet,
  optionBags,
  otherReceivers,
  setsAsWritten,
  setsWithRealObjects,
  type NamesRead,
} from "./operand-sets";
import type { Target } from "./targets";

// Whether the function had to do with the objects in one position of its arguments. That it changed none says little where it took none.
export type PositionEvidence = {
  returnedWithPrimitive: number;
  returnedWithObject: number;
  // Of the calls that returned with an object in the position, those in which a trap of the object ran.
  returnedHavingLooked: number;
  // With all else equal the outcome differs between two objects in the position, and with one of them the call returned.
  outcomeDependsOnObject: boolean;
};

export type TargetReport = {
  name: string;
  path: string;
  mode: Target["mode"];
  isInTable: boolean;
  hasOwnReceiver: boolean;
  length: number;
  setCount: number;
  returned: number;
  threw: number;
  isCutShort: boolean;
  // Per argument, the names that were looked for in it.
  namesRead: string[][];
  callsOperands: "Never" | "BeforeReturn" | "AfterReturn" | "Both";
  positions: PositionEvidence[];
  changes: OperandChange[];
};

const maxBaseSets = 3;
const millisecondsPerTarget = 20_000;
const usesDescriptors = /NodeJSFS|node_fs_binding|\bfs\b/;

// On a real object a definition shows as another value or as other attributes, like a store or a descriptor.
const usesDeclaring = Object.fromEntries(operandUses.map(use => [use, [use]])) as Record<OperandUse, OperandUse[]>;
usesDeclaring.StoresByKey.push("DefinesName");
usesDeclaring.TakesDescriptor.push("DefinesName");

type Outcome = { set: OperandSet; didReturn: boolean; message: string; eventCount: number };

function describeResult(value: unknown): string {
  return isObject(value) ? Object.prototype.toString.call(value) : `${typeof value} ${String(value).slice(0, 40)}`;
}

function messageOf({ completion }: Run): string {
  if (completion.kind === "Returned") return "";
  try {
    return String((completion.error as Error)?.message).slice(0, 80);
  } catch {
    return "?";
  }
}

// The sets under which the function got furthest: it returned, or it failed in a way that few other sets failed, after the most reads.
function chooseBaseSets(outcomes: Outcome[]): OperandSet[] {
  const counts = new Map<string, number>();
  for (const { message } of outcomes) counts.set(message, (counts.get(message) ?? 0) + 1);
  const objectCount = ({ set }: Outcome) => set.arguments.filter(candidate => candidate.kind !== "Primitive").length;
  const ranked = outcomes.toSorted(
    (left, right) =>
      Number(right.didReturn) - Number(left.didReturn) ||
      (left.didReturn ? 0 : counts.get(left.message)! - counts.get(right.message)!) ||
      right.eventCount - left.eventCount ||
      objectCount(right) - objectCount(left),
  );
  const chosen: Outcome[] = [];
  for (const outcome of ranked) {
    if (chosen.length === maxBaseSets) break;
    if (!chosen.some(other => other.message === outcome.message && other.eventCount === outcome.eventCount)) chosen.push(outcome);
  }
  return chosen.map(({ set }) => set);
}

class Checker {
  readonly report: TargetReport;
  readonly outcomes: Outcome[] = [];
  readonly names: NamesRead[];
  #seenSets = new Set<string>();
  #seenChanges = new Set<string>();
  #deadline = performance.now() + millisecondsPerTarget;
  #calledBeforeReturn = false;
  #calledAfterReturn = false;
  // Per position, per set of the other operands: the outcomes with an object in the position, and whether one of them is a return.
  #outcomesWithObjects: Map<string, { outcomes: Set<string>; hasReturn: boolean }>[];

  constructor(
    readonly realm: Realm,
    readonly target: Target,
    readonly onSet: ((name: string) => void) | undefined,
  ) {
    const { name, path, mode, isInTable, hasOwnReceiver, length, argumentCount } = target;
    this.names = Array.from({ length: argumentCount }, () => new Map());
    this.#outcomesWithObjects = Array.from({ length: argumentCount }, () => new Map());
    this.report = {
      name,
      path,
      mode,
      isInTable,
      hasOwnReceiver,
      length,
      setCount: 0,
      returned: 0,
      threw: 0,
      isCutShort: false,
      namesRead: [],
      callsOperands: "Never",
      positions: Array.from({ length: argumentCount }, () => ({
        returnedWithPrimitive: 0,
        returnedWithObject: 0,
        returnedHavingLooked: 0,
        outcomeDependsOnObject: false,
      })),
      changes: [],
    };
  }

  async run(sets: OperandSet[]): Promise<void> {
    for (const set of sets) {
      if (this.#seenSets.has(set.name)) continue;
      if (performance.now() > this.#deadline) {
        this.report.isCutShort = true;
        return;
      }
      this.#seenSets.add(set.name);
      this.onSet?.(set.name);
      const run = await runSet(this.realm, this.target.invocation, set);
      if (run) this.#add(run);
    }
  }

  #add(run: Run): void {
    const { report } = this;
    report.setCount++;
    const didReturn = run.completion.kind === "Returned";
    if (didReturn) report.returned++;
    else report.threw++;
    this.outcomes.push({ set: run.set, didReturn, message: messageOf(run), eventCount: run.log.events.length });
    this.names.forEach((names, position) => collectNamesRead(run, position, names));
    this.#addEvidence(run, didReturn);
    for (const { trap, isLate, isDuringStep } of run.log.events) {
      if ((trap !== "apply" && trap !== "construct") || isDuringStep) continue;
      if (isLate) this.#calledAfterReturn = true;
      else this.#calledBeforeReturn = true;
    }
    for (const change of findOperandChanges(run)) {
      if (usesDeclaring[change.use].some(use => this.target.declaredUses.includes(use))) continue;
      const key = keyOfChange(change);
      if (this.#seenChanges.has(key)) continue;
      this.#seenChanges.add(key);
      report.changes.push(change);
    }
  }

  #addEvidence(run: Run, didReturn: boolean): void {
    const { receiver, arguments: candidates } = run.set;
    const outcome = run.completion.kind === "Returned" ? `returned ${describeResult(run.completion.value)}` : `threw ${messageOf(run)}`;
    this.report.positions.forEach((evidence, position) => {
      if (!isObject(run.args[position])) {
        if (didReturn) evidence.returnedWithPrimitive++;
        return;
      }
      const others = [receiver, ...candidates.with(position, receiver)].map(({ name }) => name).join();
      const seen = this.#outcomesWithObjects[position].getOrInsertComputed(others, () => ({ outcomes: new Set<string>(), hasReturn: false }));
      seen.outcomes.add(outcome);
      if (!didReturn) return;
      seen.hasReturn = true;
      evidence.returnedWithObject++;
      if (run.log.events.some(({ origin, isDuringStep }) => origin.operand === position && !isDuringStep)) evidence.returnedHavingLooked++;
    });
  }

  finish(): TargetReport {
    const { report } = this;
    report.positions.forEach((evidence, position) => {
      evidence.outcomeDependsOnObject = this.#outcomesWithObjects[position].values().some(({ outcomes, hasReturn }) => hasReturn && outcomes.size > 1);
    });
    report.namesRead = this.names.map(names => [...(names.get("") ?? [])]);
    if (this.#calledBeforeReturn) report.callsOperands = this.#calledAfterReturn ? "Both" : "BeforeReturn";
    else if (this.#calledAfterReturn) report.callsOperands = "AfterReturn";
    return report;
  }
}

function setsWithBags(base: OperandSet, names: NamesRead[]): OperandSet[] {
  return names.flatMap((namesOfPosition, position) =>
    optionBags(namesOfPosition).map(bag => createSet(base.receiver, base.arguments.with(position, bag))),
  );
}

export async function checkTarget(realm: Realm, target: Target, onSet?: (name: string) => void): Promise<TargetReport> {
  const checker = new Checker(realm, target, onSet);
  const withDescriptors = usesDescriptors.test(target.path);
  const receivers: Candidate[] = target.mode === "Call" || !target.hasOwnReceiver ? [...target.receivers, ...otherReceivers] : target.receivers;
  const [first, ...others] = receivers;

  await checker.run(setsAsWritten(target.path, first, target.argumentCount));
  await checker.run(combinedSets(first, target.argumentCount, withDescriptors));
  const baseSets = chooseBaseSets(checker.outcomes);
  // Twice: the first round of objects with the names shows the names that are looked for one level down.
  for (let round = 0; round < 2; round++) {
    for (const base of baseSets) await checker.run(setsWithBags(base, checker.names));
  }
  for (const base of baseSets) await checker.run(setsWithRealObjects(base));
  for (const receiver of others) {
    for (const base of baseSets) await checker.run([createSet(receiver, base.arguments)]);
  }
  return checker.finish();
}
