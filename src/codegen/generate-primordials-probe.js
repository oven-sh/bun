// Probe half of src/codegen/generate-primordials.ts. Runs inside a pristine target
// bun binary and reports, for every member Node's primordials construction would
// produce from this engine's intrinsics, where the pristine value comes from.
// Output: JSON { entries: [...], missing: [...] } on stdout.
//
// This mirrors lib/internal/per_context/primordials.js's enumeration exactly; only
// what is recorded differs (provenance instead of values).

const varargsMethods = [
  "ArrayOf",
  "ArrayPrototypePush",
  "ArrayPrototypeUnshift",
  "MathHypot",
  "MathMax",
  "MathMin",
  "StringFromCharCode",
  "StringFromCodePoint",
  "StringPrototypeConcat",
  "TypedArrayOf",
];

const entries = [];
const missing = [];

function keyDescription(key) {
  // Well-known symbols are named by their identifier ("iterator", "toStringTag").
  return typeof key === "symbol" ? key.description.replace(/^Symbol\./, "") : key;
}

// Same renaming Node applies: symbol keys become SymbolX, string keys get their
// first character upper-cased.
function getNewKey(key) {
  return typeof key === "symbol"
    ? `Symbol${key.description[7].toUpperCase()}${key.description.slice(8)}`
    : `${key[0].toUpperCase()}${key.slice(1)}`;
}

function record(entry) {
  entries.push(entry);
}

function copyOwnProperties(object, holder, prefix, mode) {
  if (object === undefined || object === null) {
    missing.push(holder);
    return;
  }
  for (const key of Reflect.ownKeys(object)) {
    const newKey = getNewKey(key);
    const desc = Reflect.getOwnPropertyDescriptor(object, key);
    const symbolKey = typeof key === "symbol";
    // Original attributes, so a descriptor can be rebuilt pristinely by the generator.
    const attributes = { enumerable: desc.enumerable, configurable: desc.configurable, writable: desc.writable };
    if ("get" in desc) {
      record({
        name: `${prefix}Get${newKey}`,
        holder,
        key: keyDescription(key),
        symbolKey,
        kind: "Getter",
        attributes,
      });
      if (desc.set)
        record({
          name: `${prefix}Set${newKey}`,
          holder,
          key: keyDescription(key),
          symbolKey,
          kind: "Setter",
          attributes,
        });
      continue;
    }
    const name = `${prefix}${newKey}`;
    const value = desc.value;
    const type = value === null ? "null" : typeof value;
    if (type === "function") {
      // mode: "uncurried" (prototype methods), "static", or "bound" (receiver-bound statics).
      record({ name, holder, key: keyDescription(key), symbolKey, kind: "Method", call: mode, attributes });
    } else if (type === "object" || type === "symbol") {
      record({ name, holder, key: keyDescription(key), symbolKey, kind: "Value", valueType: type, attributes });
    } else {
      // Spec constants (constructor length/name, Math/Number constants, BYTES_PER_ELEMENT,
      // Symbol.toStringTag strings): inlined as literals rather than read at runtime.
      const literal = type === "string" ? JSON.stringify(value) : String(value);
      record({ name, holder, key: keyDescription(key), symbolKey, kind: "Literal", literal, attributes });
    }
    if (varargsMethods.includes(name)) record({ name: `${name}Apply`, kind: "ApplyVariant", base: name });
  }
}

const G = globalThis;

// Configurable value properties of the global object.
record({ name: "Proxy", kind: "HolderSelf", holder: "ProxyObject" });
// The `globalThis` user code observes is the global's own globalThis property
// (an accessor to the global-this object), not the global object itself.
record({
  name: "globalThis",
  holder: "GlobalObject",
  key: "globalThis",
  symbolKey: false,
  kind: "Value",
  valueType: "object",
});
for (const name of ["decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent", "escape", "eval", "unescape"])
  record({ name, holder: "GlobalObject", key: name, symbolKey: false, kind: "Method", call: "static" });

// Namespace objects.
for (const name of ["Atomics", "JSON", "Math", "Reflect"]) copyOwnProperties(G[name], `${name}Object`, name, "static");
copyOwnProperties(G.Proxy, "ProxyObject", "Proxy", "static");

// Intrinsic constructors: the constructor itself, its own properties, and its prototype's.
for (const name of [
  "AggregateError",
  "Array",
  "ArrayBuffer",
  "BigInt",
  "BigInt64Array",
  "BigUint64Array",
  "Boolean",
  "DataView",
  "Date",
  "Error",
  "EvalError",
  "FinalizationRegistry",
  "Float32Array",
  "Float64Array",
  "Function",
  "Int16Array",
  "Int32Array",
  "Int8Array",
  "Iterator",
  "Map",
  "Number",
  "Object",
  "RangeError",
  "ReferenceError",
  "RegExp",
  "Set",
  "String",
  "Symbol",
  "SyntaxError",
  "TypeError",
  "URIError",
  "Uint16Array",
  "Uint32Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "WeakMap",
  "WeakRef",
  "WeakSet",
]) {
  record({ name, kind: "HolderSelf", holder: `${name}Constructor` });
  copyOwnProperties(G[name], `${name}Constructor`, name, "static");
  copyOwnProperties(G[name]?.prototype, `${name}Prototype`, `${name}Prototype`, "uncurried");
}

// Constructors whose statics need the constructor as receiver (Promise.all etc.).
for (const name of ["Promise"]) {
  record({ name, kind: "HolderSelf", holder: `${name}Constructor` });
  copyOwnProperties(G[name], `${name}Constructor`, name, "bound");
  copyOwnProperties(G[name].prototype, `${name}Prototype`, `${name}Prototype`, "uncurried");
}

// %TypedArray%: not on the global object; statics need a concrete constructor receiver.
{
  const TypedArray = Reflect.getPrototypeOf(Uint8Array);
  record({ name: "TypedArray", kind: "HolderSelf", holder: "TypedArrayConstructor" });
  copyOwnProperties(TypedArray, "TypedArrayConstructor", "TypedArray", "uncurried");
  copyOwnProperties(TypedArray.prototype, "TypedArrayPrototype", "TypedArrayPrototype", "uncurried");
}

// Abstract prototypes with no exposed constructor.
for (const [name, object] of [
  ["ArrayIteratorPrototype", Reflect.getPrototypeOf([][Symbol.iterator]())],
  ["AsyncFunctionPrototype", Reflect.getPrototypeOf(async function () {})],
  ["AsyncGeneratorFunctionPrototype", Reflect.getPrototypeOf(async function* () {})],
  ["AsyncIteratorPrototype", Reflect.getPrototypeOf(Reflect.getPrototypeOf(async function* () {}).prototype)],
  ["GeneratorFunctionPrototype", Reflect.getPrototypeOf(function* () {})],
  ["IteratorHelperPrototype", Reflect.getPrototypeOf([].values().drop(0))],
  ["MapIteratorPrototype", Reflect.getPrototypeOf(new Map()[Symbol.iterator]())],
  ["RegExpStringIteratorPrototype", Reflect.getPrototypeOf(RegExp.prototype[Symbol.matchAll].call(/a/g, "a"))],
  ["SetIteratorPrototype", Reflect.getPrototypeOf(new Set()[Symbol.iterator]())],
  ["StringIteratorPrototype", Reflect.getPrototypeOf(""[Symbol.iterator]())],
  [
    "WrapForValidIteratorPrototype",
    Reflect.getPrototypeOf(
      Iterator.from({
        next() {
          return { done: true };
        },
      }),
    ),
  ],
]) {
  record({ name, kind: "HolderSelf", holder: name });
  copyOwnProperties(object, name, name, "uncurried");
}

// Bun.write is native: the probe must not depend on the module it generates.
await Bun.write(Bun.stdout, JSON.stringify({ entries, missing }));
