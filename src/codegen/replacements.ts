import { LoaderKeys } from "../api/schema";
import { sliceSourceCode } from "./builtin-parser";

// This is a list of globals we should access using @ notation.
// This prevents a global override attacks.
// Note that the public `Bun` global is immutable.
// undefined -> __intrinsic__undefined -> @undefined
export const globalsToPrefix = [
  "console",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "escape",
  "eval",
  "globalThis",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
  "undefined",
  "unescape",
  "AbortSignal",
  "Array",
  "ArrayBuffer",
  "Atomics",
  "BigInt",
  "BigInt64Array",
  "BigUint64Array",
  "Boolean",
  "Buffer",
  "DataView",
  "Date",
  "Error",
  "EvalError",
  "FinalizationRegistry",
  "Float32Array",
  "Float64Array",
  "Function",
  "Infinity",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "Intl",
  "JSON",
  "Loader",
  "Math",
  "Promise",
  "Proxy",
  "RangeError",
  "ReferenceError",
  "Reflect",
  "ReadableByteStreamController",
  "ReadableStream",
  "ReadableStreamBYOBReader",
  "ReadableStreamBYOBRequest",
  "ReadableStreamDefaultController",
  "ReadableStreamDefaultReader",
  "RegExp",
  "String",
  "SuppressedError",
  "Symbol",
  "SyntaxError",
  "TransformStream",
  "TransformStreamDefaultController",
  "TypeError",
  "Uint8Array",
  "URIError",
  "WeakMap",
  "WeakRef",
  "WeakSet",
  "WritableStream",
  "WritableStreamDefaultController",
  "WritableStreamDefaultWriter",
];

// This is a list of symbol we should access using @ notation.
// Transforms: Array.prototype.$$iterator -> Array.prototype.__intrinsic_$iterator -> Array.prototype.@$iterator
// to enable accessing a snapshot of the symbol property value.
// AND
// Transforms: Array.prototype[$$iterator] -> Array.prototype.__intrinsic___intrinsic_iterator -> Array.prototype.@@iterator
// to enable accessing the live symbol property value.
const symbolPropsToPrefix = Reflect.ownKeys(Symbol).filter(k => typeof Symbol[k] === "symbol") as string[];

function escapeDoubleQuotes(str: string) {
  return str.replace(/\\?"/g, '\\"');
}

function replaceDollarSignWithIntrinsic(str: string) {
  return str.replaceAll("$", "__intrinsic__");
}

function replacePercentSignWithDollar(str: string) {
  return str.replaceAll("%", "$");
}

function toReplacer(replacement: string | Replacer) {
  return typeof replacement === "function"
    ? (substring: string, ...args: string[]) => replaceDollarSignWithIntrinsic(replacement(substring, ...args))
    : replacePercentSignWithDollar(replaceDollarSignWithIntrinsic(replacement));
}

// These rules are run on the entire file, including within strings.
export const globalReplacements: ReplacementRule[] = [
  {
    // https://blog.stevenlevithan.com/archives/match-quoted-string
    from: /\bnotImplementedIssueFn\(\s*(\d+)\s*,\s*"((?:(?!")[^\n\\]|\\.)*)"\s*\)/g,
    to: (_match, issueNumber, description) =>
      replaceDollarSignWithIntrinsic(
        `() => $throwTypeError("${escapeDoubleQuotes(description)} is not implemented yet. See https://github.com/oven-sh/bun/issues/${issueNumber}")`,
      ),
  },
];
for (const replacement of globalReplacements) {
  replacement.to = toReplacer(replacement.to);
}

// This is a list of extra syntax replacements to do. Kind of like macros
// These are only run on code itself, not string contents or comments.
export const replacements: ReplacementRule[] = [
  { from: /\bnew Array\([$\w]+\)/g, to: "$newArrayWithSize($1)" },
  { from: /\bthrow new TypeError\b/g, to: "$throwTypeError" },
  { from: /\bthrow new RangeError\b/g, to: "$throwRangeError" },
  { from: /\bthrow new OutOfMemoryError\b/g, to: "$throwOutOfMemoryError" },
  { from: /\bnew TypeError\b/g, to: "$makeTypeError" },
  { from: /\bexport\s*default/g, to: "$exports =" },
  {
    from: new RegExp(`\\bextends\\s+(${globalsToPrefix.join("|")})`, "g"),
    to: "extends __no_intrinsic__%1",
  },
];
for (const replacement of replacements) {
  replacement.to = toReplacer(replacement.to);
}

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
  "notImplementedIssueFn",
];

// These are passed to --define to the bundler
const debug = process.argv[2] === "--debug=ON";
export const define: Record<string, string> = {
  IS_BUN_DEVELOPMENT: String(debug),
  $streamClosed: "1",
  $streamClosing: "2",
  $streamErrored: "3",
  $streamReadable: "4",
  $streamWaiting: "5",
  $streamWritable: "6",
  "process.arch": JSON.stringify(Bun.env.TARGET_ARCH ?? process.arch),
  "process.env.NODE_ENV": JSON.stringify(debug ? "development" : "production"),
  "process.platform": JSON.stringify(Bun.env.TARGET_PLATFORM ?? process.platform),
};

// ------------------------------ //

for (const name in enums) {
  const value = enums[name];
  if (typeof value !== "object" || value === null) {
    throw new Error(`Invalid enum object ${name} defined in ${import.meta.file}`);
  }
  const keys = Array.isArray(value) ? value : Object.keys(value).filter(k => !/^\d+$/.test(k));
  const idToLabel = `$${name}IdToLabel`;
  const labelToId = `$${name}LabelToId`;
  if (keys.length) {
    define[idToLabel] = `["${keys.join('", "')}"]`;
    define[labelToId] = `{${keys.map((k, i) => `"${k}": ${i}`).join(", ")}}`;
  } else {
    define[idToLabel] = "[]";
    define[labelToId] = "{}";
  }
}

for (const name of globalsToPrefix) {
  define[name] = `__intrinsic__${name}`;
}

for (const key in define) {
  if (key.startsWith("$")) {
    define[`__intrinsic__${key.slice(1)}`] = define[key];
    delete define[key];
  }
}

type Replacer = (substring: string, ...args: any[]) => string;
export interface ReplacementRule {
  from: RegExp;
  to: string | Replacer;
  global?: boolean;
}

/** Applies source code replacements as defined in `replacements` */
export function applyReplacements(src: string, length: number) {
  let slice = src.slice(0, length);
  // Replace symbol @@ names first.
  for (const name of symbolPropsToPrefix) {
    // First replace live symbol property references.
    slice = slice.replace(new RegExp(`.\\[\\$\\$${name}\\]`, "g"), m =>
      /[$\w]/.test(m[0]) ? `.__intrinsic____intrinsic__${name}` : `${m[0]}[__intrinsic____intrinsic__${name}]`,
    );
    // Then replace snapshot symbol property references.
    slice = slice.replaceAll(`$$${name}`, `__intrinsic__$${name}`);
  }
  slice = slice.replace(/([^\$\w])\$(\w+\b)/gm, "$1__intrinsic__$2");
  for (const replacement of replacements) {
    slice = slice.replace(replacement.from, replacement.to as Replacer);
  }
  const rest = src.slice(length);
  const match = rest.startsWith("(") ? slice.match(/__intrinsic__(assert|debug)$/) : null;
  if (match) {
    const name = match[1];
    if (name === "debug") {
      const innerSlice = sliceSourceCode(rest, true);
      return [
        `${slice.slice(0, match.index)}(IS_BUN_DEVELOPMENT?$debug_log${innerSlice.result}:void 0)`,
        innerSlice.rest,
        true,
      ];
    }
    if (name === "assert") {
      const checkSlice = sliceSourceCode(rest, true, undefined, true);
      let { rest: rest2 } = checkSlice;
      let extraArgs = "";
      if (checkSlice.result.at(-1) === ",") {
        const sliced = sliceSourceCode(`(${rest2.slice(1)}`, true, undefined, false);
        extraArgs = `, ${sliced.result.slice(1, -1)}`;
        rest2 = sliced.rest;
      }
      return [
        `${slice.slice(0, match.index)}(IS_BUN_DEVELOPMENT?$assert(${checkSlice.result.slice(1, -1)},${JSON.stringify(
          checkSlice.result.slice(1, -1).replaceAll("__intrinsic__", "$").trim(),
        )}${extraArgs}):void 0)`,
        rest2,
        true,
      ];
    }
  }
  return [slice, rest, false];
}

/** Applies source code replacements as defined in `globalReplacements` */
export function applyGlobalReplacements(src: string) {
  let result = src;
  for (const replacement of globalReplacements) {
    result = result.replace(replacement.from, replacement.to as Replacer);
  }
  return result;
}
