import * as b from "../../codegen/bindgen-lib.ts";

const flag = b.bool.loose.optional;
/** `b.any`: a `String` object's `toString()` has to run after the code is copied. */
const loader = b.any;

export const TranspilerExternal = b.union({
  name: b.string.allowStringObject,
  names: b.array(b.string.allowStringObject),
});

export const TranspilerMinifyOptions = b.dictionary(
  { whitespace: flag, syntax: flag, identifiers: flag },
  { allowArray: true },
);

export const TranspilerMinify = b.union({ all: b.bool, options: TranspilerMinifyOptions });

export const TranspilerSourcemap = b.union({ enabled: b.bool, mode: b.string.loose.utf8 });

/** `eliminate` ignores non-strings. Each value of `replace` is converted to an expression. */
export const TranspilerExports = b.dictionary(
  { eliminate: b.any.emptyStringAsNull, replace: b.any.emptyStringAsNull },
  { allowArray: true },
);

/** `define` is a record. `tsconfig` and `macro` are a JSON string or an object to stringify. */
export const TranspilerOptions = b.dictionary(
  {
    define: b.any.emptyStringAsNull,
    external: TranspilerExternal.nullable,
    loader: b.any,
    target: b.string.utf8.optional,
    tsconfig: b.any,
    macro: b.any.emptyStringAsNull,
    autoImportJSX: flag,
    allowBunRuntime: flag,
    inline: { type: flag, rustName: "inlining" },
    minifyWhitespace: flag,
    deadCodeElimination: flag,
    replMode: flag,
    minify: TranspilerMinify.emptyStringAsNull,
    sourcemap: TranspilerSourcemap.nullable,
    packages: b.string.utf8.nullable,
    treeShaking: flag,
    trimUnusedImports: flag,
    exports: TranspilerExports.emptyStringAsNull,
    logLevel: b.string.loose.utf8.emptyStringAsNull,
  },
  { allowArray: true },
);

const code = b.bytes({ from: ["string", "buffer"], string: "asIs", held: "handle" });
const method = { returns: b.any, capability: "js", throws: true, length: 2 } as const;
const expected = (name: string) => ({ code: `Expected code to be a string or Uint8Array for '${name}'.` });

export const Transpiler = b.class({
  rustPath: "crate::api::js_transpiler::JSTranspiler",
  refCounted: true,
  configurable: false,
  construct: {
    args: { options: TranspilerOptions.nullable },
    expected: { options: "Expected an object" },
    capability: "js",
    throws: true,
    length: 0,
  },
  proto: {
    scan: { ...method, args: { code, loader }, expected: expected("scan") },
    scanImports: { ...method, args: { code, loader }, expected: expected("scanImports") },
    transform: { ...method, args: { code, loader }, expected: expected("transform"), passThis: true },
    transformSync: {
      ...method,
      args: { code, loaderOrContext: b.any, context: b.any },
      expected: expected("transformSync"),
      returns: b.string.local,
    },
  },
});
