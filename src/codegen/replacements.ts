import { readFileSync } from "node:fs";
import { join } from "node:path";
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

let error_i = 0;
for (let i = 0; i < NodeErrors.length; i++) {
  const [code, _constructor, _name, ...other_constructors] = NodeErrors[i];
  replacements.push({
    from: new RegExp(`\\b\\__intrinsic__${code}\\(`, "g"),
    to: `$makeErrorWithCode(${error_i}, `,
  });
  error_i += 1;
  for (const con of other_constructors) {
    if (con == null) continue;
    replacements.push({
      from: new RegExp(`\\b\\__intrinsic__${code}_${con.name}\\(`, "g"),
      to: `$makeErrorWithCode(${error_i}, `,
    });
    error_i += 1;
  }
}

for (let id = 0; id < jsclasses.length; id++) {
  const name = jsclasses[id][0];
  replacements.push({
    from: new RegExp(`\\b\\__intrinsic__inherits${name}\\(`, "g"),
    to: `$inherits(${id}, `,
  });
}

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

/**
 * The labels of a `#[repr(u8)]` Rust enum, indexed by discriminant. Each
 * variant's label comes from `labelOf`, or by default from the variant name the
 * way strum's `serialize_all = "snake_case"` spells it.
 */
function rustEnumLabels(file: string, enumName: string, labelOf?: (variant: string) => string): string[] {
  const source = readFileSync(join(import.meta.dir, file), "utf8");
  const body = source.match(new RegExp(`pub enum ${enumName} \\{([^}]*)\\}`))?.[1];
  if (!body) throw new Error(`replacements.ts: could not find \`pub enum ${enumName}\` in ${file}`);
  labelOf ??= variant => variant.replace(/(?<=[a-z0-9])([A-Z])/g, "_$1").toLowerCase();
  const labels: string[] = [];
  for (const [, variant, id] of body.matchAll(/^\s*([A-Z][A-Za-z0-9]*)\s*=\s*(\d+),/gm)) {
    labels[Number(id)] = labelOf(variant);
  }
  if (labels.length === 0 || labels.includes(undefined!)) {
    throw new Error(`replacements.ts: \`${enumName}\` discriminants in ${file} must be dense and start at 0`);
  }
  return labels;
}

/** `bun_ast::ImportKind::label()`: `ImportKind::Stmt => b"import-statement"`, … */
function importKindLabel(variant: string): string {
  const source = readFileSync(join(import.meta.dir, "../ast/lib.rs"), "utf8");
  const arms = source.match(/pub fn label\(self\) -> &'static \[u8\] \{\s*match self \{([^}]*)\}/)?.[1];
  const label = arms?.match(new RegExp(`ImportKind::${variant} => b"([^"]*)"`))?.[1];
  if (label === undefined)
    throw new Error(`replacements.ts: no ImportKind::label() arm for ${variant} in src/ast/lib.rs`);
  return label;
}

// These enums map to $<enum>IdToLabel and $<enum>LabelToId, id == Rust discriminant.
// Make sure to define in ./builtins.d.ts
export const enums = {
  // JSBundler passes these to BundlerPlugin.ts (and gets loaders back) as numbers.
  Loader: rustEnumLabels("../ast/loader.rs", "Loader"),
  ImportKind: rustEnumLabels("../ast/lib.rs", "ImportKind", importKindLabel),
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
  define[`$${name}LabelToId`] = "{" + keys.map((k, i) => `"${k}": ${i}`).join(", ") + "}";
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
