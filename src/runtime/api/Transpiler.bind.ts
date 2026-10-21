import * as b from "../../codegen/bindgen-lib.ts";

const flag = b.bool.loose.optional;

export const TranspilerExternal = b.union({
  name: b.string.allowStringObject,
  names: b.array(b.string.allowStringObject),
});

export const TranspilerMinifyOptions = b.dictionary(
  { whitespace: flag, syntax: flag, identifiers: flag },
  { allowArray: true },
);

/** Of the strings only `""` is taken, and it says nothing. */
export const TranspilerMinify = b.union({ all: b.bool, string: b.string, options: TranspilerMinifyOptions });

export const TranspilerSourcemap = b.union({ enabled: b.bool, mode: b.string.loose.utf8 });

/** `eliminate` skips what is not a string, and a value of `replace` becomes an expression. */
export const TranspilerExports = b.dictionary({ eliminate: b.any, replace: b.any }, { allowArray: true });

/** `define` has any keys. `tsconfig` and `macro` are JSON, or what `JSON.stringify` makes JSON of. */
export const TranspilerOptions = b.dictionary(
  {
    define: b.any,
    external: TranspilerExternal.nullable,
    loader: b.string.utf8.nullable,
    target: b.string.utf8.optional,
    tsconfig: b.any,
    macro: b.any,
    autoImportJSX: flag,
    allowBunRuntime: flag,
    inline: { type: flag, rustName: "inlining" },
    minifyWhitespace: flag,
    deadCodeElimination: flag,
    replMode: flag,
    minify: TranspilerMinify.nullable,
    sourcemap: TranspilerSourcemap.nullable,
    packages: b.string.utf8.nullable,
    treeShaking: flag,
    trimUnusedImports: flag,
    /** Published in `bun-types`. Nothing reads it. */
    jsxOptimizationInline: flag,
    exports: TranspilerExports.falsyAsNull,
    logLevel: b.string.loose.utf8.nullable,
  },
  { allowArray: true },
);

export const LoaderOrMacroContext = b.union({ loader: b.string.utf8, context: b.any });

export const TranspilerCode = b.union({ text: b.string.allowStringObject, buffer: b.bufferSource.allowShared });

const code = TranspilerCode;
const loader = b.string.utf8.nullable;
const method = { returns: b.any, capability: "js", throws: true, length: 2 } as const;
const expected = (name: string) => ({
  code: `Expected code to be a string or Uint8Array for '${name}'.`,
  loader: "loader must be a string",
});

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
      args: { code, loaderOrContext: LoaderOrMacroContext, context: b.any },
      expected: { code: expected("transformSync").code },
      returns: b.string.local,
    },
  },
});
