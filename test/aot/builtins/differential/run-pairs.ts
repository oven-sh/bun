// What one call does not show and two calls do: whether state is read before a conversion, in which order operands are
// converted, and which memory the result depends on.
import { types } from "node:util";
import { selectFor, type Difference } from "./compare";
import { changeState, contentOrigin, createCallback, findCandidate, type Candidate } from "./instances";
import { Log } from "./log";
import type { Invocation, Realm } from "./members";
import { perform, runSet } from "./observe";
import { admitsValue, baseSetOf, withArgument, withReceiver, type Call } from "./operands";
import type { Completion, OperandSet, Run } from "./runs";
import {
  conversionProtocols,
  describeOperand,
  isObject,
  parameterOf,
  type DumpedOverload,
  type OperandName,
} from "./table-description";

export type PairDifference = { overload: DumpedOverload; difference: Difference };

// Instances whose contents are primitives, so that two of them can be compared by value.
const comparableInstances = [
  "numbers:Array",
  "strings:Array",
  "filled:Uint8Array",
  "filled:Float64Array",
  "lengthTracking:Uint8Array",
  "filled:Buffer",
  "filled:ArrayBuffer",
  "resizable:ArrayBuffer",
  "filled:DataView",
  "primitives:Map",
  "primitives:Set",
  "valid:Date",
  "global:RegExp",
  "object:primitives",
  "filled:Headers",
  "filled:URL",
  "filled:URLSearchParams",
].map(findCandidate);

// A view of a detached buffer cannot be walked.
function isSameValue(left: unknown, right: unknown): boolean {
  try {
    return Bun.deepEquals(left, right, true);
  } catch {
    return Bun.inspect(left) === Bun.inspect(right);
  }
}

function hasSameOutcome(left: Completion, right: Completion): boolean {
  if (left.kind === "Threw" || right.kind === "Threw") return left.kind === right.kind;
  return isSameValue(left.value, right.value);
}

function describeOutcome(completion: Completion): string {
  if (completion.kind === "Threw") return "threw";
  return `returned ${Bun.inspect(completion.value, { depth: 1 }).replaceAll(/\s+/g, " ").slice(0, 60)}`;
}

function convertingTo(value: unknown, beforeAnswer: (receiver: unknown) => void): Candidate {
  return {
    name: `object:changesStateAndConvertsTo:${Bun.inspect(value)}`,
    kind: "Instrumented",
    isReentrant: true,
    create(log, operand, { receiver }) {
      const answer = () => {
        beforeAnswer(receiver);
        return value;
      };
      return {
        valueOf: createCallback(log, contentOrigin(operand, "Property", "valueOf"), answer),
        toString: createCallback(log, contentOrigin(operand, "Property", "toString"), answer),
      };
    },
  };
}

function changedAtCreation(candidate: Candidate): Candidate {
  return {
    ...candidate,
    name: `changed:${candidate.name}`,
    create(log, operand, context) {
      const value = candidate.create(log, operand, context);
      changeState(value);
      return value;
    },
  };
}

function convertedPositions(overload: DumpedOverload, set: OperandSet): number[] {
  return set.arguments.flatMap((candidate, position) => {
    const conversion = parameterOf(overload, position)?.conversion ?? "None";
    return candidate.kind === "Primitive" && conversionProtocols[conversion].includes("ToPrimitive") ? [position] : [];
  });
}

function isAcceptedReceiver(realm: Realm, call: Call, overload: DumpedOverload, run: Run | undefined): run is Run {
  return run !== undefined && selectFor(realm, call, run) === overload;
}

// The resolver may run a conversion before the call. That is the same program only if the built-in has read nothing by then
// that the code of the conversion can change.
async function checkStateBeforeConversions(
  realm: Realm,
  call: Call,
  invocation: Invocation,
  overload: DumpedOverload,
  base: OperandSet,
): Promise<Difference[]> {
  if (overload.readsStateBeforeConversions || overload.receiver === null) return [];
  for (const receiver of comparableInstances) {
    const plain = withReceiver(base, receiver);
    if (!isAcceptedReceiver(realm, call, overload, await runSet(realm, invocation, plain))) continue;
    for (const position of convertedPositions(overload, plain)) {
      const value = plain.arguments[position].create(new Log(), position, { receiver: undefined });
      const during = await runSet(realm, invocation, withArgument(plain, position, convertingTo(value, changeState)));
      const before = await runSet(realm, invocation, withReceiver(plain, changedAtCreation(receiver)));
      if (!during || !before) continue;
      const isSame = hasSameOutcome(during.completion, before.completion) && isSameValue(during.receiver, before.receiver);
      if (isSame) continue;
      const message =
        `with a conversion of ${describeOperand(position)} that changes this the call ${describeOutcome(during.completion)}, ` +
        `with the change made before the call it ${describeOutcome(before.completion)}`;
      return [{ column: "readsStateBeforeConversions", message, set: during.set.name }];
    }
  }
  return [];
}

function firstConversions(run: Run): OperandName[] {
  const order: OperandName[] = [];
  for (const { origin } of run.log.events) if (!order.includes(origin.operand)) order.push(origin.operand);
  return order;
}

const rankOf = (operand: OperandName) => (operand === "this" ? -1 : operand);

async function checkConversionOrder(
  realm: Realm,
  call: Call,
  invocation: Invocation,
  overload: DumpedOverload,
  base: OperandSet,
): Promise<Difference[]> {
  const positions = convertedPositions(overload, base);
  if (positions.length < 2) return [];
  let set = base;
  for (const position of positions) {
    const value = base.arguments[position].create(new Log(), position, { receiver: undefined });
    set = withArgument(set, position, { ...convertingTo(value, () => {}), isReentrant: false });
  }
  const run = await runSet(realm, invocation, set);
  if (!run || selectFor(realm, call, run) !== overload) return [];
  const order = firstConversions(run);
  if (order.every((operand, index) => index === 0 || rankOf(order[index - 1]) < rankOf(operand))) return [];
  return [{ column: "parameters", message: `the operands are converted in the order ${order.map(describeOperand).join(", ")}`, set: set.name }];
}

type Change = { heaps: string[]; apply(value: any): void };

function changesOf(value: unknown): Change[] {
  if (!isObject(value)) return [];
  if (Array.isArray(value)) {
    return [
      { heaps: ["Elements"], apply: array => (array[0] = typeof array[0] === "string" ? "z" : 99) },
      { heaps: ["ArrayStorage", "Elements"], apply: array => array.push(array[0]) },
    ];
  }
  if (types.isTypedArray(value)) return [{ heaps: ["TypedArrayElements"], apply: view => (view[0] = 99) }];
  if (types.isArrayBuffer(value)) {
    const store: Change = { heaps: ["TypedArrayElements"], apply: buffer => (new Uint8Array(buffer)[0] = 99) };
    return value.resizable ? [store, { heaps: ["TypedArrayStorage"], apply: buffer => buffer.resize(4) }] : [store];
  }
  if (types.isDataView(value)) return [{ heaps: ["TypedArrayElements"], apply: view => view.setUint8(0, 99) }];
  if (types.isMap(value)) {
    return [
      { heaps: ["CollectionEntries", "CollectionStorage"], apply: map => map.set(1, "changed") },
      { heaps: ["CollectionEntries", "CollectionStorage"], apply: map => map.set("added", 1) },
    ];
  }
  if (types.isSet(value)) return [{ heaps: ["CollectionEntries", "CollectionStorage"], apply: set => set.add("added") }];
  if (types.isDate(value)) return [{ heaps: ["InternalFields"], apply: date => date.setTime(1e12) }];
  if (types.isRegExp(value)) return [{ heaps: ["RegExpState"], apply: expression => (expression.lastIndex = 1) }];
  if (value instanceof Headers) return [{ heaps: ["ExternalState"], apply: headers => headers.set("a", "changed") }];
  if (value instanceof URL) return [{ heaps: ["ExternalState"], apply: url => (url.pathname = "/changed") }];
  if (value instanceof URLSearchParams) return [{ heaps: ["ExternalState"], apply: parameters => parameters.set("a", "changed") }];
  if (Reflect.getPrototypeOf(value) !== Object.prototype) return [];
  return [
    { heaps: ["NamedProperties", "ObjectFields"], apply: object => (object.a = 99) },
    { heaps: ["NamedProperties", "ObjectFields", "ShapeWords", "OrderWords"], apply: object => (object.added = 1) },
  ];
}

function complete(invocation: Invocation, receiver: unknown, args: unknown[]): Completion {
  try {
    return { kind: "Returned", value: perform(invocation, receiver, args) };
  } catch (error) {
    return { kind: "Threw", error };
  }
}

// Its own values, and what the getters of its class answer for it: an object of the host keeps what it holds in native memory, and the formatter prints it from there.
function valuesHeldBy(value: object): unknown[] {
  const held = Reflect.ownKeys(value).map(key => Reflect.getOwnPropertyDescriptor(value, key)!.value);
  for (let holder = Object.getPrototypeOf(value); holder !== null && Object.getPrototypeOf(holder) !== null; holder = Object.getPrototypeOf(holder)) {
    for (const key of Reflect.ownKeys(holder)) {
      const getter = Reflect.getOwnPropertyDescriptor(holder, key)!.get;
      if (getter === undefined) continue;
      try {
        held.push(Reflect.apply(getter, value, []));
      } catch {}
    }
  }
  return held;
}

function reaches(value: unknown, wanted: object, depth: number): boolean {
  if (value === wanted) return true;
  if (!isObject(value) || depth === 0 || types.isProxy(value)) return false;
  return valuesHeldBy(value).some(held => reaches(held, wanted, depth - 1));
}

// A copy, so that a result that shares memory with an operand is compared as it was.
function freeze(completion: Completion): Completion {
  if (completion.kind === "Threw" || !isObject(completion.value)) return completion;
  try {
    return { kind: "Returned", value: structuredClone(completion.value) };
  } catch {
    return { kind: "Returned", value: Bun.inspect(completion.value, { depth: 3 }) };
  }
}

// A call that reads nothing that a store in between writes may be merged with an earlier call or moved across the store.
async function checkReads(
  realm: Realm,
  call: Call,
  invocation: Invocation,
  overload: DumpedOverload,
  base: OperandSet,
): Promise<Difference[]> {
  if (overload.capability === "js" && !overload.runsOnlyOperandCode) return [];
  const operands: OperandName[] = [...(overload.receiver ? ["this" as const] : []), ...base.arguments.keys()];
  for (const operand of operands) {
    for (const candidate of comparableInstances) {
      const set = operand === "this" ? withReceiver(base, candidate) : withArgument(base, operand, candidate);
      const count = changesOf(candidate.create(new Log(), operand, { receiver: undefined })).length;
      for (let index = 0; index < count; index++) {
        const run = await runSet(realm, invocation, set);
        if (!isAcceptedReceiver(realm, call, overload, run) || run.log.events.length > 0) break;
        const parameter = parameterOf(overload, operand);
        const passed = operand === "this" ? run.receiver : run.args[operand];
        if (!parameter || !admitsValue(realm, parameter.accepted, passed, true)) break;
        const first = freeze(complete(invocation, run.receiver, run.args));
        const second = freeze(complete(invocation, run.receiver, run.args));
        if (!hasSameOutcome(first, second)) break;
        const value = operand === "this" ? run.receiver : run.args[operand];
        // A result that is or holds the operand changes with it, whatever the call read.
        const plain = complete(invocation, run.receiver, run.args);
        if (plain.kind === "Returned" && isObject(value) && reaches(plain.value, value, 3)) break;
        const change = changesOf(value)[index];
        if (!change) break;
        const { heaps, apply } = change;
        try {
          apply(value);
        } catch {
          break;
        }
        const third = freeze(complete(invocation, run.receiver, run.args));
        if (hasSameOutcome(second, third) || heaps.some(heap => overload.reads.includes(heap))) continue;
        const message =
          `the call ${describeOutcome(second)}, and after a store to ${heaps.join(" or ")} of ${describeOperand(operand)} ` +
          `it ${describeOutcome(third)}`;
        return [{ column: "reads", message, set: set.name }];
      }
    }
  }
  return [];
}

export async function checkPairs(realm: Realm, call: Call, invocation: Invocation): Promise<PairDifference[]> {
  const found: PairDifference[] = [];
  if (call.mode === "Set") return found;
  for (const overload of call.overloads) {
    if (overload.isUndeclared) continue;
    const base = baseSetOf(realm, call, overload);
    if (!base) continue;
    const differences = [
      ...(await checkStateBeforeConversions(realm, call, invocation, overload, base)),
      ...(await checkConversionOrder(realm, call, invocation, overload, base)),
      ...(await checkReads(realm, call, invocation, overload, base)),
    ];
    for (const difference of differences) found.push({ overload, difference });
  }
  return found;
}
