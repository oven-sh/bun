import { types } from "node:util";
import type { Log } from "./log";
import { internalsOf, type Internal } from "./references";
import { isObject } from "./table-description";

export type ObjectState = {
  keys: PropertyKey[];
  descriptors: Map<PropertyKey, PropertyDescriptor>;
  prototype: object | null;
  isExtensible: boolean;
  internals: Internal[];
  // The first root that reaches the object, over how many references, and whether only over a prototype link.
  root: number;
  depth: number;
  isOnPrototypeChain: boolean;
};
export type Snapshot = Map<object, ObjectState>;
export type Change =
  | { kind: "Define" | "Store" | "DefineAccessor"; object: object; key: PropertyKey; values: unknown[] }
  | { kind: "Delete" | "Attributes"; object: object; key: PropertyKey }
  | { kind: "Reorder" | "PreventExtensions"; object: object }
  | { kind: "Prototype"; object: object; values: unknown[] }
  | { kind: "Internal"; object: object; slot: Internal["slot"]; name: string | undefined; values: unknown[] };

const maxObjects = 400;
const maxDepth = 4;

type Reach = Pick<ObjectState, "root" | "depth" | "isOnPrototypeChain">;

// A built-in object is the same one in every call, and hardly any call changes one. How each looked when it was last looked at is kept, a
// call is taken to leave them as they are, and findChangedBuiltinObjects() says afterwards whether that was so.
const builtinStates = new Map<object, ObjectState>();
const builtinObjectsInCalls = new Set<object>();
let looksAtBuiltinObjectsInEveryCall = false;

/** Runs `action` with every built-in object looked at before and after each call, which says which call changed one. */
export async function lookingAtBuiltinObjectsInEveryCall<T>(action: () => Promise<T>): Promise<T> {
  looksAtBuiltinObjectsInEveryCall = true;
  try {
    return await action();
  } finally {
    looksAtBuiltinObjectsInEveryCall = false;
  }
}

function findChangesIn(log: Log, objects: Iterable<object>): Change[] {
  const before: Snapshot = new Map();
  for (const object of objects) before.set(object, builtinStates.get(object)!);
  return compareSnapshots(before, retakeSnapshot(log, before, true));
}

/** What has changed in the built-in objects that the operands of the calls since the last question reach. */
export function findChangedBuiltinObjects(log: Log): Change[] {
  const changes = findChangesIn(log, builtinObjectsInCalls);
  builtinObjectsInCalls.clear();
  return changes;
}

/** Makes the objects of the changes what they were, as far as a program can, so that the calls can be made once more. */
export function takeBack(changes: readonly Change[]): void {
  for (const object of new Set(changes.map(change => change.object))) {
    const { descriptors, prototype } = builtinStates.get(object)!;
    for (const key of Reflect.ownKeys(object)) if (!descriptors.has(key)) Reflect.deleteProperty(object, key);
    for (const [key, descriptor] of descriptors) Reflect.defineProperty(object, key, descriptor);
    Reflect.setPrototypeOf(object, prototype);
  }
}

/** Whether the objects of the changes are changed again. However they are now is how they count as made from here on. */
export function haveChangedAgain(log: Log, changes: readonly Change[]): boolean {
  const objects = new Set(changes.map(change => change.object));
  const hasChanges = findChangesIn(log, objects).length > 0;
  for (const object of objects) builtinStates.delete(object);
  builtinObjectsInCalls.clear();
  return hasChanges;
}

function stateOf(log: Log, target: object, { root, depth, isOnPrototypeChain }: Reach): ObjectState {
  const keys = Reflect.ownKeys(target);
  const descriptors = new Map<PropertyKey, PropertyDescriptor>();
  for (const key of keys) {
    const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
    if (descriptor) descriptors.set(key, descriptor);
  }
  return {
    keys,
    descriptors,
    prototype: Reflect.getPrototypeOf(target),
    isExtensible: Reflect.isExtensible(target),
    internals: internalsOf(target, log),
    root,
    depth,
    isOnPrototypeChain,
  };
}

function builtinStateOf(log: Log, target: object, reach: Reach): ObjectState {
  let state = builtinStates.get(target);
  if (!state) builtinStates.set(target, (state = stateOf(log, target, reach)));
  builtinObjectsInCalls.add(target);
  return { ...state, ...reach };
}

function valuesIn(descriptor: PropertyDescriptor): unknown[] {
  return Object.hasOwn(descriptor, "value") ? [descriptor.value] : [descriptor.get, descriptor.set];
}

type Walk = { log: Log; snapshot: Snapshot; isBuiltinObject(value: object): boolean };

function visit(walk: Walk, value: unknown, reach: Reach): void {
  const { log, snapshot } = walk;
  if (!isObject(value) || snapshot.size >= maxObjects) return;
  const target = log.targetOf(value);
  if (snapshot.has(target) || types.isProxy(target)) return;
  const isBuiltinObject = walk.isBuiltinObject(target);
  const state = isBuiltinObject && !looksAtBuiltinObjectsInEveryCall ? builtinStateOf(log, target, reach) : stateOf(log, target, reach);
  snapshot.set(target, state);
  if (reach.depth < maxDepth && !isBuiltinObject) {
    const held: Reach = { ...reach, depth: reach.depth + 1 };
    for (const descriptor of state.descriptors.values()) {
      for (const heldValue of valuesIn(descriptor)) visit(walk, heldValue, held);
    }
    for (const { value: heldValue } of state.internals) visit(walk, heldValue, held);
  }
  // The chain is followed to its end: a built-in that writes to a prototype writes to what every instance sees.
  visit(walk, state.prototype, { ...reach, isOnPrototypeChain: true });
}

export function takeSnapshot(
  log: Log,
  roots: readonly unknown[],
  isBuiltinObject: (value: object) => boolean,
): Snapshot {
  const walk: Walk = { log, snapshot: new Map(), isBuiltinObject };
  roots.forEach((value, root) => visit(walk, value, { root, depth: 0, isOnPrototypeChain: false }));
  return walk.snapshot;
}

function attributesOf({ writable, enumerable, configurable }: PropertyDescriptor): string {
  return `${writable} ${enumerable} ${configurable}`;
}

// Some data properties of the host make their value at each look: PerformanceObserver.supportedEntryTypes is another array each time.
function makesItsValueAtEachLook(object: object, key: PropertyKey, { value }: PropertyDescriptor): boolean {
  const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
  return descriptor !== undefined && Object.hasOwn(descriptor, "value") && !Object.is(descriptor.value, value);
}

function compareProperty(object: object, key: PropertyKey, before: PropertyDescriptor, after: PropertyDescriptor): Change[] {
  const changes: Change[] = [];
  const wasData = Object.hasOwn(before, "value");
  const isData = Object.hasOwn(after, "value");
  const isStored = wasData && !Object.is(before.value, after.value) && !makesItsValueAtEachLook(object, key, after);
  if (isData && (!wasData || isStored)) {
    changes.push({ kind: wasData ? "Store" : "Define", object, key, values: [after.value] });
  }
  if (!isData && (wasData || before.get !== after.get || before.set !== after.set)) {
    changes.push({ kind: "DefineAccessor", object, key, values: valuesIn(after) });
  }
  if (attributesOf(before) !== attributesOf(after)) changes.push({ kind: "Attributes", object, key });
  return changes;
}

function isSameDescriptor(before: PropertyDescriptor, after: PropertyDescriptor | undefined): boolean {
  return (
    after !== undefined &&
    Object.is(before.value, after.value) &&
    before.get === after.get &&
    before.set === after.set &&
    before.writable === after.writable &&
    before.enumerable === after.enumerable &&
    before.configurable === after.configurable
  );
}

function hasSameProperties(before: ObjectState, after: ObjectState): boolean {
  const { keys } = before;
  if (keys.length !== after.keys.length) return false;
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    if (key !== after.keys[index] || !isSameDescriptor(before.descriptors.get(key)!, after.descriptors.get(key))) return false;
  }
  return true;
}

const noChanges: Change[] = [];

function compareProperties(object: object, before: ObjectState, after: ObjectState): Change[] {
  if (hasSameProperties(before, after)) return noChanges;
  const changes: Change[] = [];
  for (const [key, descriptor] of after.descriptors) {
    const earlier = before.descriptors.get(key);
    if (earlier) changes.push(...compareProperty(object, key, earlier, descriptor));
    else if (Object.hasOwn(descriptor, "value")) changes.push({ kind: "Define", object, key, values: [descriptor.value] });
    else changes.push({ kind: "DefineAccessor", object, key, values: valuesIn(descriptor) });
  }
  for (const key of before.keys) if (!after.descriptors.has(key)) changes.push({ kind: "Delete", object, key });
  const kept = before.keys.filter(key => after.descriptors.has(key));
  const keptAfter = after.keys.filter(key => before.descriptors.has(key));
  if (kept.some((key, index) => key !== keptAfter[index])) changes.push({ kind: "Reorder", object });
  return changes;
}

function compareInternals(object: object, before: Internal[], after: Internal[]): Change[] {
  if (before.length === 0 && after.length === 0) return noChanges;
  const changes: Change[] = [];
  const groups = new Set(after.concat(before).map(({ slot, name }) => `${slot} ${name ?? ""}`));
  for (const group of groups) {
    const inGroup = ({ slot, name }: Internal) => `${slot} ${name ?? ""}` === group;
    const earlier = before.filter(inGroup).map(({ value }) => value);
    const later = after.filter(inGroup);
    const isSame = earlier.length === later.length && later.every(({ value }, index) => Object.is(value, earlier[index]));
    if (isSame) continue;
    const { slot, name } = later[0] ?? before.find(inGroup)!;
    const values = later.map(({ value }) => value).filter(value => !earlier.some(other => Object.is(other, value)));
    changes.push({ kind: "Internal", object, slot, name, values });
  }
  return changes;
}

export function compareSnapshots(before: Snapshot, after: Snapshot): Change[] {
  const changes: Change[] = [];
  for (const [object, earlier] of before) {
    const later = after.get(object);
    if (!later || later === earlier) continue;
    for (const change of compareProperties(object, earlier, later)) changes.push(change);
    for (const change of compareInternals(object, earlier.internals, later.internals)) changes.push(change);
    if (earlier.prototype !== later.prototype) changes.push({ kind: "Prototype", object, values: [later.prototype] });
    if (earlier.isExtensible && !later.isExtensible) changes.push({ kind: "PreventExtensions", object });
  }
  return changes;
}

export function retakeSnapshot(log: Log, before: Snapshot, looksAtBuiltinObjects = looksAtBuiltinObjectsInEveryCall): Snapshot {
  const after: Snapshot = new Map();
  for (const [object, state] of before) {
    after.set(object, !looksAtBuiltinObjects && builtinStates.has(object) ? state : stateOf(log, object, state));
  }
  return after;
}
