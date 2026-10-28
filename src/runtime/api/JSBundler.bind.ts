import * as b from "../../codegen/bindgen-lib.ts";
import { BlobSliceBound, chunkSize } from "../webcore/BlobArguments.bind.ts";

export default b.module({ rustPath: "crate::api::js_bundler" });

const js = { capability: "js", throws: true } as const;
const method = { returns: b.promise, ...js } as const;

export const BuildArtifact = b.class({
  rustPath: "crate::api::js_bundler::BuildArtifact",
  internalFields: ["stream"],
  proto: {
    arrayBuffer: method,
    hash: { getter: b.string.local, cache: true, capability: "heap", throws: true },
    json: method,
    kind: { getter: b.string, cache: true },
    loader: { getter: b.string.local, cache: true, ...js },
    path: { getter: b.string.utf8, cache: true },
    size: { getter: b.f64 },
    /** Returns a `Blob`, whose schema imports this one. */
    slice: {
      ...method,
      args: { start: BlobSliceBound, end: BlobSliceBound, contentType: BlobSliceBound },
      returns: b.object.returning("Blob"),
      length: 2,
    },
    /** `Bun.build` fills the field of an output that has a source map. */
    sourcemap: { getter: b.self.nullable, cache: true, capability: "heap" },
    stream: {
      ...method,
      args: { chunkSize },
      expected: { chunkSize: "chunkSize must be a number" },
      returns: b.object.returning("ReadableStream"),
      passThis: true,
      length: 1,
    },
    text: method,
    type: { getter: b.string.local, cache: true, capability: "js" },
  },
});

const text = b.string.allowStringObject.utf8.owned.nullable;
const flag = b.bool.loose.optional;
/** An own `undefined` is the text "undefined". */
const ownText = { type: b.string.loose.utf8.owned.ifPassed, own: true } as const;
/** The elements are converted to strings while it is walked. */
const ownList = { type: b.jsArray.optional, own: true } as const;
const ownRecord = { type: b.object.optional, own: true } as const;

export const BuildOptimize = b.dictionary({ bytecode: flag }, { allowArray: true, reportedAs: "optimize" });
export const BuildSourceMap = b.union({ enabled: b.bool, name: b.string.allowStringObject.utf8.owned });
export const BuildEnvBehavior = b.union({
  missing: b.undefined,
  disable: b.null,
  flag: b.bool,
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

export const BuildCompileWindows = b.dictionary(
  {
    hideConsole: { type: b.bool.loose.ifPassed, own: true },
    icon: ownText,
    title: ownText,
    publisher: ownText,
    version: ownText,
    description: ownText,
    copyright: ownText,
  },
  { deferred: true, reportedAs: "compile.windows" },
);
/** `false` is "no order file", as in `compile: { bytecodeOrder: haveProfile && path }`. */
export const BytecodeOrder = b.union({
  missing: b.null,
  flag: b.bool,
  one: b.string.allowStringObject.utf8.owned,
  list: b.jsArray,
  other: b.opaque,
});
export const BuildCompileOptions = b.dictionary(
  {
    target: ownText,
    execArgv: ownList,
    executablePath: ownText,
    windows: { type: BuildCompileWindows.optional, own: true },
    outfile: ownText,
    assets: ownList,
    autoloadDotenv: flag,
    autoloadBunfig: flag,
    autoloadTsconfig: flag,
    autoloadPackageJson: flag,
    bytecodeOrder: BytecodeOrder,
    jitPolicy: b.f64.optional,
  },
  { deferred: true, reportedAs: "compile" },
);
export const BuildCompile = b.union({
  enabled: b.bool,
  target: b.string.allowStringObject.utf8.owned,
  options: BuildCompileOptions,
});

export const BuildConfig = b.dictionary(
  {
    target: text,
    /** `setup()` of each runs while the array is walked, and may change the config. */
    plugins: b.jsArray.nullable,
    macros: flag,
    bytecode: flag,
    bytecodeDepth: b.jsNumber.optional,
    optimize: BuildOptimize.emptyStringAsNull,
    reactFastRefresh: flag,
    reactCompiler: flag,
    reactCompilerParseTestPragmas: flag,
    reactCompilerOutputMode: text,
    outdir: text,
    tsconfig: text,
    banner: text,
    footer: text,
    sourcemap: BuildSourceMap.emptyStringAsNull,
    env: BuildEnvBehavior,
    packages: text,
    jsx: BuildJsx.emptyStringAsNull,
    format: text,
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
  ...method,
  args: { config: BuildConfig.otherAsNull },
  rustPath: "crate::api::js_bundler::js_bundler::build",
});

export const workerLiveCount = b.fn({ returns: b.usize });
