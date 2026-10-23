// What one call does not show and two calls do: whether state is read before a conversion, in which order operands are
// converted, and which memory the result depends on.
import { types } from "node:util";
import { selectFor, type Difference } from "./compare";
import { changeState, contentOrigin, createCallback, findCandidate, type Candidate } from "./instances";
import { Log } from "./log";
import type { Invocation, Realm } from "./members";
import { perform, runSet } from "./observe";
import { readsOfOperandCode } from "./operand-code";
import { admitsValue, baseSetOf, isCallThatExists, withArgument, withReceiver, type Call } from "./operands";
import { candidateOf, valueOf, type Completion, type OperandSet, type Run } from "./runs";
import {
  conversionProtocols,
  describeOperand,
  isObject,
  parameterOf,
  type Conversion,
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
  "filled:SharedArrayBuffer",
  "growable:SharedArrayBuffer",
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

const isNew = (symbol: symbol) =>
  Symbol.keyFor(symbol) === undefined &&
  !Object.values(Object.getOwnPropertyDescriptors(Symbol)).some(({ value }) => value === symbol);

// Two calls that make a symbol make two. deepEquals takes two invalid dates and two URLSearchParams with a repeated name for different values, and two regular expressions
// that differ in lastIndex for the same one. A view of a detached buffer cannot be walked.
function isSameValue(left: unknown, right: unknown): boolean {
  if (types.isDate(left) && types.isDate(right)) return Object.is(left.getTime(), right.getTime());
  if (left instanceof URLSearchParams && right instanceof URLSearchParams) return left.toString() === right.toString();
  if (types.isRegExp(left) && types.isRegExp(right) && left.lastIndex !== right.lastIndex) return false;
  if (typeof left === "symbol" && typeof right === "symbol")
    return left === right || (isNew(left) && isNew(right) && left.description === right.description);
  try {
    return Bun.deepEquals(left, right, true);
  } catch {
    return Bun.inspect(left) === Bun.inspect(right);
  }
}

const classOfError = (error: unknown) => (isObject(error) ? Reflect.getPrototypeOf(error) : error);

function hasSameOutcome(left: Completion, right: Completion): boolean {
  if (left.kind === "Threw" || right.kind === "Threw") {
    return left.kind === right.kind && classOfError(left.error) === classOfError(right.error);
  }
  return isSameValue(left.value, right.value);
}

function describeOutcome(completion: Completion): string {
  if (completion.kind === "Threw")
    return `threw ${isObject(completion.error) ? Reflect.get(completion.error, "name") : Bun.inspect(completion.error)}`;
  return `returned ${Bun.inspect(completion.value, { depth: 1 }).replaceAll(/\s+/g, " ").slice(0, 60)}`;
}

function convertingTo(value: unknown, beforeAnswer: () => void): Candidate {
  return {
    name: `object:changesStateAndConvertsTo:${Bun.inspect(value)}`,
    kind: "Instrumented",
    isReentrant: true,
    create(log, operand) {
      const answer = () => {
        beforeAnswer();
        return value;
      };
      return {
        valueOf: createCallback(log, contentOrigin(operand, "Property", "valueOf"), answer),
        toString: createCallback(log, contentOrigin(operand, "Property", "toString"), answer),
      };
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

async function runIfCallExists(
  realm: Realm,
  call: Call,
  invocation: Invocation,
  set: OperandSet,
): Promise<Run | undefined> {
  return isCallThatExists(realm, call, set) ? runSet(realm, invocation, set) : undefined;
}

function withOperand(set: OperandSet, operand: OperandName, candidate: Candidate): OperandSet {
  return operand === "this" ? withReceiver(set, candidate) : withArgument(set, operand, candidate);
}

function toPrimitive(value: any): unknown {
  if (!isObject(value)) return value;
  const own = Reflect.get(value, Symbol.toPrimitive);
  for (const method of own != null ? [own] : [Reflect.get(value, "valueOf"), Reflect.get(value, "toString")]) {
    if (typeof method !== "function") continue;
    const answer = Reflect.apply(method, value, own != null ? ["default"] : []);
    if (!isObject(answer)) return answer;
  }
  throw new TypeError("no primitive value");
}

function toIndex(value: any): number {
  const index = Math.trunc(+value) || 0;
  if (index < 0 || index > Number.MAX_SAFE_INTEGER) throw new RangeError("no index");
  return index;
}

function toObject(value: unknown): object {
  if (value === undefined || value === null) throw new TypeError("no object");
  return Object(value);
}

// The conversions as the language itself makes them, so that they run the code and throw the errors that the operations of the compiler do.
const conversions: Readonly<Record<Conversion, (value: any) => unknown>> = {
  None: value => value,
  Dictionary: value => value,
  ToBoolean: value => !!value,
  ToNumber: value => +value,
  ToNumeric: value => -(-value),
  ToString: value => `${value}`,
  ToPropertyKey: value => Reflect.ownKeys({ [value]: 0 })[0],
  ToObject: toObject,
  ToPrimitive: toPrimitive,
  ToIntegerOrInfinity: value => Math.trunc(+value) || 0,
  ToLength: value => Math.min(Math.max(Math.trunc(+value) || 0, 0), Number.MAX_SAFE_INTEGER),
  ToIndex: toIndex,
  ToInt32: value => value | 0,
  ToUint32: value => value >>> 0,
  // Of the values that are passed here none is wider.
  ToBigInt: value => BigInt.asIntN(64, value),
};

type Step = "Pass" | "Convert" | "LeaveToBuiltin";

// What the resolver does with an operand in front of a call that it has matched: a value that the parameter accepts is passed,
// another one is converted, and for one that the parameter refuses or has no conversion for all operands go to the built-in as they are.
function stepFor(realm: Realm, overload: DumpedOverload, operand: OperandName, value: unknown): Step {
  const parameter = parameterOf(overload, operand);
  if (!parameter || admitsValue(realm, parameter.accepted, value, true)) return "Pass";
  if (admitsValue(realm, parameter.refused, value, true)) return "LeaveToBuiltin";
  return parameter.conversion === "None" || parameter.conversion === "Dictionary" ? "LeaveToBuiltin" : "Convert";
}

function isResolved(realm: Realm, overload: DumpedOverload, { receiver, args }: Run): boolean {
  const operands: [OperandName, unknown][] = [
    ...(overload.receiver ? [["this", receiver] as const] : []),
    ...args.entries(),
  ];
  return operands.every(([operand, value]) => stepFor(realm, overload, operand, value) !== "LeaveToBuiltin");
}

// The program that the resolver makes of the call: the steps of the receiver and of the arguments from left to right, then the built-in.
function withStepsBeforeCall(realm: Realm, invocation: Invocation, overload: DumpedOverload): Invocation | undefined {
  const { callee, mode, callsWhatIsRead } = invocation;
  if (!callee || callsWhatIsRead || (mode !== "Call" && mode !== "Construct")) return undefined;
  const step = (operand: OperandName, value: unknown) =>
    stepFor(realm, overload, operand, value) === "Convert"
      ? conversions[parameterOf(overload, operand)!.conversion](value)
      : value;
  return {
    ...invocation,
    callee: function (this: unknown, ...args: unknown[]) {
      const receiver = step("this", this);
      const stepped = args.map((value, position) => step(position, value));
      return new.target ? Reflect.construct(callee, stepped) : Reflect.apply(callee, receiver, stepped);
    },
  };
}

// Values that a built-in may refuse, or take for a reason to return at once.
const oddPrimitives = ["-1", "1.5", "NaN", "Infinity", '""', "undefined", "null"].map(text =>
  findCandidate(`primitive:${text}`),
);

type ConvertingSet = { set: OperandSet; conversionCount(): number };

// The set with an object at the position whose conversion changes the operand, if one is named, and is counted.
function withCountedConversion(plain: OperandSet, position: number, operand: OperandName | undefined): ConvertingSet {
  const value = plain.arguments[position].create(new Log(), position, { receiver: undefined });
  let count = 0;
  let changed: unknown;
  const converting = convertingTo(value, () => {
    count++;
    changeState(changed);
  });
  const set = withArgument(plain, position, converting);
  if (operand === undefined) return { set, conversionCount: () => count };
  const candidate = candidateOf(plain, operand)!;
  const remembered: Candidate = { ...candidate, create: (...inputs) => (changed = candidate.create(...inputs)) };
  return { set: withOperand(set, operand, remembered), conversionCount: () => count };
}

// The resolver may run a conversion before the call. That is the same program only if the built-in runs the conversion whatever
// it finds, and has read nothing by then that the code of the conversion can change.
async function checkStateBeforeConversions(
  realm: Realm,
  call: Call,
  invocation: Invocation,
  overload: DumpedOverload,
  base: OperandSet,
): Promise<Difference[]> {
  if (overload.readsStateBeforeConversions) return [];
  const resolved = withStepsBeforeCall(realm, invocation, overload);
  if (!resolved) return [];

  const compare = async (
    plain: OperandSet,
    position: number,
    operand: OperandName | undefined,
  ): Promise<Difference | undefined> => {
    const inside = withCountedConversion(plain, position, operand);
    const before = withCountedConversion(plain, position, operand);
    const insideRun = await runIfCallExists(realm, call, invocation, inside.set);
    const beforeRun = await runIfCallExists(realm, call, resolved, before.set);
    if (!isAcceptedReceiver(realm, call, overload, insideRun) || !isResolved(realm, overload, insideRun) || !beforeRun)
      return undefined;
    const isSame =
      inside.conversionCount() === before.conversionCount() &&
      hasSameOutcome(insideRun.completion, beforeRun.completion) &&
      (operand === undefined || isSameValue(valueOf(insideRun, operand), valueOf(beforeRun, operand)));
    if (isSame) return undefined;
    const change = operand === undefined ? "" : ` that changes ${describeOperand(operand)}`;
    const message =
      `with a conversion of ${describeOperand(position)}${change} the call ${describeOutcome(insideRun.completion)} and ran it ${inside.conversionCount()} times, ` +
      `with the conversions made before the call it ${describeOutcome(beforeRun.completion)}`;
    return { column: "readsStateBeforeConversions", message, set: insideRun.set.name };
  };

  for (const position of convertedPositions(overload, base)) {
    const others = [...base.arguments.keys()].filter(other => other !== position);
    const sets = [
      base,
      ...others.flatMap(other => oddPrimitives.map(candidate => withArgument(base, other, candidate))),
    ];
    for (const set of sets) {
      const difference = await compare(set, position, undefined);
      if (difference) return [difference];
    }
  }
  const operands: OperandName[] = [...(overload.receiver ? ["this" as const] : []), ...base.arguments.keys()];
  for (const operand of operands) {
    for (const candidate of comparableInstances) {
      const plain = withOperand(base, operand, candidate);
      const positions = convertedPositions(overload, plain).filter(position => position !== operand);
      if (positions.length === 0) break;
      const run = await runIfCallExists(realm, call, invocation, plain);
      if (!isAcceptedReceiver(realm, call, overload, run) || !isResolved(realm, overload, run)) continue;
      for (const position of positions) {
        const difference = await compare(plain, position, operand);
        if (difference) return [difference];
      }
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
  const run = await runIfCallExists(realm, call, invocation, set);
  if (!run || selectFor(realm, call, run) !== overload) return [];
  const order = firstConversions(run);
  if (order.every((operand, index) => index === 0 || rankOf(order[index - 1]) < rankOf(operand))) return [];
  return [
    {
      column: "parameters",
      message: `the operands are converted in the order ${order.map(describeOperand).join(", ")}`,
      set: set.name,
    },
  ];
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
  if (types.isSet(value))
    return [{ heaps: ["CollectionEntries", "CollectionStorage"], apply: set => set.add("added") }];
  if (types.isDate(value)) return [{ heaps: ["InternalFields"], apply: date => date.setTime(1e12) }];
  if (types.isRegExp(value)) return [{ heaps: ["RegExpState"], apply: expression => (expression.lastIndex = 1) }];
  if (value instanceof Headers) return [{ heaps: ["ExternalState"], apply: headers => headers.set("a", "changed") }];
  if (value instanceof URL) return [{ heaps: ["ExternalState"], apply: url => (url.pathname = "/changed") }];
  if (value instanceof URLSearchParams)
    return [{ heaps: ["ExternalState"], apply: parameters => parameters.set("a", "changed") }];
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
  if (types.isMap(value)) held.push(...value.keys(), ...value.values());
  if (types.isSet(value)) held.push(...value);
  for (
    let holder = Object.getPrototypeOf(value);
    holder !== null && Object.getPrototypeOf(holder) !== null;
    holder = Object.getPrototypeOf(holder)
  ) {
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
  } catch {}
  // The formatter calls the method of the class that describes an instance, and a prototype object is none.
  try {
    return { kind: "Returned", value: Bun.inspect(completion.value, { depth: 3 }) };
  } catch {
    return completion;
  }
}

type StoreOutcome = "NoVerdict" | "Explained" | { message: string };

// The call, a store to memory of the operand, and the call again, on operands that are made anew.
async function callAroundStore(
  realm: Realm,
  call: Call,
  invocation: Invocation,
  overload: DumpedOverload,
  set: OperandSet,
  operand: OperandName,
  index: number,
): Promise<StoreOutcome> {
  const run = await runIfCallExists(realm, call, invocation, set);
  if (!isAcceptedReceiver(realm, call, overload, run) || run.log.events.length > 0) return "NoVerdict";
  const parameter = parameterOf(overload, operand);
  const value = valueOf(run, operand);
  if (!parameter || !admitsValue(realm, parameter.accepted, value, true)) return "NoVerdict";
  const first = freeze(complete(invocation, run.receiver, run.args));
  const second = freeze(complete(invocation, run.receiver, run.args));
  if (!hasSameOutcome(first, second)) return "NoVerdict";
  // A result that is the operand, holds it or is held by it changes with it, whatever the call read.
  const plain = complete(invocation, run.receiver, run.args);
  if (plain.kind === "Returned" && isObject(value) && reaches(plain.value, value, 3)) return "NoVerdict";
  if (plain.kind === "Returned" && isObject(plain.value) && reaches(value, plain.value, 1)) return "NoVerdict";
  const change = changesOf(value)[index];
  if (!change) return "NoVerdict";
  const { heaps, apply } = change;
  try {
    apply(value);
  } catch {
    return "NoVerdict";
  }
  const third = freeze(complete(invocation, run.receiver, run.args));
  if (hasSameOutcome(second, third) || heaps.some(heap => overload.reads.includes(heap))) return "Explained";
  const ofOperandCode = readsOfOperandCode(realm, parameter, value);
  if (ofOperandCode === "Everything" || heaps.some(heap => ofOperandCode.includes(heap))) return "Explained";
  const message =
    `the call ${describeOutcome(second)}, and after a store to ${heaps.join(" or ")} of ${describeOperand(operand)} ` +
    `it ${describeOutcome(third)}`;
  return { message };
}

// A clock answers otherwise on its own, and now and then just behind the store.
const timesToShow = 3;

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
    // A read of the name from any other value is not a use of the entry.
    if (operand === "this" && call.entry.kind === "DataProperty") continue;
    for (const candidate of comparableInstances) {
      const set = withOperand(base, operand, candidate);
      const count = changesOf(candidate.create(new Log(), operand, { receiver: undefined })).length;
      for (let index = 0; index < count; index++) {
        let outcome = await callAroundStore(realm, call, invocation, overload, set, operand, index);
        for (let time = 1; time < timesToShow && typeof outcome === "object"; time++) {
          outcome = await callAroundStore(realm, call, invocation, overload, set, operand, index);
        }
        if (outcome === "NoVerdict") break;
        if (typeof outcome === "object") return [{ column: "reads", message: outcome.message, set: set.name }];
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
