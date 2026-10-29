import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::js_bundler" });

const js = { capability: "js", throws: true } as const;
const read = { returns: b.promise, ...js } as const;
const cached = { getter: b.string.local, cache: true, ...js } as const;

export const BuildArtifact = b.class({
  rustPath: "crate::api::js_bundler::BuildArtifact",
  internalFields: ["stream"],
  proto: {
    arrayBuffer: read,
    hash: cached,
    json: read,
    kind: { getter: b.string, cache: true },
    loader: cached,
    path: { getter: b.string.utf8, cache: true },
    size: { getter: b.f64 },
    /** Returns a `Blob`, whose schema imports this one. */
    slice: {
      ...js,
      args: { start: b.opaque, end: b.opaque, contentType: b.opaque },
      returns: b.object.returning("Blob"),
      length: 2,
    },
    /** `Bun.build` fills the field of an output that has a source map. */
    sourcemap: { getter: b.opaque.returning("BuildArtifact", "null"), cache: true, capability: "heap" },
    stream: { ...js, args: { chunkSize: b.opaque }, returns: b.object.returning("ReadableStream"), passThis: true },
    text: read,
    type: { getter: b.string.local, cache: true, capability: "js" },
  },
});

const text = b.string.allowStringObject.utf8.owned.nullable;
const flag = b.bool.loose.optional;
/** The elements are converted to strings while it is walked. */
const ownList = { type: b.jsArray.optional, own: true } as const;
const ownRecord = { type: b.object.optional, own: true } as const;

export const BuildOptimize = b.dictionary({ bytecode: flag }, { allowArray: true, reportedAs: "optimize" });
export const BuildEnvBehavior = b.union({
  missing: b.undefined,
  disable: b.null,
  enabled: b.bool,
  number: b.f64,
  text: b.string.allowStringObject.utf8.owned,
  other: b.ignored,
});
export const BuildJsx = b.dictionary(
  { runtime: text, factory: text, fragment: text, importSource: text, development: flag, sideEffects: flag },
  { deferred: true, reportedAs: "jsx" },
);
export const BuildMinifyParts = b.dictionary(
  { whitespace: flag, syntax: flag, identifiers: flag, keepNames: flag },
  { allowArray: true, reportedAs: "minify" },
);
export const BuildMinify = b.union({ all: b.bool, parts: BuildMinifyParts });
export const BuildConditions = b.union({ one: b.string.allowStringObject.utf8.owned, list: b.jsArray });
export const BuildNamingTemplates = b.dictionary(
  { entry: text, chunk: text, asset: text },
  { deferred: true, reportedAs: "naming" },
);
/** `entry` alone, or one template each. */
export const BuildNaming = b.union({ entry: b.string.allowStringObject.utf8.owned, each: BuildNamingTemplates });
export const BuildMetafilePaths = b.dictionary(
  { json: text, markdown: text },
  { allowArray: true, reportedAs: "metafile" },
);
export const BuildMetafile = b.union({
  enabled: b.bool,
  json: b.string.allowStringObject.utf8.owned,
  paths: BuildMetafilePaths,
});

export const BuildCompile = b.union({ enabled: b.bool, target: b.stringLike, options: b.object });

export const BuildConfig = b.dictionary(
  {
    target: text,
    /** `setup()` of each runs while the array is walked, and may change the config. */
    plugins: b.jsArray.nullable,
    macros: flag,
    bytecode: flag,
    bytecodeDepth: b.u32.validateIntegerRange().optional,
    optimize: BuildOptimize.emptyStringAsNull,
    reactFastRefresh: flag,
    reactCompiler: flag,
    reactCompilerParseTestPragmas: flag,
    reactCompilerOutputMode: text,
    outdir: text,
    tsconfig: text,
    banner: text,
    footer: text,
    sourcemap: b.opaque.emptyStringAsNull,
    env: BuildEnvBehavior,
    packages: b.opaque.nullable,
    jsx: BuildJsx.emptyStringAsNull,
    format: b.opaque.nullable,
    splitting: flag,
    splitRequire: flag,
    modulePreload: flag,
    check: flag,
    dts: flag,
    foldChunksForTesting: flag,
    minChunkSize: b.u64.validateIntegerRange(0, Number.MAX_SAFE_INTEGER).nanAs(0).optional,
    minify: { type: BuildMinify.emptyStringAsNull, expected: "Expected minify to be a boolean or an object" },
    entrypoints: b.jsArray.nullable,
    entryPoints: b.jsArray.nullable,
    /** From a path to the content of an in-memory file. */
    files: ownRecord,
    deprecatedNamespaceObjectSetters: flag,
    emitDCEAnnotations: flag,
    ignoreDCEAnnotations: flag,
    treeShaking: flag,
    conditions: BuildConditions.emptyStringAsNull,
    root: text,
    external: ownList,
    allowUnresolved: { type: b.jsArray.nullable, own: true },
    drop: ownList,
    features: ownList,
    optimizeImports: ownList,
    publicPath: text,
    naming: { type: BuildNaming.emptyStringAsNull, expected: "Expected naming to be a string or an object" },
    /** From an identifier to the JSON that replaces it. */
    define: ownRecord,
    /** From a file extension to the name of a loader. */
    loader: ownRecord,
    throw: { type: b.bool.optional, rustName: "throw_on_error" },
    metafile: {
      type: BuildMetafile.nullable,
      own: true,
      expected: "Expected metafile to be a boolean, string, or object with json/markdown paths",
    },
    compile: {
      type: BuildCompile.emptyStringAsNull,
      expected: "Expected compile to be a boolean or string or options object",
    },
  },
  { deferred: true, reportedAs: "" },
);

export const build = b.fn({
  ...js,
  args: { config: BuildConfig.otherAsNull },
  returns: b.promise,
  rustPath: "crate::api::js_bundler::js_bundler::build",
});

export const workerLiveCount = b.fn({ returns: b.usize });
