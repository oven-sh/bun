// The types that native code declares for a value which it makes itself, and the C++ that holds the value to one.

export type DeclaredAlternative =
  | "string"
  | "number"
  | "int32"
  | "bigint"
  | "boolean"
  | "undefined"
  | "null"
  | "object" /* any object, functions too */
  | "Promise"
  | "this" /* the receiver itself */
  | { instance: string /* a class of a `.bind.ts` file, or one of `nativeInstances` */ };

/** What `b.any.returning` takes as a word. */
export function parseDeclaredAlternative(word: string): DeclaredAlternative {
  switch (word) {
    case "string":
    case "number":
    case "int32":
    case "bigint":
    case "boolean":
    case "undefined":
    case "null":
    case "object":
    case "Promise":
    case "this":
      return word;
  }
  if (!/^[A-Z][A-Za-z0-9]*(?:(?<=\d)_\d+)*$/.test(word)) throw new Error(`'${word}' is not a declared type`);
  return { instance: word };
}

/** A union of those words, written with `|`. */
export function parseDeclaredType(text: string): DeclaredAlternative[] {
  const words = text.split("|").map(word => word.trim());
  if (new Set(words).size !== words.length) throw new Error(`'${text}' is not a declared type`);
  try {
    return words.map(parseDeclaredAlternative);
  } catch {
    throw new Error(`'${text}' is not a declared type`);
  }
}

/** As TypeScript spells it. */
export function typeScriptOf(words: readonly string[]): string {
  const spell = (word: string) => {
    const alternative = parseDeclaredAlternative(word);
    if (typeof alternative === "object") return alternative.instance === "Array" ? "unknown[]" : alternative.instance;
    return alternative === "int32" ? "number" : alternative === "Promise" ? "Promise<unknown>" : alternative;
  };
  return words.map(spell).join(" | ");
}

const hasCellType = (cellType: string) => (value: string) =>
  `Bun::DeclaredTypes::hasCellType(${value}, JSC::${cellType})`;
const inherits = (cppClass: string) => (value: string) => `${value}.inherits<${cppClass}>()`;

// Classes that no `.bind.ts` file defines and that a declared type may name.
export const nativeInstances: Record<string, { test: (value: string) => string; header?: string }> = {
  AbortSignal: { test: inherits("WebCore::JSAbortSignal"), header: "JSAbortSignal.h" },
  Array: { test: hasCellType("ArrayType") },
  ArrayBuffer: { test: value => `Bun::DeclaredTypes::isUnsharedArrayBuffer(${value})` },
  Buffer: { test: value => `Bun::DeclaredTypes::isBuffer(${value})` },
  Date: { test: hasCellType("JSDateType") },
  Error: { test: hasCellType("ErrorInstanceType") },
  Headers: { test: inherits("WebCore::JSFetchHeaders"), header: "JSFetchHeaders.h" },
  Promise: { test: hasCellType("JSPromiseType") },
  ReadableStream: { test: inherits("WebCore::JSReadableStream"), header: "streams/JSReadableStream.h" },
  Uint8Array: { test: hasCellType("Uint8ArrayType") },
  URL: { test: inherits("WebCore::JSDOMURL"), header: "JSDOMURL.h" },
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
  /** The C++ class of a class that a `.bind.ts` file defines. */
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
