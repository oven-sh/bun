import * as b from "../../codegen/bindgen-lib.ts";

const flag = b.bool.loose.optional;
/** The `toString()` of a `String` object has to run after the code is copied, or after the options are read. */
const stringObject = b.string.allowStringObject.deferred;
export const TranspilerLoader = b.union({ missing: b.null, name: b.string.view, stringObject, other: b.ignored });
const loader = TranspilerLoader;

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

export const TranspilerList = b.union({ list: b.jsArray, other: b.ignored });
export const TranspilerRecord = b.union({ record: b.object, other: b.ignored });

/** `eliminate` ignores non-strings. Each value of `replace` is converted to an expression. */
export const TranspilerExports = b.dictionary(
  { eliminate: TranspilerList.emptyStringAsNull, replace: TranspilerRecord.emptyStringAsNull },
  { allowArray: true },
);

/** What is neither a string nor an array is stringified. */
export const TranspilerTSConfig = b.union({ list: b.jsArray, text: b.string, stringObject, other: b.opaque });
export const TranspilerMacros = b.union({
  enabled: b.bool,
  text: b.string,
  json: b.object,
  other: b.ignored,
});

/** `define` is a record. `tsconfig` and `macro` are a JSON string or an object to stringify. */
export const TranspilerOptions = b.dictionary(
  {
    define: TranspilerRecord.emptyStringAsNull,
    external: TranspilerExternal.nullable,
    loader: TranspilerLoader,
    target: b.string.utf8.optional,
    tsconfig: TranspilerTSConfig.nullable,
    macro: TranspilerMacros.emptyStringAsNull,
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
/** `scan` and `scanImports` make their result while the arena that holds its strings is alive. */
const method = { returns: b.object, capability: "js", throws: true, length: 2 } as const;

export const LoaderOrContext = b.union({
  missing: b.null,
  name: b.string.view,
  number: b.f64,
  stringObject,
  context: b.object,
  other: b.ignored,
});
export const MacroContext = b.union({ missing: b.undefined, context: b.object, other: b.ignored });
const expected = (name: string) => ({ code: `Expected code to be a string or Uint8Array for '${name}'.` });

export const Transpiler = b.class({
  rustPath: "crate::api::js_transpiler::JSTranspiler",
  refCounted: true,
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
    transform: {
      ...method,
      args: { code, loader },
      expected: expected("transform"),
      returns: b.promise,
      passThis: true,
    },
    transformSync: {
      ...method,
      args: { code, loaderOrContext: LoaderOrContext, context: MacroContext },
      expected: expected("transformSync"),
      returns: b.string.local,
    },
  },
});
