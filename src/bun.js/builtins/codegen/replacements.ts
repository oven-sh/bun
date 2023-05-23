import { LoaderKeys } from "../../../api/schema";

// This is a list of extra syntax replacements to do. Kind of like macros
// These are only run on code itself, not string contents or comments.
export const replacements: ReplacementRule[] = [
  { from: /\bthrow new TypeError\b/g, to: "$throwTypeError" },
  { from: /\bthrow new RangeError\b/g, to: "$throwRangeError" },
  { from: /\bthrow new OutOfMemoryError\b/g, to: "$throwOutOfMemoryError" },
  { from: /\bnew TypeError\b/g, to: "$makeTypeError" },
];

// These rules are run on the entire file, including within strings.
export const globalReplacements: ReplacementRule[] = [
  {
    from: /\bnotImplementedIssue\(\s*([0-9]+)\s*,\s*((?:"[^"]*"|'[^']+'))\s*\)/g,
    to: "new TypeError(`${$2} is not implemented yet. See https://github.com/oven-sh/bun/issues/$1`)",
  },
  {
    from: /\bnotImplementedIssueFn\(\s*([0-9]+)\s*,\s*((?:"[^"]*"|'[^']+'))\s*\)/g,
    to: "() => $throwTypeError(`${$2} is not implemented yet. See https://github.com/oven-sh/bun/issues/$1`)",
  },
];

// This is a list of globals we should access using @ notation
// undefined -> __intrinsic__undefined -> @undefined
export const globalsToPrefix = [
  "AbortSignal",
  "Array",
  "ArrayBuffer",
  "Buffer",
  "Bun",
  "Infinity",
  "Loader",
  "Promise",
  "ReadableByteStreamController",
  "ReadableStream",
  "ReadableStreamBYOBReader",
  "ReadableStreamBYOBRequest",
  "ReadableStreamDefaultController",
  "ReadableStreamDefaultReader",
  "TransformStream",
  "TransformStreamDefaultController",
  "Uint8Array",
  "WritableStream",
  "WritableStreamDefaultController",
  "WritableStreamDefaultWriter",
  "isFinite",
  "isNaN",
  "undefined",
];

// These enums map to $<enum>IdToLabel and $<enum>LabelToId
// Make sure to define in ./builtins.d.ts
export const enums = {
  Loader: LoaderKeys,
  ImportKind: [
    "entry-point",
    "import-statement",
    "require-call",
    "dynamic-import",
    "require-resolve",
    "import-rule",
    "url-token",
    "internal",
  ],
};

// These identifiers have typedef but not present at runtime (converted with replacements)
// If they are present in the bundle after runtime, we warn at the user.
// TODO: implement this check.
export const warnOnIdentifiersNotPresentAtRuntime = [
  //
  "OutOfMemoryError",
  "notImplementedIssue",
  "notImplementedIssueFn",
];

export interface ReplacementRule {
  from: RegExp;
  to: string;
  global?: boolean;
}

/** Applies source code replacements as defined in `replacements` */
export function applyReplacements(src: string) {
  let result = src.replace(/\$([a-zA-Z0-9_]+)\b/gm, `__intrinsic__$1`);
  for (const replacement of replacements) {
    result = result.replace(replacement.from, replacement.to.replaceAll("$", "__intrinsic__"));
  }
  return result;
}

/** Applies source code replacements as defined in `globalReplacements` */
export function applyGlobalReplacements(src: string) {
  let result = src;
  for (const replacement of globalReplacements) {
    result = result.replace(replacement.from, replacement.to.replaceAll("$", "__intrinsic__"));
  }
  return result;
}
