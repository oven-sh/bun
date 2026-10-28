// What a call did to its operands that native code without a declaration is taken never to do.
import { types } from "node:util";
import { describeKey, describeOrigin } from "../differential/behaviors";
import type { Trap } from "../differential/log";
import { isElementKey } from "../differential/references";
import type { Run } from "../differential/runs";
import { compareSnapshots, type Change, type ObjectState } from "../differential/snapshots";
import { describeOperand, isObject, type OperandUse } from "../differential/table-description";

export type OperandChange = {
  // The use that an entry would have to declare for it.
  use: OperandUse;
  where: string;
  what: string;
  set: string;
};

const useOfTrap: Partial<Record<Trap, OperandUse>> = {
  set: "StoresByKey",
  defineProperty: "DefinesName",
  deleteProperty: "DeletesByKey",
  setPrototypeOf: "ChangesPrototype",
  preventExtensions: "ChangesIntegrity",
};

function describePlace({ root, depth, isOnPrototypeChain }: ObjectState): string {
  const operand = describeOperand(root === 0 ? "this" : root - 1);
  const held = depth === 0 ? operand : `an object at depth ${depth} of ${operand}`;
  return isOnPrototypeChain ? `the prototype chain of ${held}` : held;
}

function useOfChange(change: Change): OperandUse {
  switch (change.kind) {
    case "Define":
    case "Store":
      return isElementKey(change.object, change.key) || (Array.isArray(change.object) && change.key === "length")
        ? "WritesContents"
        : "StoresByKey";
    case "DefineAccessor":
    case "Attributes":
      return "TakesDescriptor";
    case "Delete":
      return isElementKey(change.object, change.key) ? "MovesElements" : "DeletesByKey";
    case "Reorder":
      return "DeletesByKey";
    case "PreventExtensions":
      return "ChangesIntegrity";
    case "Prototype":
      return "ChangesPrototype";
    case "Internal":
      return "WritesContents";
  }
}

function describeChange(change: Change): string {
  switch (change.kind) {
    case "Define":
    case "Store":
    case "DefineAccessor":
    case "Delete":
    case "Attributes":
      return `${change.kind}${describeKey(change.key)}`;
    case "Internal":
      return `${change.kind} ${change.slot}${change.name === undefined ? "" : ` ${change.name}`}`;
    default:
      return change.kind;
  }
}

function findTrappedChanges({ log, set }: Run): OperandChange[] {
  return log.events.flatMap(({ trap, key, origin, isDuringStep, isLate }) => {
    const use = useOfTrap[trap];
    if (use === undefined || isDuringStep) return [];
    return [{ use, where: describeOrigin(origin), what: `${trap}${describeKey(key)}${isLate ? ", after the call returned" : ""}`, set: set.name }];
  });
}

function findSnapshotChanges({ before, after, set }: Run): OperandChange[] {
  return compareSnapshots(before, after).map(change => ({
    use: useOfChange(change),
    where: describePlace(before.get(change.object)!),
    what: describeChange(change),
    set: set.name,
  }));
}

function findNewInheritors({ completion, log, before, set }: Run): OperandChange[] {
  if (completion.kind !== "Returned" || !isObject(completion.value) || types.isProxy(completion.value)) return [];
  if (log.originOf(completion.value) !== undefined || before.has(completion.value)) return [];
  const prototype = Reflect.getPrototypeOf(completion.value);
  const origin = log.originOf(prototype);
  if (origin === undefined) return [];
  return [{ use: "BecomesPrototype", where: describeOrigin(origin), what: "it is the prototype of the result", set: set.name }];
}

export function findOperandChanges(run: Run): OperandChange[] {
  return [...findTrappedChanges(run), ...findSnapshotChanges(run), ...findNewInheritors(run)];
}

export function keyOfChange({ use, where, what }: OperandChange): string {
  return `${use} | ${where} | ${what}`;
}
