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

function valuesIn(descriptor: PropertyDescriptor): unknown[] {
  return Object.hasOwn(descriptor, "value") ? [descriptor.value] : [descriptor.get, descriptor.set];
}

type Walk = { log: Log; snapshot: Snapshot; isBuiltinObject(value: object): boolean };

function visit(walk: Walk, value: unknown, reach: Reach): void {
  const { log, snapshot } = walk;
  if (!isObject(value) || snapshot.size >= maxObjects) return;
  const target = log.targetOf(value);
  if (snapshot.has(target) || types.isProxy(target)) return;
  const state = stateOf(log, target, reach);
  snapshot.set(target, state);
  if (reach.depth < maxDepth && !walk.isBuiltinObject(target)) {
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

function compareProperty(object: object, key: PropertyKey, before: PropertyDescriptor, after: PropertyDescriptor): Change[] {
  const changes: Change[] = [];
  const wasData = Object.hasOwn(before, "value");
  const isData = Object.hasOwn(after, "value");
  if (isData && (!wasData || !Object.is(before.value, after.value))) {
    changes.push({ kind: wasData ? "Store" : "Define", object, key, values: [after.value] });
  }
  if (!isData && (wasData || before.get !== after.get || before.set !== after.set)) {
    changes.push({ kind: "DefineAccessor", object, key, values: valuesIn(after) });
  }
  if (attributesOf(before) !== attributesOf(after)) changes.push({ kind: "Attributes", object, key });
  return changes;
}

function compareProperties(object: object, before: ObjectState, after: ObjectState): Change[] {
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
    if (!later) continue;
    changes.push(...compareProperties(object, earlier, later), ...compareInternals(object, earlier.internals, later.internals));
    if (earlier.prototype !== later.prototype) changes.push({ kind: "Prototype", object, values: [later.prototype] });
    if (earlier.isExtensible && !later.isExtensible) changes.push({ kind: "PreventExtensions", object });
  }
  return changes;
}

export function retakeSnapshot(log: Log, before: Snapshot): Snapshot {
  const after: Snapshot = new Map();
  for (const [object, reach] of before) after.set(object, stateOf(log, object, reach));
  return after;
}
