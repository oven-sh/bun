import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::bun_object" });

const stringOrBuffer = b.bytes({ from: ["string", "buffer"] });

export const allocUnsafe = b.fn({
  args: { size: b.u32.validateInteger() },
  returns: b.bufferSource,
  capability: "heap",
  throws: true,
});

export const BracesOptions = b.dictionary(
  {
    tokenize: b.bool.loose.default(false),
    parse: b.bool.loose.default(false),
  },
  { allowArray: true },
);

export const braces = b.fn({
  args: {
    input: b.string.loose,
    options: BracesOptions.nullable.default({}),
  },
  returns: b.any,
  capability: "js",
  throws: true,
});

/** `windowBits` is converted and not used. */
export const ZlibCompressionOptions = b.dictionary(
  {
    windowBits: b.f64.loose.allowBigInt.optional,
    library: b.string.utf8.nullable,
    level: b.f64.loose.allowBigInt.optional,
    memLevel: b.i32.validateInteger(1, 9).default(8),
    strategy: b.i32.validateInteger(0, 4).default(0),
  },
  { allowArray: true },
);

/** `level`, `memLevel` and `strategy` are converted and not used. */
export const ZlibDecompressionOptions = b.dictionary(
  {
    windowBits: b.f64.loose.allowBigInt.optional,
    level: b.f64.loose.allowBigInt.optional,
    memLevel: b.f64.loose.allowBigInt.optional,
    strategy: b.f64.loose.allowBigInt.optional,
    library: b.string.utf8.nullable,
  },
  { allowArray: true },
);

const zlib = (
  rustName: string,
  options: typeof ZlibCompressionOptions | typeof ZlibDecompressionOptions,
  data = stringOrBuffer,
) =>
  b.fn({
    args: { data, options: options.default({}) },
    returns: b.bufferSource,
    capability: "heap",
    throws: true,
    rustPath: `crate::api::bun_object::JSZlib::${rustName}`,
  });

/** libdeflate reads each input block twice, so copy shared buffers that another thread could change in between. */
const compressionInput = b.bytes({ from: ["string", "buffer"], shared: "copied" });

export const deflateSync = zlib("deflate_sync", ZlibCompressionOptions, compressionInput);

export const gc = b.fn({
  args: {
    force: b.bool.loose.default(false),
  },
  returns: b.usize,
  capability: "js",
  rustPath: "crate::api::bun_object::gc_from_js",
});

export const gunzipSync = zlib("gunzip_sync", ZlibDecompressionOptions);
export const gzipSync = zlib("gzip_sync", ZlibCompressionOptions, compressionInput);

export const indexOfLine = b.fn({
  args: {
    buffer: b.bytes({ from: ["buffer"] }),
    offset: b.f64.loose.allowBigInt.default(0),
  },
  returns: b.f64,
});

export const inflateSync = zlib("inflate_sync", ZlibDecompressionOptions);

export const InspectOptions = b.dictionary(
  {
    depth: b.f64.otherAsNull,
    colors: b.bool.loose.optional,
    sorted: b.bool.loose.optional,
    compact: b.bool.loose.optional,
  },
  { allowArray: true },
);
export const InspectOptionsOrDepth = b.union({ options: InspectOptions, depth: b.f64, ignored: b.any });

/**
 * `(arg, options)` or `(arg, depth, colors)`. `Bun.inspect()` is `""` and `Bun.inspect(undefined)` is
 * `"undefined"`.
 */
export const inspect = b.fn({
  export: "Bun__BunObject__inspect",
  args: { arg: b.any.ifPassed, options: InspectOptionsOrDepth, colors: b.bool.loose.nullable },
  returns: b.string.utf8,
  capability: "js",
  throws: true,
});

export const MMapOptions = b.dictionary(
  {
    shared: b.bool.loose.default(true),
    sync: b.bool.loose.default(false),
    size: b.f64.loose.allowBigInt.optional,
    offset: b.f64.loose.allowBigInt.default(0),
  },
  { allowArray: true },
);

export const mmap = b.fn({
  args: {
    path: b.string.utf8,
    options: MMapOptions.nullable.default({}),
  },
  returns: b.bufferSource,
  capability: "js",
  throws: true,
});

export const EditorOptions = b.dictionary(
  {
    editor: b.string.loose.utf8.nullable,
    line: b.string.loose.utf8.nullable,
    column: b.string.loose.utf8.nullable,
  },
  { allowArray: true, nonObjectAsEmpty: true },
);

export const openInEditor = b.fn({
  args: {
    path: b.string.loose.utf8.nullable.default(""),
    options: EditorOptions.nullable.default({}),
  },
  capability: "heap",
  throws: true,
});

/** Without a `moduleId` or a `parent`, `resolveSync` throws and `resolve` rejects. */
const resolveSignature = {
  args: { moduleId: b.string.loose.nullable, parent: b.string.loose.nullable, esm: b.bool.default(true) },
  capability: "js",
  throws: true,
} as const;
export const resolve = b.fn({ ...resolveSignature, returns: b.any, rejects: true });
export const resolveSync = b.fn({ ...resolveSignature, returns: b.string });

export const serve = b.fn({ args: { options: b.any }, returns: b.any, capability: "js", throws: true });

export const shellEscape = b.fn({
  args: { input: b.string.loose },
  returns: b.string,
  capability: "heap",
  throws: true,
});

export const shrink = b.fn({ capability: "js" });

export const sleepSync = b.fn({
  args: { milliseconds: b.f64 },
  capability: "heap",
  throws: true,
});

/** The table of what is not an object is `""`. */
const tabularData = b.object.otherAsNull;
const tableSignature = {
  export: "Bun__BunObject__table",
  feature: "ConsoleTable",
  returns: b.string.utf8,
  capability: "js",
  throws: true,
} as const;
/** `Bun.inspect.table` */
export const table = b.overloads(
  {
    ...tableSignature,
    args: { tabularData, properties: b.jsArray, options: InspectOptions.otherAsNull },
    rustPath: "crate::api::bun_object::table_with_properties",
  },
  {
    ...tableSignature,
    args: { tabularData, options: InspectOptions.otherAsNull },
    rustPath: "crate::api::bun_object::table",
  },
);

export const WhichOptions = b.dictionary(
  {
    PATH: b.string.loose.utf8.optional,
    cwd: b.string.loose.utf8.optional,
  },
  { allowArray: true, nonObjectAsEmpty: true },
);

export const which = b.fn({
  args: {
    command: b.string.loose.utf8.nullable.default(""),
    options: WhichOptions.nullable.default({}),
  },
  returns: b.string.local.nullable,
  capability: "heap",
  throws: true,
});

export const ZstdCompressionOptions = b.dictionary({ level: b.f64.loose.allowBigInt.optional }, { allowArray: true });

const pinned = b.bytes({ from: ["string", "buffer"], held: "pinned" });

export const zstdCompress = b.fn({
  args: { data: pinned, options: ZstdCompressionOptions.default({}) },
  returns: b.any,
  capability: "js",
  throws: true,
  rustPath: "crate::api::bun_object::JSZstd::compress",
});

export const zstdCompressSync = b.fn({
  args: { data: stringOrBuffer, options: ZstdCompressionOptions.default({}) },
  returns: b.bufferSource,
  capability: "heap",
  throws: true,
  rustPath: "crate::api::bun_object::JSZstd::compress_sync",
});

export const zstdDecompress = b.fn({
  args: { data: pinned },
  returns: b.any,
  capability: "js",
  rustPath: "crate::api::bun_object::JSZstd::decompress",
});

export const zstdDecompressSync = b.fn({
  args: { data: stringOrBuffer },
  returns: b.bufferSource,
  capability: "heap",
  throws: true,
  rustPath: "crate::api::bun_object::JSZstd::decompress_sync",
});
