// The C++ that holds a value which leaves native code to the type that its member declares (parseDeclaredType in
// class-definitions.ts). Whoever writes it into a file includes DeclaredTypeChecks.h and the header of each class it names.
import { parseDeclaredType, type DeclaredAlternative } from "./class-definitions.ts";

const hasCellType = (cellType: string) => (value: string) =>
  `Bun::DeclaredTypes::hasCellType(${value}, JSC::${cellType})`;
const inherits = (cppClass: string) => (value: string) => `${value}.inherits<${cppClass}>()`;

// Classes that no `.classes.ts` file defines and that a declared type may name. `test` is the test by which the table of
// built-ins (src/codegen/builtins) tells the instances of the class, or a narrower one. `rustType` is there for a class that
// src/jsc/proven_return.rs can prove.
export const nativeInstances: Record<string, { test: (value: string) => string; rustType?: string }> = {
  AbortSignal: { test: inherits("WebCore::JSAbortSignal"), rustType: "bun_jsc::AbortSignal" },
  Array: { test: hasCellType("ArrayType") },
  ArrayBuffer: { test: value => `Bun::DeclaredTypes::isUnsharedArrayBuffer(${value})` },
  Buffer: { test: value => `Bun::DeclaredTypes::isBuffer(${value})` },
  Date: { test: hasCellType("JSDateType") },
  Error: { test: hasCellType("ErrorInstanceType") },
  Headers: { test: inherits("WebCore::JSFetchHeaders"), rustType: "bun_jsc::FetchHeaders" },
  Promise: { test: hasCellType("JSPromiseType") },
  ReadableStream: { test: inherits("WebCore::JSReadableStream"), rustType: "crate::webcore::ReadableStream" },
  Uint8Array: { test: hasCellType("Uint8ArrayType") },
  URL: { test: inherits("WebCore::JSDOMURL") },
};

const primitiveTests = {
  string: "isString",
  number: "isNumber",
  int32: "isInt32",
  bigint: "isBigInt",
  boolean: "isBoolean",
  undefined: "isUndefined",
  null: "isNull",
  object: "isObject",
};

export interface CheckedValue {
  className: string;
  member: string;
  /** The declared type, as it is written. */
  type: string;
  /** C++ expressions of type JSValue. */
  value: string;
  receiver: string;
  /** The empty value stands for a pending exception, or for a cached value that is reset. */
  mayBeEmpty: boolean;
  /** The C++ class of a class that a `.classes.ts` file defines. */
  cppClassOfGeneratedClass?: (name: string) => string | undefined;
}

function testOfAlternative(alternative: DeclaredAlternative, checked: CheckedValue): string {
  const { value, receiver } = checked;
  if (alternative === "this") return `${value} == ${receiver}`;
  if (alternative === "Promise") return nativeInstances.Promise.test(value);
  if (typeof alternative === "string") return `${value}.${primitiveTests[alternative]}()`;
  const { instance } = alternative;
  const generated = checked.cppClassOfGeneratedClass?.(instance);
  if (generated !== undefined) return inherits(generated)(value);
  const native = nativeInstances[instance];
  if (!native) {
    throw new Error(
      `${checked.className}.${checked.member}: no test is known for instances of ${instance}: add it to nativeInstances in src/codegen/declared-type-checks.ts`,
    );
  }
  return native.test(value);
}

/** A statement that ends the process, and names the member, where the value lies outside the type. `vm` is in scope. */
export function checkOfDeclaredType(checked: CheckedValue): string {
  const { className, member, type, value, mayBeEmpty } = checked;
  const tests = parseDeclaredType(type).map(alternative => testOfAlternative(alternative, checked));
  const passes = mayBeEmpty
    ? [`${value}.isEmpty()`, ...tests].join(" || ")
    : `!${value}.isEmpty() && (${tests.join(" || ")})`;
  return `if (!(${passes})) [[unlikely]]
        Bun::DeclaredTypes::panicOnValueOutsideDeclaredType(vm, ${JSON.stringify(className)}, ${JSON.stringify(member)}, ${JSON.stringify(type)});`;
}
