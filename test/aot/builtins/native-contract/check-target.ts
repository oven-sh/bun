import type { Candidate } from "../differential/instances";
import type { Realm } from "../differential/members";
import { releaseKeptValues, undefinedCandidate } from "../differential/instances";
import { Log } from "../differential/log";
import { runSets, type RunOptions } from "../differential/observe";
import { changesIn, type OperandSet, type Run } from "../differential/runs";
import { findChangedBuiltinObjects, haveChangedAgain, lookingAtBuiltinObjectsInEveryCall, takeBack } from "../differential/snapshots";
import { isObject, operandUses, type OperandUse } from "../differential/table-description";
import { describeChangeOfBuiltinObject, findOperandChanges, keyOfChange, type OperandChange } from "./changes";
import {
  collectNamesRead,
  createSet,
  kindsFor,
  optionBags,
  kindsOfRealObjects,
  otherReceivers,
  setsAsWritten,
  type NamesRead,
} from "./operand-sets";
import type { Target } from "./targets";

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
  changes: OperandChange[];
};

const maxBaseSets = 3;
const positionsTriedInEveryCombination = 2;
const setsPerWait = 64;
// By their names these end what they are called on. Any other call leaves an operand that takes time to make for the next one.
const endsItsReceiver = /(abort|close|destroy|detach|dispose|end|finish|kill|shutdown|stop|terminate)\w*(\/\d+)?$/i;
const millisecondsPerTarget = 20_000;
const usesDescriptors = /NodeJSFS|node_fs_binding|\bfs\b/;

// On a real object a definition shows as another value or as other attributes, like a store or a descriptor.
const usesDeclaring = Object.fromEntries(operandUses.map(use => [use, [use]])) as Record<OperandUse, OperandUse[]>;
usesDeclaring.StoresByKey.push("DefinesName", "TakesDescriptor");
usesDeclaring.TakesDescriptor.push("DefinesName");
usesDeclaring.DefinesName.push("TakesDescriptor");

type Outcome = { set: OperandSet; didReturn: boolean; message: string; kindOfResult: string; eventCount: number; usesReceiver: boolean };

function kindOf(value: unknown): string {
  return isObject(value) ? Object.prototype.toString.call(value) : typeof value;
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
  readonly outcomes = new Map<string, Outcome>();
  readonly names: NamesRead[];
  #seenSets = new Set<string>();
  #options: RunOptions;
  #seenChanges = new Set<string>();
  #deadline = performance.now() + millisecondsPerTarget;
  #calledBeforeReturn = false;
  #calledAfterReturn = false;

  constructor(
    readonly realm: Realm,
    readonly target: Target,
    readonly onSet: ((name: string) => void) | undefined,
  ) {
    const { name, path, mode, isInTable, hasOwnReceiver, length, argumentCount } = target;
    // A call that returns may have moved, cut or closed the file that a number names.
    const mayReturn = !endsItsReceiver.test(name) && !usesDescriptors.test(path);
    this.#options = { leavesOperandsAsMade: run => (mayReturn || run.completion.kind === "Threw") && changesIn(run).length === 0 };
    this.names = Array.from({ length: argumentCount }, () => new Map());
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
      changes: [],
    };
  }

  async run(sets: OperandSet[]): Promise<void> {
    const unseen = sets.filter(set => !this.#seenSets.has(set.name) && this.#seenSets.add(set.name));
    for (let start = 0; start < unseen.length; start += setsPerWait) {
      if (performance.now() > this.#deadline) {
        this.report.isCutShort = true;
        break;
      }
      const together = unseen.slice(start, start + setsPerWait);
      if (this.onSet) for (const { name } of together) this.onSet(name);
      for (const run of await runSets(this.realm, this.target.invocation, together, this.#options)) {
        if (run) this.#add(run);
      }
    }
  }

  #add(run: Run): void {
    const { report } = this;
    report.setCount++;
    const didReturn = run.completion.kind === "Returned";
    if (didReturn) report.returned++;
    else report.threw++;
    const kindOfResult = run.completion.kind === "Returned" ? kindOf(run.completion.value) : "";
    const usesReceiver = run.log.events.some(({ origin, isDuringStep }) => origin.operand === "this" && !isDuringStep);
    this.outcomes.set(run.set.name, { set: run.set, didReturn, message: messageOf(run), kindOfResult, eventCount: run.log.events.length, usesReceiver });
    this.names.forEach((names, position) => collectNamesRead(run, position, names));
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

  finish(): TargetReport {
    const { report } = this;
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

// A kind of real object is passed whole where the call ends in another way with the first of the kind than with a plain object.
async function runWithRealObjects(checker: Checker, base: OperandSet): Promise<void> {
  for (const position of base.arguments.keys()) {
    const withObject = (candidate: Candidate) => createSet(base.receiver, base.arguments.with(position, candidate));
    await checker.run(kindsOfRealObjects.map(([first]) => withObject(first)));
    const { outcomes } = checker;
    const ofPlainObject = outcomes.get(withObject(kindsOfRealObjects[0][0]).name);
    await checker.run(
      kindsOfRealObjects.flatMap(([first, ...others]) => {
        const outcome = outcomes.get(withObject(first).name);
        const isTold = outcome !== undefined && (outcome.didReturn !== ofPlainObject?.didReturn || outcome.message !== ofPlainObject.message || outcome.kindOfResult !== ofPlainObject.kindOfResult);
        return isTold ? others.map(withObject) : [];
      }),
    );
  }
}

async function checkSets(realm: Realm, target: Target, onSet?: (name: string) => void): Promise<TargetReport> {
  const checker = new Checker(realm, target, onSet);
  const withDescriptors = usesDescriptors.test(target.path);
  const receivers: Candidate[] = target.mode === "Call" || !target.hasOwnReceiver ? [...target.receivers, ...otherReceivers] : target.receivers;
  const [first, ...others] = receivers;

  await checker.run(setsAsWritten(target.path, first, target.argumentCount));
  const kinds = kindsFor(withDescriptors);
  const outcomesOf = (sets: OperandSet[]) => sets.flatMap(({ name }) => checker.outcomes.get(name) ?? []);
  // One kind in every position, for a function that does not say which of its operands it refuses. Then, position by position, each kind in
  // the sets that got furthest so far: with two positions that is every pair.
  const uniform = [undefinedCandidate, ...kinds].map(kind => createSet(first, Array<Candidate>(target.argumentCount).fill(kind)));
  await checker.run(uniform);
  let furthest = target.argumentCount <= positionsTriedInEveryCombination ? uniform : chooseBaseSets(outcomesOf(uniform));
  for (let position = 0; position < target.argumentCount; position++) {
    const sets = furthest.flatMap(set => kinds.map(kind => createSet(first, set.arguments.with(position, kind))));
    await checker.run(sets);
    if (target.argumentCount > positionsTriedInEveryCombination) furthest = chooseBaseSets(outcomesOf([...furthest, ...sets]));
  }
  const baseSets = chooseBaseSets([...checker.outcomes.values()]);
  // Twice: the first round of objects with the names shows the names that are looked for one level down.
  for (let round = 0; round < 2; round++) {
    for (const base of baseSets) await checker.run(setsWithBags(base, checker.names));
  }
  if (baseSets.length > 0) await runWithRealObjects(checker, baseSets[0]);
  const withOtherReceivers = others.flatMap(receiver => baseSets.map(base => createSet(receiver, base.arguments)));
  await checker.run(withOtherReceivers);
  // What is made or filled through `this` depends on the arguments.
  if (baseSets.length > 0 && withOtherReceivers.some(({ name }) => checker.outcomes.get(name)?.usesReceiver)) {
    const [{ arguments: base }] = baseSets;
    const vectors = [...base.keys()].flatMap(position => kinds.map(kind => base.with(position, kind)));
    await checker.run(others.flatMap(receiver => vectors.map(vector => createSet(receiver, vector))));
  }
  releaseKeptValues();
  return checker.finish();
}

const logOfNoCall = new Log();

export async function checkTarget(realm: Realm, target: Target, onSet?: (name: string) => void): Promise<TargetReport> {
  const report = await checkSets(realm, target, onSet);
  const changes = findChangedBuiltinObjects(logOfNoCall);
  if (changes.length === 0) return report;
  // Which of the calls it was shows when they are made once more.
  takeBack(changes);
  const again = await lookingAtBuiltinObjectsInEveryCall(() => checkSets(realm, target, onSet));
  if (!haveChangedAgain(logOfNoCall, changes)) again.changes.push(...changes.map(describeChangeOfBuiltinObject));
  return again;
}
