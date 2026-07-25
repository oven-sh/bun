// Generates src/js/primordials.d.ts from JavaScriptCore's JSCPrimordials.h so
// the $-prefixed primordial link-time constants stay in sync with the engine.
//
//   bun src/codegen/generate-primordials-dts.ts [path/to/JSCPrimordials.h]
//
// Without an argument the header is located from $BUN_WEBKIT_PATH or vendor/WebKit.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const output = join(root, "src/js/primordials.d.ts");

function findHeader(): string {
  const explicit = process.argv[2];
  const candidates = explicit
    ? [explicit]
    : [process.env.BUN_WEBKIT_PATH, join(root, "vendor/WebKit")]
        .filter((dir): dir is string => !!dir)
        .map(dir => join(dir, "Source/JavaScriptCore/runtime/JSCPrimordials.h"));
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  throw new Error(`JSCPrimordials.h not found. Tried: ${candidates.join(", ")}`);
}

// Instance/namespace type for each JSC_FOREACH_PRIMORDIAL_<Holder> table.
const holderTypes: Record<string, string> = {
  ObjectPrototype: "Object",
  ObjectConstructor: "ObjectConstructor",
  FunctionPrototype: "Function",
  ArrayPrototype: "Array<any>",
  ArrayConstructor: "ArrayConstructor",
  StringPrototype: "String",
  StringConstructor: "StringConstructor",
  RegExpPrototype: "RegExp",
  SymbolPrototype: "Symbol",
  SymbolConstructor: "SymbolConstructor",
  BigIntPrototype: "BigInt",
  BigIntConstructor: "BigIntConstructor",
  PromisePrototype: "Promise<any>",
  PromiseConstructor: "PromiseConstructor",
  IteratorPrototype: "IteratorObject<any>",
  IteratorConstructor: "typeof Iterator",
  ArrayIteratorPrototype: "ArrayIterator<any>",
  StringIteratorPrototype: "StringIterator<any>",
  MapIteratorPrototype: "MapIterator<any>",
  SetIteratorPrototype: "SetIterator<any>",
  RegExpStringIteratorPrototype: "RegExpStringIterator<any>",
  IteratorHelperPrototype: "IteratorObject<any>",
  WrapForValidIteratorPrototype: "IteratorObject<any>",
  AsyncIteratorPrototype: "AsyncIteratorObject<any>",
  WeakRefPrototype: "WeakRef<any>",
  FinalizationRegistryPrototype: "FinalizationRegistry<any>",
  GlobalFunctions: "typeof globalThis",
  BooleanPrototype: "Boolean",
  BooleanConstructor: "BooleanConstructor",
  DatePrototype: "Date",
  DateConstructor: "DateConstructor",
  ErrorPrototype: "Error",
  ErrorConstructor: "ErrorConstructor",
  MapPrototype: "Map<any, any>",
  MapConstructor: "MapConstructor",
  NumberPrototype: "Number",
  NumberConstructor: "NumberConstructor",
  SetPrototype: "Set<any>",
  SetConstructor: "SetConstructor",
  WeakMapPrototype: "WeakMap<any, any>",
  WeakMapConstructor: "WeakMapConstructor",
  WeakSetPrototype: "WeakSet<any>",
  WeakSetConstructor: "WeakSetConstructor",
  JSArrayBufferPrototype: "ArrayBuffer",
  JSArrayBufferConstructor: "ArrayBufferConstructor",
  TypedArrayPrototype: "Uint8Array",
  TypedArrayConstructor: "Uint8ArrayConstructor",
  DataViewPrototype: "DataView",
  MathObject: "Math",
  JSONObject: "JSON",
  ReflectObject: "typeof Reflect",
  AtomicsObject: "Atomics",
};

const headerPath = findHeader();
const header = readFileSync(headerPath, "utf8");

const lines: string[] = [];
let count = 0;
for (const table of header.matchAll(/#define JSC_FOREACH_PRIMORDIAL_(\w+)\(V\)((?:\s*\\?\n?\s*V\([^\n]*)*)/g)) {
  const holder = table[1];
  if (holder === "NAME" || holder === "HOLDER" || holder.endsWith("_HOLDER")) continue;
  const holderType = holderTypes[holder];
  if (!holderType) throw new Error(`No TypeScript holder type registered for JSC_FOREACH_PRIMORDIAL_${holder}`);
  for (const entry of table[2].matchAll(/V\(\s*(\w+),\s*(?:"([^"]+)"|(\w+)),\s*(\w+)\s*\)/g)) {
    const [, name, stringKey, symbolKey, kind] = entry;
    const key = stringKey !== undefined ? JSON.stringify(stringKey) : `typeof Symbol.${symbolKey}`;
    const helper = kind === "Getter" || kind === "SymbolGetter" ? "PrimordialGetter" : "PrimordialMethod";
    lines.push(`declare const $${name}: ${helper}<${holderType}, ${key}>;`);
    count++;
  }
}
if (count < 400)
  throw new Error(`Parsed only ${count} primordials from ${headerPath}; the table format may have changed`);

const body = `// GENERATED FILE — do not edit. Regenerate with: bun src/codegen/generate-primordials-dts.ts
//
// Tamper-proof references to the original ECMAScript builtins, exposed by JSC
// (JSCPrimordials.h) as link-time constants and named after Node.js's primordials.
// Prototype methods and getters take the receiver via .$call/.$apply:
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

${lines.join("\n")}
`;

writeFileSync(output, body);
console.log(`Wrote ${count} primordial declarations to ${output} (from ${headerPath})`);
