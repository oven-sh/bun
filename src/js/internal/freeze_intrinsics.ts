// Adapted from SES/Caja - Copyright (C) 2011 Google Inc.
// Copyright (C) 2018 Agoric
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// SPDX-License-Identifier: Apache-2.0
//
// Port of Node.js lib/internal/freeze_intrinsics.js. Runs from
// internal/process/pre_execution before any user code, so the bare global
// lookups below observe pristine intrinsics.

const ObjectDefineProperty = Object.defineProperty;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const ObjectGetOwnPropertyNames = Object.getOwnPropertyNames;
const ObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ReflectOwnKeys = Reflect.ownKeys;
const SymbolIterator = Symbol.iterator;
const SymbolMatchAll = Symbol.matchAll;
const TypedArray = ObjectGetPrototypeOf(Uint8Array);

export default function freezeIntrinsics(): void {
  const intrinsicPrototypes: unknown[] = [
    // 20 Fundamental Objects
    Object.prototype, // 20.1
    Function.prototype, // 20.2
    Boolean.prototype, // 20.3
    Symbol.prototype, // 20.4

    Error.prototype, // 20.5
    AggregateError.prototype,
    EvalError.prototype,
    RangeError.prototype,
    ReferenceError.prototype,
    SyntaxError.prototype,
    TypeError.prototype,
    URIError.prototype,

    // 21 Numbers and Dates
    Number.prototype, // 21.1
    BigInt.prototype, // 21.2
    Date.prototype, // 21.4

    // 22 Text Processing
    String.prototype, // 22.1
    ObjectGetPrototypeOf(String.prototype[SymbolIterator]()), // 22.1.5 StringIteratorPrototype
    RegExp.prototype, // 22.2
    ObjectGetPrototypeOf(new RegExp("e")[SymbolMatchAll]("")), // 22.2.7 RegExpStringIteratorPrototype

    // 23 Indexed Collections
    Array.prototype, // 23.1
    ObjectGetPrototypeOf(Array.prototype[SymbolIterator]()), // 23.1.5 ArrayIteratorPrototype
    TypedArray.prototype, // 23.2
    Int8Array.prototype,
    Uint8Array.prototype,
    Uint8ClampedArray.prototype,
    Int16Array.prototype,
    Uint16Array.prototype,
    Int32Array.prototype,
    Uint32Array.prototype,
    Float32Array.prototype,
    Float64Array.prototype,
    BigInt64Array.prototype,
    BigUint64Array.prototype,

    // 24 Keyed Collections
    Map.prototype, // 24.1
    ObjectGetPrototypeOf(new Map()[SymbolIterator]()), // 24.1.5 MapIteratorPrototype
    Set.prototype, // 24.2
    ObjectGetPrototypeOf(new Set()[SymbolIterator]()), // 24.2.5 SetIteratorPrototype
    WeakMap.prototype, // 24.3
    WeakSet.prototype, // 24.4

    // 25 Structured Data
    ArrayBuffer.prototype, // 25.1
    DataView.prototype, // 25.3

    // 26 Managing Memory
    WeakRef.prototype, // 26.1
    FinalizationRegistry.prototype, // 26.2

    // 27 Control Abstraction Objects
    ObjectGetPrototypeOf(ObjectGetPrototypeOf(Array.prototype[SymbolIterator]())), // 27.1.2 IteratorPrototype
    ObjectGetPrototypeOf(ObjectGetPrototypeOf(ObjectGetPrototypeOf((async function* () {})()))), // 27.1.3 AsyncIteratorPrototype
    Promise.prototype, // 27.2

    // Other APIs / Web Compatibility
    (console as { Console?: { prototype: object } }).Console?.prototype,
  ];

  const intrinsics: unknown[] = [
    // 10.2.4.1 ThrowTypeError
    ObjectGetOwnPropertyDescriptor(Function.prototype, "caller")?.get,

    // 19 The Global Object
    // 19.2 Function Properties of the Global Object
    eval,
    isFinite,
    isNaN,
    parseFloat,
    parseInt,
    decodeURI,
    decodeURIComponent,
    encodeURI,
    encodeURIComponent,

    // 20 Fundamental Objects
    Object,
    Function,
    Boolean,
    Symbol,
    Error,
    AggregateError,
    EvalError,
    RangeError,
    ReferenceError,
    SyntaxError,
    TypeError,
    URIError,

    // 21 Numbers and Dates
    Number,
    BigInt,
    Math,
    Date,

    // 22 Text Processing
    String,
    ObjectGetPrototypeOf(String.prototype[SymbolIterator]()),
    RegExp,
    ObjectGetPrototypeOf(new RegExp("e")[SymbolMatchAll]("")),

    // 23 Indexed Collections
    Array,
    ObjectGetPrototypeOf(Array.prototype[SymbolIterator]()),
    TypedArray,
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,

    // 24 Keyed Collections
    Map,
    ObjectGetPrototypeOf(new Map()[SymbolIterator]()),
    Set,
    ObjectGetPrototypeOf(new Set()[SymbolIterator]()),
    WeakMap,
    WeakSet,

    // 25 Structured Data
    ArrayBuffer,
    DataView,
    Atomics,
    JSON,

    // 26 Managing Memory
    WeakRef,
    FinalizationRegistry,

    // 27 Control Abstraction Objects
    ObjectGetPrototypeOf(ObjectGetPrototypeOf(Array.prototype[SymbolIterator]())), // IteratorPrototype
    ObjectGetPrototypeOf(ObjectGetPrototypeOf(ObjectGetPrototypeOf((async function* () {})()))), // AsyncIteratorPrototype
    Promise,
    ObjectGetPrototypeOf(function* () {}), // GeneratorFunction
    ObjectGetPrototypeOf(async function* () {}), // AsyncGeneratorFunction
    ObjectGetPrototypeOf(async function () {}), // AsyncFunction

    // 28 Reflection
    Reflect,
    Proxy,

    // B.2.1
    escape,
    unescape,

    // Other APIs / Web Compatibility
    clearImmediate,
    clearInterval,
    clearTimeout,
    setImmediate,
    setInterval,
    setTimeout,
    console,
  ];

  if (typeof SharedArrayBuffer !== "undefined") {
    intrinsicPrototypes.push(SharedArrayBuffer.prototype);
    intrinsics.push(SharedArrayBuffer);
  }
  if (typeof WebAssembly !== "undefined") {
    intrinsicPrototypes.push(
      WebAssembly.Module.prototype,
      WebAssembly.Instance.prototype,
      WebAssembly.Table.prototype,
      WebAssembly.Memory.prototype,
      WebAssembly.CompileError.prototype,
      WebAssembly.LinkError.prototype,
      WebAssembly.RuntimeError.prototype,
    );
    intrinsics.push(WebAssembly);
  }
  if (typeof Intl !== "undefined") {
    intrinsicPrototypes.push(
      Intl.Collator.prototype,
      Intl.DateTimeFormat.prototype,
      Intl.ListFormat.prototype,
      Intl.NumberFormat.prototype,
      Intl.PluralRules.prototype,
      Intl.RelativeTimeFormat.prototype,
    );
    intrinsics.push(Intl);
  }

  for (let i = 0; i < intrinsicPrototypes.length; i++) enableDerivedOverrides(intrinsicPrototypes[i]);

  const frozenSet = new WeakSet<object>();
  // Node.js's global `console` exposes `_stdout`/`_stderr` behind getters, so
  // its deep-freeze stops at the accessor functions. Bun's are own data
  // properties, which would pull the live stream instances (and through them
  // every stream prototype) into the freeze set. Seed them as already-visited
  // so traversal stops at the stream boundary like Node.js.
  const consoleObj = console as { _stdout?: object; _stderr?: object };
  if (consoleObj._stdout) frozenSet.add(consoleObj._stdout);
  if (consoleObj._stderr) frozenSet.add(consoleObj._stderr);
  for (let i = 0; i < intrinsics.length; i++) deepFreeze(intrinsics[i]);

  // 19.1 Value Properties of the Global Object
  ObjectDefineProperty(globalThis, "globalThis", {
    __proto__: null,
    configurable: false,
    writable: false,
    value: globalThis,
  } as PropertyDescriptor);

  function deepFreeze(root: unknown): void {
    const freezingSet = new Set<object>();

    function enqueue(val: unknown): void {
      if (Object(val) !== val) return;
      if (frozenSet.has(val as object) || freezingSet.has(val as object)) return;
      freezingSet.add(val as object);
    }

    function doFreeze(obj: object): void {
      ObjectFreeze(obj);
      const proto = ObjectGetPrototypeOf(obj);
      const descs = ObjectGetOwnPropertyDescriptors(obj);
      enqueue(proto);
      const keys = ReflectOwnKeys(descs);
      for (let i = 0; i < keys.length; i++) {
        const desc = descs[keys[i] as string];
        if (ObjectPrototypeHasOwnProperty.$call(desc, "value")) {
          enqueue(desc.value);
        } else {
          enqueue(desc.get);
          enqueue(desc.set);
        }
      }
    }

    enqueue(root);
    // New values added before forEach() has finished will be visited.
    freezingSet.forEach(doFreeze);
    freezingSet.forEach(frozenSet.add, frozenSet);
  }

  // ES5 specified that simple assignment to a non-existent own property must
  // fail if it would override an inherited non-writable data property. Replace
  // each configurable own data property on the listed prototypes with an
  // accessor that preserves that assignment-to-derived-object behaviour after
  // freezing.
  function enableDerivedOverride(obj: object, prop: PropertyKey, desc: PropertyDescriptor): void {
    if (!ObjectPrototypeHasOwnProperty.$call(desc, "value") || !desc.configurable) return;
    const value = desc.value;

    function getter(this: unknown) {
      return value;
    }
    (getter as { value?: unknown }).value = value;

    function setter(this: unknown, newValue: unknown) {
      if (obj === this) {
        throw new TypeError(`Cannot assign to read only property '${String(prop)}' of object '${obj}'`);
      }
      if (ObjectPrototypeHasOwnProperty.$call(this, prop)) {
        (this as Record<PropertyKey, unknown>)[prop as string] = newValue;
      } else {
        ObjectDefineProperty(this as object, prop, {
          __proto__: null,
          value: newValue,
          writable: true,
          enumerable: true,
          configurable: true,
        } as PropertyDescriptor);
      }
    }

    ObjectDefineProperty(obj, prop, {
      __proto__: null,
      get: getter,
      set: setter,
      enumerable: desc.enumerable,
      configurable: desc.configurable,
    } as PropertyDescriptor);
  }

  function enableDerivedOverrides(obj: unknown): void {
    if (!obj) return;
    const descs = ObjectGetOwnPropertyDescriptors(obj);
    if (!descs) return;
    const names = ObjectGetOwnPropertyNames(obj);
    for (let i = 0; i < names.length; i++) enableDerivedOverride(obj as object, names[i], descs[names[i]]);
    const syms = ObjectGetOwnPropertySymbols(obj);
    for (let i = 0; i < syms.length; i++)
      enableDerivedOverride(obj as object, syms[i], descs[syms[i] as unknown as string]);
  }
}
