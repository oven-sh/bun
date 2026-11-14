// What the compiler takes a call to read beyond the reads of its entry. An entry declares what native code reads by itself. What the
// protocols of an operand read the compiler works out from the type of the operand: describeOperandCode() in
// JavaScriptCore/aot/ir/AOTEffectsOfOperands.cpp, membersRunBy() in AOTEffectsOfProtocols.cpp. This follows them for the best type that
// a program can prove of a value, and says no more than they do: a read that is missing here is reported, one too many would hide a wrong entry.
import { types } from "node:util";
import type { Realm } from "./members";
import { admitsValue } from "./operands";
import {
  isObject,
  keyOfSpelling,
  protocolKeys,
  spellingOf,
  type DumpedEntry,
  type DumpedParameter,
  type Heap,
  type OperandUse,
  type Protocol,
} from "./table-description";

// Unknown code reads everything.
export type ReadsOfOperandCode = "Everything" | readonly Heap[];

const usesOfReaders: readonly OperandUse[] = [
  "Inspects",
  "Retains",
  "Returns",
  "ReadsContents",
  "RetainsContents",
  "AppliesTransitively",
  "AppliesToContents",
];
const keylessProtocols: readonly Protocol[] = ["OwnKeys", "OwnValues", "PrototypeChain"];
const followedProtocols: readonly Protocol[] = [
  ...keylessProtocols,
  "ToPrimitive",
  "ToJSON",
  "Iterate",
  "Named",
  "CallsNamed",
];
const heapsOfMemberLookups: readonly Heap[] = ["ObjectFields", "NamedProperties", "PrototypeLinks"];
const heapsOfReachableObjects: readonly Heap[] = [
  "ObjectFields",
  "ShapeWords",
  "OrderWords",
  "PrototypeLinks",
  "NamedProperties",
  "Elements",
  "ArrayStorage",
  "TypedArrayStorage",
  "TypedArrayElements",
  "CollectionStorage",
  "CollectionEntries",
  "InternalFields",
  "PromiseState",
];

const entriesBySpelling = new WeakMap<Realm, Map<string, DumpedEntry[]>>();

function entriesNamed(realm: Realm, spelling: string): DumpedEntry[] {
  let index = entriesBySpelling.get(realm);
  if (!index) {
    index = Map.groupBy(
      realm.table.dump.entries.filter(({ holder }) => holder !== null),
      entry => spellingOf(realm.keyOf(entry)),
    );
    entriesBySpelling.set(realm, index);
  }
  return index.get(spelling) ?? [];
}

function entryOfFunction(realm: Realm, spelling: string, found: Function): DumpedEntry | undefined {
  const entry = entriesNamed(realm, spelling).find(
    other => other.kind !== "Accessor" && realm.valueOf(other.token) === found,
  );
  return entry?.sameObjectAs ? realm.table.entries.get(entry.sameObjectAs) : entry;
}

// A call of which only the callee is known: describeCallOf().
function readsOfCalling(entry: DumpedEntry): ReadsOfOperandCode {
  const reads: Heap[] = [];
  for (const overload of entry.overloads) {
    if (overload.mode !== "Call") continue;
    if (overload.isUndeclared || (overload.capability === "js" && !overload.runsOnlyOperandCode)) return "Everything";
    const operands = overload.receiver ? [overload.receiver, ...overload.parameters] : overload.parameters;
    if (operands.some(({ protocols }) => protocols.length > 0)) return "Everything";
    // What a function of the library reads is in its summary, which is not in the table.
    if (overload.implementation.how !== "Compiled") reads.push(...overload.reads);
  }
  return reads;
}

// A call of which the receiver is known too: describeCallOn(). It counts every overload up to the first that takes every such receiver, and this one only that.
function readsOfCallingOn(realm: Realm, entry: DumpedEntry, receiver: object): ReadsOfOperandCode {
  const overload = entry.overloads.find(
    ({ mode, receiver: declared }) =>
      mode === "Call" && (declared === null || admitsValue(realm, declared.accepted, receiver, true)),
  );
  if (!overload || overload.implementation.how === "Compiled") return [];
  if (overload.isUndeclared || (overload.capability === "js" && !overload.runsOnlyOperandCode)) return "Everything";
  return overload.parameters.some(({ protocols }) => protocols.length > 0) ? "Everything" : overload.reads;
}

function readsOfMembersCalled(
  realm: Realm,
  value: object,
  spellings: readonly string[],
  readsOf: (entry: DumpedEntry) => ReadsOfOperandCode,
): ReadsOfOperandCode {
  const reads: Heap[] = [];
  for (const spelling of spellings) {
    const found: unknown = Reflect.get(value, keyOfSpelling(spelling));
    if (typeof found !== "function") continue;
    const entry = entryOfFunction(realm, spelling, found);
    const ofCall = entry ? readsOf(entry) : "Everything";
    if (ofCall === "Everything") return ofCall;
    reads.push(...ofCall);
  }
  return reads;
}

const findsCallable = (value: object, spellings: readonly string[]) =>
  spellings.some(spelling => typeof Reflect.get(value, keyOfSpelling(spelling)) === "function");

// The walk over all that the operand reaches reads every object it comes to, whatever else it finds there.
function readsOfReachableValues(
  realm: Realm,
  { uses, protocols, namedMembers, calledMembers }: DumpedParameter,
  value: object,
): ReadsOfOperandCode {
  if (
    !uses.every(use => usesOfReaders.includes(use)) ||
    !protocols.every(protocol => followedProtocols.includes(protocol))
  )
    return "Everything";
  // A member that is found on a prototype is an object that no field lists.
  if (protocols.includes("Named") && !namedMembers.every(name => Object.hasOwn(value, keyOfSpelling(name))))
    return "Everything";
  // What an iterator gives and what such a member returns is reachable as well, and no field lists it either.
  if (
    protocols.includes("Iterate") &&
    protocolKeys.Iterate.some(spelling => Reflect.has(value, keyOfSpelling(spelling)))
  )
    return "Everything";
  if (protocols.includes("ToJSON") && findsCallable(value, protocolKeys.ToJSON)) return "Everything";
  if (protocols.includes("CallsNamed") && (calledMembers.length === 0 || findsCallable(value, calledMembers)))
    return "Everything";
  if (!protocols.includes("ToPrimitive")) return heapsOfReachableObjects;
  const ofConversion = readsOfMembersCalled(realm, value, protocolKeys.ToPrimitive, entry =>
    readsOfCallingOn(realm, entry, value),
  );
  return ofConversion === "Everything" ? ofConversion : [...heapsOfReachableObjects, ...ofConversion];
}

function readsOfOwnProtocols(realm: Realm, parameter: DumpedParameter, value: object): ReadsOfOperandCode {
  const { protocols, namedMembers, calledMembers } = parameter;
  // A step on the properties is proven for an object of the program alone.
  const isObjectOfProgram = Reflect.getPrototypeOf(value) === Object.prototype;
  if (!isObjectOfProgram && protocols.some(protocol => keylessProtocols.includes(protocol))) return "Everything";
  const reads: Heap[] = protocols.every(protocol => keylessProtocols.includes(protocol))
    ? []
    : [...heapsOfMemberLookups];
  for (const protocol of protocols) {
    let ofProtocol: ReadsOfOperandCode = [];
    if (protocol === "Iterate" || protocol === "Species") {
      if (protocolKeys[protocol].some(spelling => Reflect.has(value, keyOfSpelling(spelling)))) return "Everything";
    } else if (protocol === "ToPrimitive" || protocol === "ToJSON") {
      ofProtocol = readsOfMembersCalled(realm, value, protocolKeys[protocol], readsOfCalling);
    } else if (protocol === "CallsNamed") {
      ofProtocol =
        calledMembers.length === 0 ? "Everything" : readsOfMembersCalled(realm, value, calledMembers, readsOfCalling);
    } else if (protocol === "Named" && namedMembers.length === 0) {
      return "Everything";
    }
    if (ofProtocol === "Everything") return ofProtocol;
    reads.push(...ofProtocol);
  }
  return reads;
}

export function readsOfOperandCode(realm: Realm, parameter: DumpedParameter, value: unknown): ReadsOfOperandCode {
  if (!isObject(value) || parameter.protocols.length === 0) return [];
  if (types.isProxy(value) || typeof value === "function") return "Everything";
  if (parameter.uses.includes("AppliesTransitively")) return readsOfReachableValues(realm, parameter, value);
  // The protocols run on what the operand holds. The entry declares that it reads the operand.
  if (parameter.uses.includes("AppliesToContents")) return [];
  return readsOfOwnProtocols(realm, parameter, value);
}
