import { types } from "node:util";
import type { Log } from "./log";
import { isIndexKey } from "./table-description";

// What an object holds beside its own properties, as far as JavaScript can read it without running code of the object.
export type Internal = {
  slot: "Element" | "Key" | "Value" | "Reason" | "State";
  name: string | undefined;
  value: unknown;
};

function getterOf(holder: object, key: string): () => any {
  return Reflect.getOwnPropertyDescriptor(holder, key)!.get!;
}

const mapForEach = Map.prototype.forEach;
const setForEach = Set.prototype.forEach;
const weakMapHas = WeakMap.prototype.has;
const weakMapGet = WeakMap.prototype.get;
const weakSetHas = WeakSet.prototype.has;
const weakRefDeref = WeakRef.prototype.deref;
const dateGetTime = Date.prototype.getTime;
const dataViewBuffer = getterOf(DataView.prototype, "buffer");
const typedArrayPrototype = Reflect.getPrototypeOf(Uint8Array.prototype)!;
const typedArrayLength = getterOf(typedArrayPrototype, "length");
const typedArrayBuffer = getterOf(typedArrayPrototype, "buffer");
const typedArrayByteOffset = getterOf(typedArrayPrototype, "byteOffset");
const arrayBufferByteLength = getterOf(ArrayBuffer.prototype, "byteLength");
const sharedArrayBufferByteLength = getterOf(SharedArrayBuffer.prototype, "byteLength");

export function typedArrayLengthOf(value: NodeJS.TypedArray): number {
  return Reflect.apply(typedArrayLength, value, []);
}

function isWeakRef(value: object): value is WeakRef<object> {
  try {
    Reflect.apply(weakRefDeref, value, []);
    return true;
  } catch {
    return false;
  }
}

function bytesOf(buffer: ArrayBufferLike): string {
  try {
    return Buffer.from(buffer).toString("hex");
  } catch {
    return "";
  }
}

function state(name: string, value: unknown): Internal {
  return { slot: "State", name, value };
}

function collectCollection(value: object, log: Log, internals: Internal[]): void {
  const addEntry = (key: unknown, entryValue: unknown) => {
    internals.push({ slot: "Key", name: undefined, value: key }, { slot: "Value", name: undefined, value: entryValue });
  };
  const addElement = (element: unknown) => internals.push({ slot: "Element", name: undefined, value: element });
  if (types.isMap(value)) {
    Reflect.apply(mapForEach, value, [(entryValue: unknown, key: unknown) => addEntry(key, entryValue)]);
  } else if (types.isSet(value)) {
    Reflect.apply(setForEach, value, [addElement]);
  } else if (types.isWeakMap(value)) {
    for (const key of log.tracked) {
      if (Reflect.apply(weakMapHas, value, [key])) addEntry(key, Reflect.apply(weakMapGet, value, [key]));
    }
  } else if (types.isWeakSet(value)) {
    for (const member of log.tracked) if (Reflect.apply(weakSetHas, value, [member])) addElement(member);
  } else if (isWeakRef(value)) {
    internals.push(state("target", Reflect.apply(weakRefDeref, value, [])));
  }
}

function collectState(value: object, internals: Internal[]): void {
  if (types.isPromise(value)) {
    const status = Bun.peek.status(value);
    internals.push(state("status", status));
    if (status === "fulfilled") internals.push({ slot: "Value", name: undefined, value: Bun.peek(value) });
    if (status === "rejected") internals.push({ slot: "Reason", name: undefined, value: Bun.peek(value) });
  } else if (types.isDate(value)) {
    internals.push(state("time", Reflect.apply(dateGetTime, value, [])));
  } else if (types.isArrayBuffer(value)) {
    internals.push(state("byteLength", Reflect.apply(arrayBufferByteLength, value, [])), state("bytes", bytesOf(value)));
  } else if (types.isSharedArrayBuffer(value)) {
    internals.push(
      state("byteLength", Reflect.apply(sharedArrayBufferByteLength, value, [])),
      state("bytes", bytesOf(value)),
    );
  } else if (types.isDataView(value)) {
    const buffer = Reflect.apply(dataViewBuffer, value, []);
    internals.push(state("buffer", buffer), state("bytes", bytesOf(buffer)));
  } else if (types.isTypedArray(value)) {
    const buffer = Reflect.apply(typedArrayBuffer, value, []);
    internals.push(
      state("buffer", buffer),
      state("length", typedArrayLengthOf(value)),
      state("byteOffset", Reflect.apply(typedArrayByteOffset, value, [])),
      state("bytes", bytesOf(buffer)),
    );
  }
}

export function internalsOf(value: object, log: Log): Internal[] {
  if (types.isProxy(value)) return [];
  const internals: Internal[] = [];
  collectCollection(value, log, internals);
  collectState(value, internals);
  return internals;
}

export function hasIndexedElements(value: object): boolean {
  return Array.isArray(value) || types.isTypedArray(value) || types.isArgumentsObject(value);
}

export function isElementKey(value: object, key: PropertyKey): boolean {
  return hasIndexedElements(value) && isIndexKey(key);
}
