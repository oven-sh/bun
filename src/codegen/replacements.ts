import NodeErrors from "../jsc/bindings/ErrorCode.ts";
import jsclasses from "./../jsc/bindings/js_classes";
import { sliceSourceCode } from "./builtin-parser";
import { registerNativeCall } from "./generate-js2native";

// This is a list of extra syntax replacements to do. Kind of like macros
// These are only run on code itself, not string contents or comments.
export const replacements: ReplacementRule[] = [
  { from: /\bthrow new TypeError\b/g, to: "$throwTypeError" },
  { from: /\bthrow new RangeError\b/g, to: "$throwRangeError" },
  { from: /\bthrow new OutOfMemoryError\b/g, to: "$throwOutOfMemoryError" },
  { from: /\bnew TypeError\b/g, to: "$makeTypeError" },
  { from: /\bexport\s*default/g, to: "$exports =" },
];

/**
 * `$<name>(` calls that expand to a call with a numeric id prepended to the
 * arguments: `$ERR_FOO(` → `$makeErrorWithCode(<n>, ` for every error code in
 * ErrorCode.ts and `$inheritsBlob(` → `$inherits(<id>, ` for js_classes.ts.
 * Keyed by name (after the `$` → `__intrinsic__` rewrite) and applied with one
 * regex, `intrinsicCall` below. These used to be ~370 entries of
 * `replacements`, and running every one of them over each of the ~120k code
 * chunks bundle-modules slices was ~90% of that codegen step's time.
 *
 * Values are inserted verbatim, so they are spelled with `__intrinsic__`, which
 * is what the `$` in the `to:` strings above expands to.
 */
const intrinsicCallReplacements = new Map<string, string>();

/** First definition of a name wins, as it did when each name was its own rule. */
function defineIntrinsicCall(name: string, to: string): void {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`intrinsic call name must be an identifier: ${name}`);
  if (!intrinsicCallReplacements.has(name)) intrinsicCallReplacements.set(name, to);
}

let error_i = 0;
for (let i = 0; i < NodeErrors.length; i++) {
  const [code, _constructor, _name, ...other_constructors] = NodeErrors[i];
  defineIntrinsicCall(code, `__intrinsic__makeErrorWithCode(${error_i}, `);
  error_i += 1;
  for (const con of other_constructors) {
    if (con == null) continue;
    defineIntrinsicCall(`${code}_${con.name}`, `__intrinsic__makeErrorWithCode(${error_i}, `);
    error_i += 1;
  }
}

for (let id = 0; id < jsclasses.length; id++) {
  defineIntrinsicCall(`inherits${jsclasses[id][0]}`, `__intrinsic__inherits(${id}, `);
}

/**
 * Matches what each of the former per-name rules matched (`\b__intrinsic__<name>\(`):
 * the name is a maximal identifier run, so a match corresponds to exactly one
 * entry of the map or, when the name is not in it, to no former rule at all.
 */
const intrinsicCall = /\b__intrinsic__([A-Za-z0-9_]+)\(/g;

// These rules are run on the entire file, including within strings.
export const globalReplacements: ReplacementRule[] = [
  {
    from: /\bnotImplementedIssue\(\s*([0-9]+)\s*,\s*((?:"[^"]*"|'[^']+'))\s*\)/g,
    toRaw: "__intrinsic__makeTypeError(`${$2} is not implemented yet. See https://github.com/oven-sh/bun/issues/$1`)",
  },
  {
    from: /\bnotImplementedIssueFn\(\s*([0-9]+)\s*,\s*((?:"[^"]*"|'[^']+'))\s*\)/g,
    toRaw:
      "() => void __intrinsic__throwTypeError(`${$2} is not implemented yet. See https://github.com/oven-sh/bun/issues/$1`)",
  },
];

// This is a list of globals we should access using @ notation
// This prevents a global override attacks.
// Note that the public `Bun` global is immutable.
// undefined -> __intrinsic__undefined -> @undefined
export const globalsToPrefix = [
  "AbortSignal",
  "Array",
  "ArrayBuffer",
  "Buffer",
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
  "String",
  "Buffer",
  "RegExp",
  "WritableStream",
  "WritableStreamDefaultController",
  "WritableStreamDefaultWriter",
  "isFinite",
  "undefined",
];

replacements.push({
  from: new RegExp(`\\bextends\\s+(${globalsToPrefix.join("|")})`, "g"),
  to: "extends __no_intrinsic__%1",
});

// These enums map to $<enum>IdToLabel and $<enum>LabelToId (ids start at 1)
// Make sure to define in ./builtins.d.ts
export const enums = {
  // Ids are the `bun_options_types::schema::api::Loader` discriminants
  // (JSBundler passes those numbers to BundlerPlugin.ts).
  Loader: [
    "jsx",
    "js",
    "ts",
    "tsx",
    "css",
    "file",
    "json",
    "jsonc",
    "toml",
    "wasm",
    "napi",
    "base64",
    "dataurl",
    "text",
    "bunsh",
    "sqlite",
    "sqlite_embedded",
    "html",
    "yaml",
    "json5",
    "md",
    "xml",
  ],
  ImportKind: [
    "entry-point-run",
    "entry-point-build",
    "import-statement",
    "require-call",
    "dynamic-import",
    "require-resolve",
    "import-rule",
    "url-token",
    "internal",
  ],
};

// These are passed to --define to the bundler
const debug = process.argv[2] === "--debug=ON";
export const define: Record<string, string> = {
  "process.env.NODE_ENV": JSON.stringify(debug ? "development" : "production"),
  "IS_BUN_DEVELOPMENT": String(debug),

  $streamClosed: "1",
  $streamClosing: "2",
  $streamErrored: "3",
  $streamReadable: "4",
  $streamWaiting: "5",
  $streamWritable: "6",

  "process.platform": JSON.stringify(Bun.env.TARGET_PLATFORM ?? process.platform),
  "process.arch": JSON.stringify(Bun.env.TARGET_ARCH ?? process.arch),
};

// ------------------------------ //

for (const [name, keys] of Object.entries(enums)) {
  define[`$${name}IdToLabel`] = "[" + keys.map(k => `"${k}"`).join(", ") + "]";
  define[`$${name}LabelToId`] = "{" + keys.map((k, i) => `"${k}": ${i + 1}`).join(", ") + "}";
}

for (const name of globalsToPrefix) {
  define[name] = "__intrinsic__" + name;
}

for (const key in define) {
  if (key.startsWith("$")) {
    define["__intrinsic__" + key.slice(1)] = define[key];
    delete define[key];
  }
}

export interface ReplacementRule {
  from: RegExp;
  to?: string;
  toRaw?: string;
  global?: boolean;
}

export const function_replacements = [
  "$debug",
  "$assert",
  "$rust",
  "$newRustFunction",
  "$cpp",
  "$newCppFunction",
  "$isPromiseFulfilled",
  "$isPromiseRejected",
  "$isPromisePending",
  "$bindgenFn",
];
const function_regexp = new RegExp(`__intrinsic__(${function_replacements.join("|").replaceAll("$", "")})`);

/** Applies source code replacements as defined in `replacements` */
export function applyReplacements(src: string, length: number) {
  let slice = src.slice(0, length);
  let rest = src.slice(length);
  slice = slice.replace(/([^a-zA-Z0-9_\$])\$([a-zA-Z0-9_]+\b)/gm, `$1__intrinsic__$2`);
  for (const replacement of replacements) {
    slice = slice.replace(
      replacement.from,
      replacement.toRaw ?? replacement.to!.replaceAll("$", "__intrinsic__").replaceAll("%", "$"),
    );
  }
  // Independent of the rules above: none of them produces or consumes a
  // `__intrinsic__<name>(` call that is in the map, so running this after all
  // of them matches the old interleaved rule order.
  if (slice.includes("__intrinsic__")) {
    slice = slice.replace(intrinsicCall, (call, name) => intrinsicCallReplacements.get(name) ?? call);
  }
  let match;
  if ((match = slice.match(function_regexp)) && rest.startsWith("(")) {
    const name = match[1];
    if (name === "debug") {
      const innerSlice = sliceSourceCode(rest, true);
      return [
        slice.slice(0, match.index) + "(IS_BUN_DEVELOPMENT?$debug_log" + innerSlice.result + ":void 0)",
        innerSlice.rest,
        true,
      ];
    } else if (name === "assert") {
      const checkSlice = sliceSourceCode(rest, true, undefined, true);
      let rest2 = checkSlice.rest;
      let extraArgs = "";
      if (checkSlice.result.at(-1) === ",") {
        const sliced = sliceSourceCode("(" + rest2.slice(1), true, undefined, false);
        extraArgs = ", " + sliced.result.slice(1, -1);
        rest2 = sliced.rest;
      }
      return [
        slice.slice(0, match.index) +
          "!(IS_BUN_DEVELOPMENT?$assert(" +
          checkSlice.result.slice(1, -1) +
          "," +
          JSON.stringify(
            checkSlice.result
              .slice(1, -1)
              .replace(/__intrinsic__/g, "$")
              .trim(),
          ) +
          extraArgs +
          "):void 0)",
        rest2,
        true,
      ];
    } else if (["rust", "cpp", "newRustFunction", "newCppFunction"].includes(name)) {
      const kind = name.includes("ust") ? "rust" : "cpp";
      const is_create_fn = name.startsWith("new");

      const inner = sliceSourceCode(rest, true);
      let args;
      try {
        const str =
          "[" +
          inner.result
            .slice(1, -1)
            .replaceAll("'", '"')
            .replace(/,[\s\n]*$/s, "") +
          "]";
        args = JSON.parse(str);
      } catch {
        throw new Error(`Call is not known at bundle-time: '$${name}${inner.result}'`);
      }
      if (
        args.length != (is_create_fn ? 3 : 2) ||
        typeof args[0] !== "string" ||
        typeof args[1] !== "string" ||
        (is_create_fn && typeof args[2] !== "number")
      ) {
        if (is_create_fn) {
          throw new Error(`$${name} takes three arguments, but got '$${name}${inner.result}'`);
        } else {
          throw new Error(`$${name} takes two string arguments, but got '$${name}${inner.result}'`);
        }
      }

      const id = registerNativeCall(kind, args[0], args[1], is_create_fn ? args[2] : null);

      return [slice.slice(0, match.index) + "__intrinsic__lazy(" + id + ")", inner.rest, true];
    } else if (name === "isPromiseFulfilled" || name === "isPromiseRejected" || name === "isPromisePending") {
      const inner = sliceSourceCode(rest, true);
      // JSC::JSPromise::Status: Pending = 0, Fulfilled = 1, Rejected = 2.
      const status = name === "isPromisePending" ? 0 : name === "isPromiseFulfilled" ? 1 : 2;
      let args;
      if (debug) {
        // use a property on @lazy as a temporary holder for the expression. only in debug!
        args = `($assert(__intrinsic__isPromise(__intrinsic__lazy.temp=${inner.result.slice(0, -1)}))),__intrinsic__peekPromiseStatus(__intrinsic__lazy.temp) === (__intrinsic__lazy.temp = undefined, ${status}))`;
      } else {
        args = `(__intrinsic__peekPromiseStatus${inner.result} === ${status})`;
      }
      return [slice.slice(0, match.index) + args, inner.rest, true];
    } else if (name === "bindgenFn") {
      const inner = sliceSourceCode(rest, true);
      let args;
      try {
        const str =
          "[" +
          inner.result
            .slice(1, -1)
            .replaceAll("'", '"')
            .replace(/,[\s\n]*$/s, "") +
          "]";
        args = JSON.parse(str);
      } catch {
        throw new Error(`Call is not known at bundle-time: '$${name}${inner.result}'`);
      }
      if (args.length != 2 || typeof args[0] !== "string" || typeof args[1] !== "string") {
        throw new Error(`$${name} takes two string arguments, but got '$${name}${inner.result}'`);
      }

      const id = registerNativeCall("bind", args[0], args[1], null);

      return [slice.slice(0, match.index) + "__intrinsic__lazy(" + id + ")", inner.rest, true];
    } else {
      throw new Error("Unknown preprocessor macro " + name);
    }
  }
  return [slice, rest, false];
}

/** Applies source code replacements as defined in `globalReplacements` */
export function applyGlobalReplacements(src: string) {
  let result = src;
  for (const replacement of globalReplacements) {
    result = result.replace(replacement.from, replacement.toRaw ?? replacement.to!.replaceAll("$", "__intrinsic__"));
  }
  return result;
}
