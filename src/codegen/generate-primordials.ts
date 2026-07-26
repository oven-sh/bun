// Generates the primordials artifacts from a live probe of the engine:
//
//   1. <WebKit>/Source/JavaScriptCore/runtime/JSCPrimordialsTable.h — the per-holder
//      entry tables, holder lists, and holder-accessor macro consumed by JSCPrimordials.h/.cpp.
//   2. src/js/internal/primordials.js — Node's primordials object, built from the
//      $Name link-time constants (member set and semantics identical to Node's
//      lib/internal/per_context/primordials.js).
//   3. src/js/primordials.d.ts — typedefs for the $Name link-time constants.
//
// Usage:
//   bun src/codegen/generate-primordials.ts --bun=<pristine bun binary> [--webkit=<dir>]
//
// The probe (generate-primordials-probe.js) runs Node's construction algorithm inside
// the target binary and reports each member's provenance; this file only maps that
// provenance onto the engine and emits code. Rerun whenever JSC's builtin surface changes;
// test/js/bun/util/primordials.test.ts fails if the checked-in artifacts drift.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const probePath = join(import.meta.dir, "generate-primordials-probe.js");
const moduleOutput = join(root, "src/js/internal/primordials.js");
const dtsOutput = join(root, "src/js/primordials.d.ts");

// ───────────────────────────────────────────────────────────────────────────────
// Arguments
// ───────────────────────────────────────────────────────────────────────────────

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}

const bunBinary = argValue("bun") ?? process.execPath;
const webkitDir =
  argValue("webkit") ??
  [process.env.BUN_WEBKIT_PATH, join(root, "vendor/WebKit")].find(dir => dir && existsSync(join(dir, "Source")));
if (!webkitDir) throw new Error("WebKit source directory not found; pass --webkit=<dir> or set BUN_WEBKIT_PATH");
const headerOutput = join(webkitDir, "Source/JavaScriptCore/runtime/JSCPrimordialsTable.h");

// ───────────────────────────────────────────────────────────────────────────────
// Probe
// ───────────────────────────────────────────────────────────────────────────────

interface Entry {
  name: string;
  holder?: string;
  key?: string;
  symbolKey?: boolean;
  kind: "Method" | "Getter" | "Setter" | "Value" | "HolderSelf" | "Literal" | "ApplyVariant";
  call?: "uncurried" | "static" | "bound";
  valueType?: string;
  literal?: string;
  base?: string;
  attributes?: { enumerable: boolean; configurable: boolean; writable?: boolean };
}

const probe = spawnSync(bunBinary, [probePath], { env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1" } });
if (probe.status !== 0) throw new Error(`probe failed:\n${probe.stderr}`);
const probeResult: { entries: Entry[]; missing: string[] } = JSON.parse(probe.stdout.toString());
if (probeResult.missing.length) throw new Error(`probe: missing intrinsics: ${probeResult.missing.join(", ")}`);

// ───────────────────────────────────────────────────────────────────────────────
// Holder → engine mapping
// ───────────────────────────────────────────────────────────────────────────────
//
// accessor: expression valid inside a JSGlobalObject member (returns JSObject*).
// eager:    exists once JSGlobalObject::init() returns (snapshotted at the end of init);
//           lazy holders instead snapshot inside their creation hook.
// type:     TypeScript type of the holder object, for the generated .d.ts.

interface Holder {
  accessor: string;
  eager: boolean;
  type: string;
}

const nativeError = (member: string, part: "prototype" | "constructor"): Holder => ({
  accessor: `m_${member}Structure.${part}(this)`,
  eager: false,
  type: "ErrorConstructor",
});
const typedArrayHolder = (type: string, part: "prototype" | "constructor", tsName: string): Holder => ({
  accessor: part === "prototype" ? `typedArrayPrototype(Type${type})` : `typedArrayConstructor(Type${type})`,
  eager: false,
  type: part === "prototype" ? tsName : `${tsName}Constructor`,
});
const namespaceHolder = (className: string, jsName: string, creator: string, type: string): Holder => ({
  accessor: `pristineNamespaceObject<${className}>(vm, this, Identifier::fromString(vm, "${jsName}"_s), ${creator})`,
  eager: false,
  type,
});

const holders: Record<string, Holder> = {
  GlobalObject: { accessor: "this", eager: true, type: "typeof globalThis" },
  ObjectPrototype: { accessor: "objectPrototype()", eager: true, type: "Object" },
  ObjectConstructor: { accessor: "m_objectConstructor.get()", eager: true, type: "ObjectConstructor" },
  FunctionPrototype: { accessor: "functionPrototype()", eager: true, type: "Function" },
  FunctionConstructor: { accessor: "functionConstructor()", eager: true, type: "FunctionConstructor" },
  ArrayPrototype: { accessor: "arrayPrototype()", eager: true, type: "Array<any>" },
  ArrayConstructor: { accessor: "m_arrayConstructor.get()", eager: true, type: "ArrayConstructor" },
  StringPrototype: { accessor: "stringPrototype()", eager: true, type: "String" },
  StringConstructor: { accessor: "stringConstructor()", eager: true, type: "StringConstructor" },
  RegExpPrototype: { accessor: "regExpPrototype()", eager: true, type: "RegExp" },
  RegExpConstructor: { accessor: "regExpConstructor()", eager: true, type: "RegExpConstructor" },
  SymbolPrototype: { accessor: "symbolPrototype()", eager: true, type: "Symbol" },
  SymbolConstructor: { accessor: "symbolConstructor()", eager: true, type: "SymbolConstructor" },
  BigIntPrototype: { accessor: "bigIntPrototype()", eager: true, type: "BigInt" },
  BigIntConstructor: { accessor: "bigIntConstructor()", eager: true, type: "BigIntConstructor" },
  PromisePrototype: { accessor: "promisePrototype()", eager: true, type: "Promise<any>" },
  PromiseConstructor: { accessor: "promiseConstructor()", eager: true, type: "PromiseConstructor" },
  IteratorPrototype: { accessor: "iteratorPrototype()", eager: true, type: "IteratorObject<any>" },
  IteratorConstructor: { accessor: "iteratorConstructor()", eager: true, type: "typeof Iterator" },
  ArrayIteratorPrototype: { accessor: "arrayIteratorPrototype()", eager: true, type: "ArrayIterator<any>" },
  StringIteratorPrototype: { accessor: "m_stringIteratorPrototype.get()", eager: true, type: "StringIterator<any>" },
  MapIteratorPrototype: { accessor: "mapIteratorPrototype()", eager: true, type: "MapIterator<any>" },
  SetIteratorPrototype: { accessor: "setIteratorPrototype()", eager: true, type: "SetIterator<any>" },
  RegExpStringIteratorPrototype: {
    accessor: "m_regExpStringIteratorStructure.get()->storedPrototypeObject()",
    eager: true,
    type: "RegExpStringIterator<any>",
  },
  IteratorHelperPrototype: { accessor: "iteratorHelperPrototype()", eager: true, type: "IteratorObject<any>" },
  WrapForValidIteratorPrototype: {
    accessor: "m_wrapForValidIteratorStructure.get()->storedPrototypeObject()",
    eager: true,
    type: "IteratorObject<any>",
  },
  AsyncIteratorPrototype: { accessor: "asyncIteratorPrototype()", eager: true, type: "AsyncIteratorObject<any>" },
  GeneratorFunctionPrototype: { accessor: "generatorFunctionPrototype()", eager: true, type: "GeneratorFunction" },
  AsyncFunctionPrototype: { accessor: "asyncFunctionPrototype()", eager: true, type: "Function" },
  AsyncGeneratorFunctionPrototype: {
    accessor: "asyncGeneratorFunctionPrototype()",
    eager: true,
    type: "AsyncGeneratorFunction",
  },
  WeakRefPrototype: { accessor: "m_weakObjectRefPrototype.get()", eager: true, type: "WeakRef<any>" },
  WeakRefConstructor: { accessor: "weakObjectRefConstructor()", eager: true, type: "WeakRefConstructor" },
  FinalizationRegistryPrototype: {
    accessor: "m_finalizationRegistryPrototype.get()",
    eager: true,
    type: "FinalizationRegistry<any>",
  },
  FinalizationRegistryConstructor: {
    accessor: "finalizationRegistryConstructor()",
    eager: true,
    type: "FinalizationRegistryConstructor",
  },

  // Lazy holders — snapshotted in their creation hooks.
  BooleanPrototype: { accessor: "booleanPrototype()", eager: false, type: "Boolean" },
  BooleanConstructor: {
    accessor: "booleanObjectConstructor()",
    eager: false,
    type: "BooleanConstructor",
  },
  NumberPrototype: { accessor: "numberPrototype()", eager: false, type: "Number" },
  NumberConstructor: {
    accessor: "numberObjectConstructor()",
    eager: false,
    type: "NumberConstructor",
  },
  DatePrototype: { accessor: "datePrototype()", eager: false, type: "Date" },
  DateConstructor: { accessor: "dateConstructor()", eager: false, type: "DateConstructor" },
  ErrorPrototype: { accessor: "errorPrototype()", eager: false, type: "Error" },
  ErrorConstructor: { accessor: "errorConstructor()", eager: false, type: "ErrorConstructor" },
  MapPrototype: { accessor: "mapPrototype()", eager: false, type: "Map<any, any>" },
  MapConstructor: { accessor: "mapConstructor()", eager: false, type: "MapConstructor" },
  SetPrototype: { accessor: "jsSetPrototype()", eager: false, type: "Set<any>" },
  SetConstructor: { accessor: "setConstructor()", eager: false, type: "SetConstructor" },
  WeakMapPrototype: {
    accessor: "m_weakMapStructure.prototype(this)",
    eager: false,
    type: "WeakMap<any, any>",
  },
  WeakMapConstructor: { accessor: "weakMapConstructor()", eager: false, type: "WeakMapConstructor" },
  WeakSetPrototype: {
    accessor: "m_weakSetStructure.prototype(this)",
    eager: false,
    type: "WeakSet<any>",
  },
  WeakSetConstructor: { accessor: "weakSetConstructor()", eager: false, type: "WeakSetConstructor" },
  ArrayBufferPrototype: {
    accessor: "arrayBufferPrototype(ArrayBufferSharingMode::Default)",
    eager: false,
    type: "ArrayBuffer",
  },
  ArrayBufferConstructor: {
    accessor: "arrayBufferConstructor(ArrayBufferSharingMode::Default)",
    eager: false,
    type: "ArrayBufferConstructor",
  },
  AggregateErrorPrototype: nativeError("aggregateError", "prototype"),
  AggregateErrorConstructor: nativeError("aggregateError", "constructor"),
  EvalErrorPrototype: nativeError("evalError", "prototype"),
  EvalErrorConstructor: nativeError("evalError", "constructor"),
  RangeErrorPrototype: nativeError("rangeError", "prototype"),
  RangeErrorConstructor: nativeError("rangeError", "constructor"),
  ReferenceErrorPrototype: nativeError("referenceError", "prototype"),
  ReferenceErrorConstructor: nativeError("referenceError", "constructor"),
  SyntaxErrorPrototype: nativeError("syntaxError", "prototype"),
  SyntaxErrorConstructor: nativeError("syntaxError", "constructor"),
  TypeErrorPrototype: nativeError("typeError", "prototype"),
  TypeErrorConstructor: nativeError("typeError", "constructor"),
  URIErrorPrototype: nativeError("URIError", "prototype"),
  URIErrorConstructor: nativeError("URIError", "constructor"),
  TypedArrayPrototype: {
    accessor: "m_typedArrayProto.get(this)",
    eager: false,
    type: "Uint8Array",
  },
  TypedArrayConstructor: {
    accessor: "m_typedArraySuperConstructor.get(this)",
    eager: false,
    type: "Uint8ArrayConstructor",
  },
  DataViewPrototype: typedArrayHolder("DataView", "prototype", "DataView"),
  DataViewConstructor: typedArrayHolder("DataView", "constructor", "DataView"),
  Int8ArrayPrototype: typedArrayHolder("Int8", "prototype", "Int8Array"),
  Int8ArrayConstructor: typedArrayHolder("Int8", "constructor", "Int8Array"),
  Uint8ArrayPrototype: typedArrayHolder("Uint8", "prototype", "Uint8Array"),
  Uint8ArrayConstructor: typedArrayHolder("Uint8", "constructor", "Uint8Array"),
  Uint8ClampedArrayPrototype: typedArrayHolder("Uint8Clamped", "prototype", "Uint8ClampedArray"),
  Uint8ClampedArrayConstructor: typedArrayHolder("Uint8Clamped", "constructor", "Uint8ClampedArray"),
  Int16ArrayPrototype: typedArrayHolder("Int16", "prototype", "Int16Array"),
  Int16ArrayConstructor: typedArrayHolder("Int16", "constructor", "Int16Array"),
  Uint16ArrayPrototype: typedArrayHolder("Uint16", "prototype", "Uint16Array"),
  Uint16ArrayConstructor: typedArrayHolder("Uint16", "constructor", "Uint16Array"),
  Int32ArrayPrototype: typedArrayHolder("Int32", "prototype", "Int32Array"),
  Int32ArrayConstructor: typedArrayHolder("Int32", "constructor", "Int32Array"),
  Uint32ArrayPrototype: typedArrayHolder("Uint32", "prototype", "Uint32Array"),
  Uint32ArrayConstructor: typedArrayHolder("Uint32", "constructor", "Uint32Array"),
  Float16ArrayPrototype: typedArrayHolder("Float16", "prototype", "Float16Array"),
  Float16ArrayConstructor: typedArrayHolder("Float16", "constructor", "Float16Array"),
  Float32ArrayPrototype: typedArrayHolder("Float32", "prototype", "Float32Array"),
  Float32ArrayConstructor: typedArrayHolder("Float32", "constructor", "Float32Array"),
  Float64ArrayPrototype: typedArrayHolder("Float64", "prototype", "Float64Array"),
  Float64ArrayConstructor: typedArrayHolder("Float64", "constructor", "Float64Array"),
  BigInt64ArrayPrototype: typedArrayHolder("BigInt64", "prototype", "BigInt64Array"),
  BigInt64ArrayConstructor: typedArrayHolder("BigInt64", "constructor", "BigInt64Array"),
  BigUint64ArrayPrototype: typedArrayHolder("BigUint64", "prototype", "BigUint64Array"),
  BigUint64ArrayConstructor: typedArrayHolder("BigUint64", "constructor", "BigUint64Array"),
  MathObject: namespaceHolder("MathObject", "Math", "createMathProperty", "Math"),
  JSONObject: namespaceHolder("JSONObject", "JSON", "createJSONProperty", "JSON"),
  ReflectObject: namespaceHolder("ReflectObject", "Reflect", "createReflectProperty", "typeof Reflect"),
  AtomicsObject: namespaceHolder("AtomicsObject", "Atomics", "createAtomicsProperty", "Atomics"),
  ProxyObject: namespaceHolder("ProxyConstructor", "Proxy", "createProxyProperty", "ProxyConstructor"),
};

// Lazy builtin types created by JSGlobalObject.cpp's CREATE_PROTOTYPE_FOR_LAZY_TYPE
// macro, keyed by that macro's capitalName.
const lazyTypeMacroNames: Record<string, string> = {
  Boolean: "Boolean",
  Date: "Date",
  Error: "Error",
  Map: "Map",
  Number: "Number",
  Set: "Set",
  WeakMap: "WeakMap",
  WeakSet: "WeakSet",
  JSArrayBuffer: "ArrayBuffer",
};

// ───────────────────────────────────────────────────────────────────────────────
// Normalize the probe entries
// ───────────────────────────────────────────────────────────────────────────────

const entries = probeResult.entries;
for (const entry of entries) {
  if (entry.kind !== "Value" || entry.valueType !== "object" || !entry.holder || !entry.key) continue;
  // A constructor's `prototype` / a prototype's own object property that is itself a
  // holder: reference the holder object directly rather than reading the property.
  const target =
    entry.key === "prototype" && entry.holder.endsWith("Constructor")
      ? entry.holder.replace(/Constructor$/, "Prototype")
      : entry.name in holders
        ? entry.name
        : null;
  if (target && target in holders) {
    entry.kind = "HolderSelf";
    entry.holder = target;
    delete entry.key;
  }
}
for (const entry of entries)
  if (entry.holder && !(entry.holder in holders))
    throw new Error(`No engine mapping for holder ${entry.holder} (needed by ${entry.name})`);

// A member named like an existing link-time constant (Array, Promise, ...) is
// that same object, so it reuses the constant. A name that is only a private
// identifier (Number, ArrayBuffer) keeps a slot under a distinct engine name.
function scanNames(file: string, pattern: RegExp): Set<string> {
  return new Set(
    [...readFileSync(join(webkitDir, "Source/JavaScriptCore", file), "utf8").matchAll(pattern)].map(m => m[1]),
  );
}
const linkTimeConstantNames = scanNames("bytecode/LinkTimeConstant.h", /^\s*v\((\w+),/gm);
const privateIdentifierNames = scanNames("builtins/BuiltinNames.h", /^\s*macro\((\w+)\)/gm);

const reused = entries.filter(
  e => linkTimeConstantNames.has(e.name) && e.kind !== "Literal" && e.kind !== "ApplyVariant",
);
if (reused.length) console.log(`reusing existing link-time constants for: ${reused.map(e => e.name).join(", ")}`);
for (const entry of reused)
  if (entry.kind !== "HolderSelf")
    throw new Error(`link-time-constant name collision on non-constructor member: ${entry.name}`);

// Engine identifiers can't contain the punctuation Node keeps in the legacy
// RegExp static names ("RegExpGet$&", ...), and can't collide with an existing
// private identifier; those get a distinct $Name while the module keeps Node's key.
const dollarSuffixes: Record<string, string> = {
  "&": "Ampersand",
  "'": "Apostrophe",
  "`": "Backtick",
  "+": "Plus",
  "_": "Underscore",
  "*": "Asterisk",
};
const engineName = (name: string) => {
  const sanitized = name.replace(/\$(.)/g, (_, ch: string) => `Dollar${dollarSuffixes[ch] ?? ch}`);
  return privateIdentifierNames.has(sanitized) && !linkTimeConstantNames.has(sanitized)
    ? `${sanitized}Primordial`
    : sanitized;
};
const jsKey = (name: string) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name));

const engineEntries = entries.filter(
  e => e.kind !== "Literal" && e.kind !== "ApplyVariant" && !linkTimeConstantNames.has(e.name),
);
const engineKinds = {
  Method: "Method",
  Getter: "Getter",
  Setter: "Setter",
  Value: "Value",
  HolderSelf: "Self",
} as const;

// ───────────────────────────────────────────────────────────────────────────────
// 1. JSCPrimordialsTable.h
// ───────────────────────────────────────────────────────────────────────────────

const holderOrder = Object.keys(holders);
const entriesByHolder = new Map<string, Entry[]>(holderOrder.map(h => [h, []]));
for (const entry of engineEntries) entriesByHolder.get(entry.holder!)!.push(entry);

function tableLine(entry: Entry, widths: [number, number]): string {
  const key = entry.kind === "HolderSelf" ? "SELF" : entry.symbolKey ? `SYM(${entry.key})` : `PROP("${entry.key}")`;
  return `    V(${(engineName(entry.name) + ",").padEnd(widths[0] + 1)} ${(key + ",").padEnd(widths[1] + 1)} ${engineKinds[entry.kind as keyof typeof engineKinds]}) \\`;
}

let header = `// GENERATED FILE — do not edit. Regenerate with:
//   bun src/codegen/generate-primordials.ts --bun=<bun> --webkit=<WebKit>
// (src/codegen in oven-sh/bun). Derived from Node.js's primordials construction
// applied to this engine's intrinsics; see JSCPrimordials.h for the mechanism.

#pragma once

#if USE(BUN_JSC_ADDITIONS)

namespace JSC {

// V(name, key, kind): key is PROP("string"), SYM(wellKnownSymbolName), or SELF
// (the holder object itself); kind is Method | Getter | Setter | Value | Self.
`;

for (const holder of holderOrder) {
  const list = entriesByHolder.get(holder)!;
  const widths: [number, number] = [
    Math.max(0, ...list.map(e => engineName(e.name).length)),
    Math.max(0, ...list.map(e => (e.kind === "HolderSelf" ? 4 : e.symbolKey ? e.key!.length + 5 : e.key!.length + 8))),
  ];
  header += `\n#define JSC_FOREACH_PRIMORDIAL_${holder}(V) \\\n`;
  header += list.map(entry => tableLine(entry, widths)).join("\n") + (list.length ? "\n" : "\n\n");
}

const eagerHolders = holderOrder.filter(h => holders[h].eager);
const lazyHolders = holderOrder.filter(h => !holders[h].eager);
header += `
// ---------------------------------------------------------------------------
// Holders, eager (exist after JSGlobalObject::init(), snapshotted there) then
// lazy (snapshotted where they are created).
// ---------------------------------------------------------------------------

#define JSC_FOREACH_PRIMORDIAL_EAGER_HOLDER(H) \\
${eagerHolders.map(h => `    H(${h}) \\`).join("\n")}

#define JSC_FOREACH_PRIMORDIAL_LAZY_HOLDER(H) \\
${lazyHolders.map(h => `    H(${h}) \\`).join("\n")}

#define JSC_FOREACH_PRIMORDIAL_HOLDER(H) \\
    JSC_FOREACH_PRIMORDIAL_EAGER_HOLDER(H) \\
    JSC_FOREACH_PRIMORDIAL_LAZY_HOLDER(H) \\

#define JSC_FOREACH_PRIMORDIAL_NAME(V) \\
${holderOrder.map(h => `    JSC_FOREACH_PRIMORDIAL_${h}(V) \\`).join("\n")}

// V(Holder, expression yielding the holder JSObject* inside a JSGlobalObject member).
#define JSC_FOREACH_PRIMORDIAL_HOLDER_ACCESSOR(V) \\
${holderOrder.map(h => `    V(${h}, ${holders[h].accessor}) \\`).join("\n")}

// Names CREATE_PROTOTYPE_FOR_LAZY_TYPE's hook uses for its capitalName parameter.
${Object.entries(lazyTypeMacroNames)
  .map(
    ([macroName, holder]) =>
      `#define JSC_PRIMORDIAL_LAZY_TYPE_PROTOTYPE_HOLDER_${macroName} PrimordialHolder::${holder}Prototype\n#define JSC_PRIMORDIAL_LAZY_TYPE_CONSTRUCTOR_HOLDER_${macroName} PrimordialHolder::${holder}Constructor`,
  )
  .join("\n")}

} // namespace JSC

#endif // USE(BUN_JSC_ADDITIONS)
`;

writeFileSync(headerOutput, header);
console.log(`wrote ${engineEntries.length} entries across ${holderOrder.length} holders to ${headerOutput}`);

// ───────────────────────────────────────────────────────────────────────────────
// 2. src/js/internal/primordials.js
// ───────────────────────────────────────────────────────────────────────────────

// The engine constant behind a manifest name; a few Node names differ from ours.
const constant = (entry: Entry) => `$${engineName(entry.name)}`;

const propertyLines: string[] = [];
for (const entry of entries) {
  switch (entry.kind) {
    case "Literal":
      propertyLines.push(`  ${jsKey(entry.name)}: ${entry.literal},`);
      break;
    case "HolderSelf":
    case "Value":
      propertyLines.push(`  ${jsKey(entry.name)}: ${constant(entry)},`);
      break;
    case "Getter":
    case "Setter":
      propertyLines.push(`  ${jsKey(entry.name)}: uncurryThis(${constant(entry)}),`);
      break;
    case "Method":
      if (entry.call === "uncurried") propertyLines.push(`  ${jsKey(entry.name)}: uncurryThis(${constant(entry)}),`);
      else if (entry.call === "bound")
        propertyLines.push(
          `  ${entry.name}: $FunctionPrototypeBind.$call(${constant(entry)}, $${entry.holder!.replace(/Constructor$/, "")}),`,
        );
      else propertyLines.push(`  ${jsKey(entry.name)}: ${constant(entry)},`);
      break;
    case "ApplyVariant": {
      const base = entries.find(e => e.name === entry.base)!;
      // Statics/bound get the receiver pre-bound so the variant takes (argsArray),
      // as in Node; prototype methods take (thisArg, argsArray). Namespace (Math)
      // statics never read `this`, so their bound receiver is undefined.
      const boundReceiver =
        base.call === "static" && base.holder!.endsWith("Constructor")
          ? `$${base.holder!.replace(/Constructor$/, "")}`
          : base.call === "static"
            ? "undefined"
            : null;
      propertyLines.push(
        boundReceiver !== null
          ? `  ${jsKey(entry.name)}: applyBind($${engineName(base.name)}, ${boundReceiver}),`
          : `  ${jsKey(entry.name)}: applyBind($${engineName(base.name)}),`,
      );
      break;
    }
  }
}

// Pristine own-property descriptor records for the Safe* bases: the epilogue's
// Safe classes are built from these ($Name values, original attributes) rather
// than by reading the live prototypes, so a load after user code stays pristine.
const safeBases = ["Map", "Set", "WeakMap", "WeakSet", "FinalizationRegistry", "WeakRef", "Promise"];
const pristineDescriptorLines: string[] = [];
for (const base of safeBases) {
  for (const part of ["Prototype", "Constructor"]) {
    const holder = `${base}${part}`;
    const byKey = new Map<string, { data?: Entry; get?: Entry; set?: Entry }>();
    for (const entry of entries) {
      if (entry.holder !== holder || entry.kind === "HolderSelf" || entry.kind === "ApplyVariant") continue;
      const key = `${entry.symbolKey ? "symbol:" : ""}${entry.key}`;
      const slot = byKey.get(key) ?? {};
      if (entry.kind === "Getter") slot.get = entry;
      else if (entry.kind === "Setter") slot.set = entry;
      else slot.data = entry;
      byKey.set(key, slot);
    }
    const descriptorLines: string[] = [];
    for (const [key, slot] of byKey) {
      const anyEntry = (slot.data ?? slot.get ?? slot.set)!;
      const property =
        slot.data?.symbolKey || slot.get?.symbolKey
          ? `[$${engineName(`Symbol${anyEntry.key![0].toUpperCase()}${anyEntry.key!.slice(1)}`)}]`
          : jsKey(anyEntry.key!);
      const { enumerable, configurable, writable } = anyEntry.attributes!;
      const parts: string[] = ["__proto__: null"];
      if (slot.data) {
        parts.push(`value: ${slot.data.kind === "Literal" ? slot.data.literal : constant(slot.data)}`);
        parts.push(`writable: ${writable}`);
      } else {
        if (slot.get) parts.push(`get: ${constant(slot.get)}`);
        if (slot.set) parts.push(`set: ${constant(slot.set)}`);
      }
      parts.push(`enumerable: ${enumerable}`, `configurable: ${configurable}`);
      descriptorLines.push(`  ${property}: { ${parts.join(", ")} },`);
    }
    pristineDescriptorLines.push(`pristineDescriptors.${holder} = {`, "  __proto__: null,", ...descriptorLines, "};");
  }
}

const moduleHeader = readFileSync(join(import.meta.dir, "primordials-module-prologue.js"), "utf8");
const module = `${moduleHeader}
const primordials = {
  __proto__: null,
${propertyLines.join("\n")}
};

// Pristine descriptors of the Safe* bases' original properties (see epilogue).
const pristineDescriptors = { __proto__: null };
${pristineDescriptorLines.join("\n")}

${readFileSync(join(import.meta.dir, "primordials-module-epilogue.js"), "utf8")}
export default primordials;
`;
// Every $Name the module's code references must resolve at parse time: to one of our
// primordial entries or an existing engine constant. Fail generation otherwise.
const declaredConstants = new Set([...engineEntries.map(e => engineName(e.name)), ...linkTimeConstantNames]);
const codeOnly = module.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"/g, "");
// (?<![\w.$]): skip `.$call`/`.$apply` member intrinsics and `$` inside identifiers.
const unknownReferences = [
  ...new Set([...codeOnly.matchAll(/(?<![\w.$])\$([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1])),
].filter(name => !declaredConstants.has(name));
if (unknownReferences.length)
  throw new Error(`generated module references undefined constants: ${unknownReferences.join(", ")}`);

writeFileSync(moduleOutput, module);
console.log(`wrote ${entries.length} members to ${moduleOutput}`);

// ───────────────────────────────────────────────────────────────────────────────
// 3. src/js/primordials.d.ts
// ───────────────────────────────────────────────────────────────────────────────

const dtsLines: string[] = [];
for (const entry of engineEntries) {
  const type = holders[entry.holder!].type;
  const key = entry.symbolKey ? `typeof Symbol.${entry.key}` : JSON.stringify(entry.key);
  switch (entry.kind) {
    case "HolderSelf":
      dtsLines.push(`declare const $${engineName(entry.name)}: ${type};`);
      break;
    case "Value":
      dtsLines.push(`declare const $${engineName(entry.name)}: PrimordialValue<${type}, ${key}>;`);
      break;
    case "Getter":
      dtsLines.push(`declare const $${engineName(entry.name)}: PrimordialGetter<${type}, ${key}>;`);
      break;
    case "Setter":
      dtsLines.push(`declare const $${engineName(entry.name)}: PrimordialSetter<${type}, ${key}>;`);
      break;
    case "Method":
      dtsLines.push(`declare const $${engineName(entry.name)}: PrimordialMethod<${type}, ${key}>;`);
      break;
  }
}

const dts = `// GENERATED FILE — do not edit. Regenerate with:
//   bun src/codegen/generate-primordials.ts --bun=<bun> --webkit=<WebKit>
// oxlint-disable typescript/no-wrapper-object-types -- wrapper types model real prototype receivers
//
// Tamper-proof references to the original ECMAScript builtins, exposed by JSC
// (JSCPrimordials.h) as link-time constants and named after Node.js's primordials.
// Prototype methods, getters, and setters take the receiver via .$call/.$apply:
//
//   $ArrayPrototypePush.$call(array, value);
//   $MapPrototypeGetSize.$call(map);
//   $ObjectDefineProperty(target, key, descriptor);

type PrimordialMethod<Holder, Key extends PropertyKey> = Holder extends Record<Key, infer Method>
  ? Method extends (...args: infer Args) => infer Return
    ? (this: Holder, ...args: Args) => Return
    : Function
  : Function;
type PrimordialGetter<Holder, Key extends PropertyKey> = Holder extends Record<Key, infer Value>
  ? (this: Holder) => Value
  : Function;
type PrimordialSetter<Holder, Key extends PropertyKey> = Holder extends Record<Key, infer Value>
  ? (this: Holder, value: Value) => void
  : Function;
type PrimordialValue<Holder, Key extends PropertyKey> = Holder extends Record<Key, infer Value> ? Value : unknown;

${dtsLines.join("\n")}
`;
writeFileSync(dtsOutput, dts);
console.log(`wrote ${dtsLines.length} declarations to ${dtsOutput}`);
