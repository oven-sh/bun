import { types } from "node:util";
import type { Origin } from "./log";
import type { Realm } from "./members";
import { hasIndexedElements, internalsOf } from "./references";
import type { Run } from "./runs";
import type { ObjectState } from "./snapshots";
import {
  covers,
  isIndexKey,
  isObject,
  unreachable,
  type DumpedLayout,
  type DumpedOperand,
  type DumpedSlot,
  type DumpedType,
  type DumpedTypePart,
} from "./table-description";

export type TypeContext = {
  realm: Realm;
  run: Run;
  visited: Set<object>;
  // Whether something beside the type says that the value may be in that slot of the result.
  isStoredInResultSlot?(slot: string, value: unknown): boolean;
};

const maxPlainDataDepth = 6;

export function operandValuesOf(run: Run, declared: DumpedOperand): unknown[] {
  if (declared === "this") return [run.receiver];
  if ("argument" in declared) return declared.argument < run.args.length ? [run.args[declared.argument]] : [];
  return run.args.slice(declared.argumentsFrom);
}

function statesOf(run: Run, value: object): ObjectState[] {
  const target = run.log.targetOf(value);
  return [run.before.get(target), run.after.get(target)].filter(state => state !== undefined);
}

function elementsIn(value: object, state: ObjectState): unknown[] {
  const elements = state.internals.filter(({ slot }) => slot === "Element").map(internal => internal.value);
  if (!hasIndexedElements(value)) return elements;
  for (const [key, descriptor] of state.descriptors) {
    if (isIndexKey(key) && Object.hasOwn(descriptor, "value")) elements.push(descriptor.value);
  }
  return elements;
}

function valuesInState(value: object, state: ObjectState, slot: DumpedSlot): unknown[] | undefined {
  switch (slot.contentsSlot) {
    case "Element":
      return types.isGeneratorObject(value) ? undefined : elementsIn(value, state);
    case "Key":
    case "Value":
      return state.internals.filter(internal => internal.slot === slot.contentsSlot).map(internal => internal.value);
    case null:
      break;
    default:
      return unreachable(slot.contentsSlot);
  }
  if (slot.name === "reason") return state.internals.filter(internal => internal.slot === "Reason").map(({ value }) => value);
  const own = state.descriptors.get(slot.name);
  if (own && Object.hasOwn(own, "value")) return [own.value];
  const named = state.internals.filter(internal => internal.slot === "State" && internal.name === slot.name);
  return named.length > 0 ? named.map(internal => internal.value) : undefined;
}

// What the slot held before or holds after the call. Undefined where JavaScript cannot read the slot.
export function valuesInSlot(run: Run, value: unknown, slot: DumpedSlot): unknown[] | undefined {
  if (!isObject(value)) return undefined;
  const target = run.log.targetOf(value);
  const states = statesOf(run, value);
  if (states.length === 0) return undefined;
  const values: unknown[] = [];
  for (const state of states) {
    const held = valuesInState(target, state, slot);
    if (held === undefined) return undefined;
    values.push(...held);
  }
  return values;
}

export function includesSame(values: readonly unknown[], value: unknown): boolean {
  return values.some(other => Object.is(other, value) || (other === 0 && value === 0));
}

export function isContentOf(origin: Origin | undefined, declared: DumpedOperand): origin is Extract<Origin, { kind: "Content" }> {
  return origin?.kind === "Content" && covers(declared, origin.operand);
}

export function isInSlot({ realm, run }: TypeContext, value: unknown, declared: DumpedOperand, slotToken: string): boolean {
  const slot = realm.table.slots.get(slotToken);
  if (!slot) return false;
  let isReadable = true;
  for (const holder of operandValuesOf(run, declared)) {
    const held = valuesInSlot(run, holder, slot);
    if (held === undefined) isReadable = false;
    else if (includesSame(held, value)) return true;
  }
  const origin = run.log.originOf(value);
  if (isContentOf(origin, declared) && origin.depth === 1) {
    return origin.content === slot.contentsSlot || origin.key === slot.name || origin.content === "Iterated";
  }
  return !isReadable && origin === undefined;
}

export function isIteratedFrom(context: TypeContext, value: unknown, declared: DumpedOperand, isSettled: boolean): boolean {
  if (!isObject(value)) return true;
  const { log } = context.run;
  const origin = log.originOf(value);
  if (isContentOf(origin, declared)) return isSettled || origin.depth === 1;
  if (origin !== undefined) return false;
  // An entry of a map or of an array iterator is a pair that the iteration makes, a segment of a string is a record.
  if (!Array.isArray(value)) return isNewPlainData(context, value, 0);
  return value.every(element => !isObject(element) || isContentOf(log.originOf(element), declared));
}

export function resultsOfCalls(run: Run, declared: DumpedOperand): unknown[] {
  return run.log.events.flatMap(({ origin, outcome }) =>
    origin.kind === "Operand" && covers(declared, origin.operand) && outcome && "returned" in outcome
      ? [outcome.returned]
      : [],
  );
}

export function prototypeBefore(run: Run, value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (!isObject(value)) return Reflect.getPrototypeOf(Object(value));
  return run.before.get(run.log.targetOf(value))?.prototype;
}

function typedArrayClassOf(realm: Realm, value: unknown): string | undefined {
  return realm.classesOf(value).find(token => realm.table.classes.get(token)?.parent === "TypedArray");
}

function instanceClassOfReceiver(realm: Realm, receiver: unknown): string | undefined {
  if (typeof receiver !== "function") return realm.classesOf(receiver)[0];
  const description = realm.table.dump.classes.find(({ constructor }) => realm.valueOf(constructor) === receiver);
  if (description) return description.token;
  const prototype: unknown = types.isProxy(receiver) ? undefined : Reflect.getOwnPropertyDescriptor(receiver, "prototype")?.value;
  return isObject(prototype) ? realm.classesOf(Object.create(prototype))[0] : undefined;
}

function findInstanceMismatch(
  context: TypeContext,
  value: object,
  part: Extract<DumpedTypePart, { part: "Instance" }>,
): string | undefined {
  const { realm, run } = context;
  const description = realm.table.classes.get(part.class);
  const classes = realm.classesOf(value);
  const hasBrand = description !== undefined && description.instanceTest !== "None";
  const canRecognize = hasBrand || isObject(realm.valueOf(description?.prototype ?? null)) || classes.includes(part.class);
  // Whatever its prototype is, an object that no other class claims is an ordinary object.
  const isOrdinary = part.class === "Object" && typeof value === "object" && (classes.length === 0 || classes[0] === "Object");
  if (canRecognize && !isOrdinary && !classes.includes(part.class)) return `${describeClass(realm, value)} is no ${part.class}`;
  for (const { slot: slotToken, type } of part.contents) {
    const slot = realm.table.slots.get(slotToken);
    // A promise is resolved with a value: it takes on what a thenable settles to.
    if (slotToken === "PromiseValue" && type.parts.some(inner => inner.part !== "Instance" && inner.part !== "Layout")) continue;
    const held = slot && currentValuesInSlot(run, value, slot);
    for (const content of held ?? []) {
      const mismatch = findMismatch(context, type, content);
      if (mismatch !== undefined && !context.isStoredInResultSlot?.(slotToken, content)) return `in ${slotToken}: ${mismatch}`;
    }
  }
  return undefined;
}

function currentValuesInSlot(run: Run, value: object, slot: DumpedSlot): unknown[] | undefined {
  if (types.isProxy(value)) return undefined;
  const state: ObjectState = {
    keys: [],
    descriptors: new Map(Reflect.ownKeys(value).map(key => [key, Reflect.getOwnPropertyDescriptor(value, key)!])),
    prototype: null,
    isExtensible: true,
    internals: internalsOf(value, run.log),
  };
  return valuesInState(value, state, slot);
}

function describeClass(realm: Realm, value: object): string {
  if (typeof value === "function") return "a function";
  return `an instance of ${realm.classesOf(value)[0] ?? "no class"}`;
}

function findTupleMismatch(context: TypeContext, value: object, layout: DumpedLayout): string | undefined {
  if (!Array.isArray(value)) return `${layout.token} is an array`;
  if (value.length !== layout.fields.length) return `${layout.token} has ${layout.fields.length} elements, found ${value.length}`;
  for (const [index, field] of layout.fields.entries()) {
    const mismatch = findMismatch(context, field.type, value[index]);
    if (mismatch !== undefined) return `in ${layout.token}[${index}]: ${mismatch}`;
  }
  return undefined;
}

function findRecordMismatch(context: TypeContext, value: object, layout: DumpedLayout): string | undefined {
  if (types.isProxy(value) || typeof value === "function" || Array.isArray(value)) return `${layout.token} is an ordinary object`;
  const keys = Reflect.ownKeys(value);
  let matched = 0;
  for (const field of layout.fields) {
    if (keys[matched] === field.name) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, keys[matched])!;
      if (!Object.hasOwn(descriptor, "value")) return `${layout.token}.${field.name} is an accessor`;
      const mismatch = findMismatch(context, field.type, descriptor.value);
      if (mismatch !== undefined) return `in ${layout.token}.${field.name}: ${mismatch}`;
      matched++;
    } else if (!field.isOptional) {
      return `${layout.token} needs ${field.name} at position ${matched}`;
    }
  }
  return matched === keys.length ? undefined : `${layout.token} has no ${String(keys[matched])} at position ${matched}`;
}

function isNewPlainData(context: TypeContext, value: unknown, depth: number): boolean {
  if (!isObject(value)) return true;
  if (depth > maxPlainDataDepth || types.isProxy(value) || context.run.log.originOf(value) !== undefined) return false;
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every(key => {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key)!;
    return Object.hasOwn(descriptor, "value") && isNewPlainData(context, descriptor.value, depth + 1);
  });
}

function findPartMismatch(context: TypeContext, part: DumpedTypePart, value: unknown): string | undefined {
  const { realm, run } = context;
  switch (part.part) {
    case "Operand":
      return includesSame(operandValuesOf(run, part.operand), value) ? undefined : "it is not that operand";
    case "Slot":
      return isInSlot(context, value, part.operand, part.slot) ? undefined : `it is not in ${part.slot}`;
    case "IteratedValues":
      return isIteratedFrom(context, value, part.operand, part.isSettled) ? undefined : "the operand does not yield it";
    case "CallbackResult": {
      const isLogged = operandValuesOf(run, part.operand).every(callee => typeof callee !== "function" || run.log.isProxy(callee));
      return !isLogged || includesSame(resultsOfCalls(run, part.operand), value) ? undefined : "the callback did not return it";
    }
    case "Prototype":
      return operandValuesOf(run, part.operand).some(operand => prototypeBefore(run, operand) === value)
        ? undefined
        : "it is not the prototype of that operand";
    default:
      break;
  }
  if (!isObject(value)) return "a primitive";
  switch (part.part) {
    case "Instance":
      return findInstanceMismatch(context, value, part);
    case "InstanceOfReceiverClass": {
      const expected = instanceClassOfReceiver(realm, run.receiver);
      return realm.classesOf(value)[0] === expected ? undefined : `${describeClass(realm, value)} is no ${expected}`;
    }
    case "TypedArrayOfReceiverElementType": {
      const expected = typedArrayClassOf(realm, run.receiver);
      return typedArrayClassOf(realm, value) === expected ? undefined : `${describeClass(realm, value)} is no ${expected}`;
    }
    case "Layout": {
      const layout = realm.table.layouts.get(part.layout)!;
      return layout.isTuple ? findTupleMismatch(context, value, layout) : findRecordMismatch(context, value, layout);
    }
    case "Builtin": {
      const builtin = realm.valueOf(part.builtin);
      const isOnePerModule = realm.table.entries.get(part.builtin)?.scope === "Module";
      return builtin === undefined || isOnePerModule || builtin === value ? undefined : `it is not ${part.builtin}`;
    }
    default:
      return unreachable(part);
  }
}

export function findPrimitiveMismatch(type: DumpedType, value: unknown): string | undefined {
  switch (typeof value) {
    case "undefined":
      return type.primitives.includes("Undefined") ? undefined : "undefined";
    case "boolean":
      return type.primitives.includes("Boolean") ? undefined : "a boolean";
    case "symbol":
      return type.primitives.includes("Symbol") ? undefined : "a symbol";
    case "bigint":
      return type.primitives.includes("BigInt") ? undefined : "a bigint";
    case "string":
      if (type.primitives.includes("String") || type.stringLiterals.includes(value)) return undefined;
      return type.stringLiterals.length > 0 ? `the string ${JSON.stringify(value)}` : "a string";
    case "number": {
      if (!type.primitives.includes("Number")) return "a number";
      if (type.integers === null) return undefined;
      const { minimum, maximum } = type.integers;
      const isInRange = Number.isInteger(value) && !Object.is(value, -0) && value >= minimum && value <= maximum;
      return isInRange ? undefined : `${Object.is(value, -0) ? "-0" : value} is outside the integers ${minimum} to ${maximum}`;
    }
    case "object":
      return type.primitives.includes("Null") ? undefined : "null";
    case "function":
      return "a function";
  }
}

// Undefined where the value lies in the type, else what the value is.
export function findMismatch(context: TypeContext, type: DumpedType, value: unknown): string | undefined {
  if (type.isAnything) return undefined;
  let mismatch: string | undefined;
  if (isObject(value)) {
    if (type.hasAnyObject || (type.hasAnyFunction && typeof value === "function")) return undefined;
    if (context.visited.has(value)) return undefined;
    if (type.hasPlainData && isNewPlainData(context, value, 0)) return undefined;
    mismatch = describeClass(context.realm, value);
  } else {
    mismatch = findPrimitiveMismatch(type, value);
    if (mismatch === undefined) return undefined;
  }
  if (isObject(value)) context.visited.add(value);
  try {
    for (const part of type.parts) {
      const found = findPartMismatch(context, part, value);
      if (found === undefined) return undefined;
      if (isObject(value) && part.part !== "Operand" && type.parts.length === 1) mismatch = found;
    }
  } finally {
    if (isObject(value)) context.visited.delete(value);
  }
  return mismatch;
}

export function createTypeContext(realm: Realm, run: Run): TypeContext {
  return { realm, run, visited: new Set() };
}
