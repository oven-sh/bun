import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::node::node_fs_binding" });

const Fd = b.i32.validateInteger(0, 2 ** 31 - 1);
/** -1 leaves it as it is. */
const Id = b.i64.validateInteger(-1, 2 ** 32 - 1);

/**
 * Of the views, `PathLike::from_js` takes a `Uint8Array` and a `DataView`.
 * `other` is not a path: each function reports it in its own words.
 */
export const PathLike = b.union({
  string: b.stringLike,
  buffer: b.bufferSource.allowShared,
  url: b.wrapped("WebCore::JSDOMURL", "JSDOMURL.h", { rustPath: "bun_jsc::DOMURL", reportedAs: "URL" }),
  other: b.opaque,
});
export const PathOrFileDescriptor = b.union({ fd: Fd.reportedAs("fd"), path: PathLike });

/** `string` is octal digits. */
export const FileMode = b.union({ number: b.u32.validateInteger().reportedAs("mode"), string: b.string.local });
/** `string` is one of Node's `stringToFlags`. */
export const FileFlags = b.union({
  number: b.i32.validateInteger().reportedAs("flags"),
  string: b.string.local,
  other: b.opaque,
});
/** 0 to 7, which the body checks: a fraction is truncated. */
const accessMode = b.f64.nullable;
const accessModeExpected = "mode must be int32 or null/undefined";

/** Seconds, a `Date`, or a string of seconds. */
export const TimeLike = b.union({ number: b.f64, date: b.f64.allowDate, string: b.string.local, other: b.ignored });

const options = { allowArray: true, reportedAs: "options" } as const;
/** The body checks the value of a member before the next member is read. */
const deferred = { deferred: true, reportedAs: "options" } as const;
const boolean = (value: boolean) => ({ type: b.bool.default(value), expected: ["boolean"] });
const optionalBoolean = { type: b.bool.optional, expected: ["boolean"] };

const encoding = b.opaque;
const flag = FileFlags.emptyStringAsNull;
const mode = { type: FileMode.emptyStringAsNull, expected: ["number"] };
const signal = {
  type: b.abortSignal.shared.emptyStringAsNull,
  expected: ["AbortSignal"],
};
const encodingOr = (options: b.Type) => b.union({ string: b.stringLike, options, other: b.ignored });

export const EncodingOptions = b.dictionary({ encoding }, options);
export const EncodingOrOptions = encodingOr(EncodingOptions);
export const ReaddirOptions = b.dictionary(
  { encoding, recursive: optionalBoolean, withFileTypes: optionalBoolean },
  deferred,
);
export const EncodingOrReaddirOptions = encodingOr(ReaddirOptions);
export const ReadFileOptions = b.dictionary({ encoding, flag, signal }, deferred);
export const EncodingOrReadFileOptions = encodingOr(ReadFileOptions);
export const WriteFileOptions = b.dictionary(
  { encoding, flag, mode, signal, flush: { type: b.bool.nullable.default(false), expected: ["boolean"] } },
  deferred,
);
export const EncodingOrWriteFileOptions = encodingOr(WriteFileOptions);

/** A function is not options: `fs.stat(path, callback)`. */
const statOptions = { ...options, nonObjectAsEmpty: "typeof" } as const;
export const BigIntOptions = b.dictionary({ bigint: boolean(false) }, statOptions);
export const StatOptions = b.dictionary({ throwIfNoEntry: boolean(true), bigint: boolean(false) }, statOptions);

export const MkdirOptions = b.dictionary(
  { recursive: boolean(false), mode: { type: FileMode.nullable, expected: ["number"] } },
  options,
);
export const MkdirOptionsOrMode = b.union({ mode: FileMode, options: MkdirOptions, other: b.ignored });

/** A `String` object is refused, unless the encoding is not UTF-8: only then is it converted. */
export const WriteFileData = b.union({
  string: b.string,
  stringObject: b.stringObject,
  buffer: b.bufferSource.allowShared,
  other: b.ignored,
});

export const RmdirOptions = b.dictionary(
  {
    recursive: { type: b.bool.default(false), expected: 'The "options.recursive" property must be of type boolean.' },
    force: { type: b.bool.default(false), expected: 'The "options.force" property must be of type boolean.' },
    retryDelay: { type: b.u32.validateInteger().default(100) },
    maxRetries: { type: b.u32.validateInteger().default(0) },
  },
  options,
);
/** Node's `validateRmOptions`: own members only, and an own `undefined` is refused. */
export const RmOptionsArgument = b.dictionary(
  {
    recursive: {
      type: b.bool.ifPassed,
      own: true,
      expected: 'The "options.recursive" property must be of type boolean.',
    },
    force: { type: b.bool.ifPassed, own: true, expected: 'The "options.force" property must be of type boolean.' },
    retryDelay: { type: b.u32.validateInteger().ifPassed, own: true },
    maxRetries: { type: b.u32.validateInteger().ifPassed, own: true },
  },
  options,
);
const rmdirExpected = { options: 'The "options" argument must be of type object.' };

export const SymlinkType = b.union({ missing: b.null, name: b.string.allowStringObject, other: b.ignored });

export const ReadPosition = b.union({
  missing: b.null,
  number: b.i64.validateInteger(-1),
  bigInt: b.bigInt,
});
const cell = (name: string) => b.cell(`JSC::${name}`, `JavaScriptCore/${name}.h`, { rustPath: "bun_jsc::JSObject" });
/** `fs.write(fd, buffer, callback)` passes the callback on. */
export const WriteOffset = b.union({
  missing: b.null,
  function: cell("JSFunction"),
  internalFunction: cell("InternalFunction"),
  number: b.u64.validateInteger(),
});
/** `number` is truncated by the body. */
export const WriteLength = b.union({ number: b.f64, bigInt: b.i64.asIntN, other: b.ignored });
/** A whole number that is not negative. Anything else is the current position. */
const position = b.f64.otherAsNull;
/** Either overload of `write` refuses another `buffer` in these words. */
const writeBuffer = ["string", "Buffer", "TypedArray", "DataView"] as const;

const watchFlag = (name: string) => ({ type: b.bool.emptyStringAsNull, expected: `${name} must be a boolean` });
export const WatchOptions = b.dictionary(
  {
    persistent: watchFlag("persistent"),
    verbose: watchFlag("verbose"),
    encoding,
    recursive: watchFlag("recursive"),
    signal: { ...signal, expected: "signal is not of type AbortSignal" },
  },
  { deferred: true, reportedAs: "" },
);
/** `interval` is truncated by the body. */
export const WatchFileOptions = b.dictionary(
  {
    persistent: boolean(true),
    bigint: boolean(false),
    interval: { type: b.f64.default(5007), expected: "interval must be a number" },
  },
  { ...options, nonObjectAsEmpty: true },
);

interface Signature {
  args: Record<string, b.Type>;
  expected?: Record<string, readonly string[] | string>;
}
/** `length` is `[of x, of xSync]`. Each of `overloads` names its Rust function, to which `_cb` and `_sync` are added. */
type Operation = (Signature | { overloads: readonly (Signature & { rustName: string })[] }) & {
  length: readonly [number, number];
};

const fd = { fd: Fd };
const path = { path: PathLike };
const paths = (from: string, to: string) => ({ [from]: PathLike, [to]: PathLike });
const times = { atime: TimeLike, mtime: TimeLike };
const writeFile = { path: PathOrFileDescriptor, data: WriteFileData, options: EncodingOrWriteFileOptions };

/**
 * An argument after a path that can throw or run code is `.deferred`: the body converts it once it has checked the path,
 * so the first argument that is wrong is the one reported.
 */
const operations: Record<string, Operation> = {
  access: { args: { ...path, mode: accessMode.deferred }, expected: { mode: accessModeExpected }, length: [3, 2] },
  appendFile: { args: writeFile, length: [4, 3] },
  chmod: { args: { ...path, mode: FileMode.deferred }, expected: { mode: ["number"] }, length: [3, 2] },
  chown: { args: { ...path, uid: Id.deferred, gid: Id.deferred }, length: [4, 3] },
  close: { args: fd, length: [1, 1] },
  copyFile: {
    args: { ...paths("src", "dest"), mode: accessMode.deferred },
    expected: { mode: accessModeExpected },
    length: [4, 3],
  },
  exists: { args: path, length: [2, 1] },
  fchmod: { args: { ...fd, mode: FileMode }, expected: { mode: ["number"] }, length: [3, 2] },
  fchown: { args: { ...fd, uid: Id, gid: Id }, length: [4, 3] },
  fdatasync: { args: fd, length: [2, 1] },
  fstat: { args: { ...fd, options: BigIntOptions }, length: [1, 1] },
  fsync: { args: fd, length: [2, 1] },
  ftruncate: { args: { ...fd, len: b.i64.validateInteger(-(2 ** 51), 2 ** 52 - 1).default(0) }, length: [1, 1] },
  futimes: { args: { ...fd, ...times }, length: [4, 3] },
  lchmod: { args: { ...path, mode: FileMode.deferred }, expected: { mode: ["number"] }, length: [3, 2] },
  lchown: { args: { ...path, uid: Id.deferred, gid: Id.deferred }, length: [4, 3] },
  link: { args: paths("oldPath", "newPath"), length: [3, 2] },
  lstat: { args: { ...path, options: StatOptions.default({}).deferred }, length: [1, 1] },
  lutimes: { args: { ...path, ...times }, length: [4, 3] },
  mkdir: { args: { ...path, options: MkdirOptionsOrMode.deferred }, length: [3, 2] },
  mkdtemp: { args: { prefix: PathLike, options: EncodingOrOptions.deferred }, length: [3, 2] },
  open: {
    args: { ...path, flags: FileFlags.nullable.deferred, mode: FileMode.nullable.deferred },
    expected: { mode: ["number"] },
    length: [4, 3],
  },
  read: {
    args: {
      ...fd,
      buffer: b.bufferSource.allowShared,
      offset: b.u64.validateInteger().nullable.default(0),
      length: b.f64.loose.ifPassed,
      /** Not looked at when `length` is 0. */
      position: ReadPosition.deferred,
    },
    expected: { buffer: ["Buffer", "TypedArray", "DataView"], position: ["number", "bigint"] },
    length: [6, 5],
  },
  readdir: { args: { ...path, options: EncodingOrReaddirOptions }, length: [3, 2] },
  readFile: { args: { path: PathOrFileDescriptor, options: EncodingOrReadFileOptions }, length: [3, 2] },
  readlink: { args: { ...path, options: EncodingOrOptions.deferred }, length: [3, 2] },
  readv: {
    args: { ...fd, buffers: b.jsArray, position },
    expected: { buffers: "Expected ArrayBufferView[]" },
    length: [4, 3],
  },
  realpath: { args: { ...path, options: EncodingOrOptions.deferred }, length: [3, 2] },
  realpathNative: { args: { ...path, options: EncodingOrOptions.deferred }, length: [3, 3] },
  rename: { args: paths("oldPath", "newPath"), length: [3, 2] },
  rm: { args: { ...path, options: RmOptionsArgument.default({}).deferred }, expected: rmdirExpected, length: [3, 2] },
  rmdir: { args: { ...path, options: RmdirOptions.default({}).deferred }, expected: rmdirExpected, length: [3, 2] },
  stat: { args: { ...path, options: StatOptions.default({}).deferred }, length: [1, 1] },
  statfs: { args: { ...path, options: BigIntOptions.default({}).deferred }, length: [2, 2] },
  symlink: { args: { ...paths("target", "path"), type: SymlinkType.deferred }, length: [4, 3] },
  truncate: { args: { path: PathOrFileDescriptor, len: b.i64.validateInteger().default(0).deferred }, length: [3, 2] },
  unlink: { args: path, length: [2, 1] },
  utimes: { args: { ...path, ...times }, length: [4, 3] },
  write: {
    overloads: [
      {
        rustName: "write_buffer",
        args: { ...fd, buffer: b.bufferSource.allowShared, offset: WriteOffset, length: WriteLength, position },
        expected: { buffer: writeBuffer, offset: ["number"] },
      },
      {
        rustName: "write_string",
        args: { ...fd, buffer: b.string.owned, position, encoding: b.stringLike.otherAsNull },
        expected: { buffer: writeBuffer },
      },
    ],
    length: [6, 5],
  },
  writeFile: { args: writeFile, length: [4, 3] },
  writev: {
    args: { ...fd, buffers: b.jsArray, position },
    expected: { buffers: "Expected ArrayBufferView[]" },
    length: [4, 3],
  },
};

const js = { capability: "js", throws: true } as const;

/** What `xSync` returns, where that is not `undefined`. */
const syncResults: Record<string, readonly string[]> = {
  access: ["null"],
  exists: ["boolean"],
  fstat: ["object"],
  lstat: ["object", "undefined"],
  mkdir: ["string", "undefined"],
  mkdtemp: ["string", "object"],
  open: ["number"],
  read: ["number"],
  readdir: ["Array"],
  readFile: ["string", "object"],
  readlink: ["string", "object"],
  readv: ["number"],
  realpath: ["string", "object"],
  realpathNative: ["string", "object"],
  stat: ["object", "undefined"],
  statfs: ["object"],
  write: ["number"],
  writev: ["number"],
};

const usesOfArgument = [
  ...table.hostOptionBag([
    "bigint",
    "encoding",
    "flag",
    "flush",
    "force",
    "maxRetries",
    "mode",
    "recursive",
    "retryDelay",
    "signal",
    "throwIfNoEntry",
    "withFileTypes",
  ]),
  table.readsContents(),
  table.writesContents(),
  table.printedByFormatter("constructor"),
];
/** What `x` and `xSync` do with their arguments: they keep none and return none. */
const uses = (args: Record<string, b.Type>) => ({
  this: table.inspected,
  ...Object.fromEntries(Object.keys(args).map(name => [name, usesOfArgument])),
});

/** `x`, `xCb`, which is `x` with a leading callback, and `xSync`. */
function members(name: string, { length: [length, syncLength], ...operation }: Operation) {
  const signatures = "overloads" in operation ? operation.overloads : [operation];
  const member = (suffix: "" | "Cb" | "Sync", length: number, of: (signature: Signature) => Signature) => {
    const made = signatures.map((signature, i) => ({
      ...js,
      ...of(signature),
      ...(i === 0 && { length }),
      ...("rustName" in signature && { rustName: `${signature.rustName}${suffix && `_${suffix.toLowerCase()}`}` }),
    }));
    return [`${name}${suffix}`, made.length > 1 ? made : made[0]] as const;
  };
  return [
    member("", length, ({ args, expected }) => ({ args, expected, returns: b.promise, uses: uses(args) })),
    member("Cb", length + 1, ({ args, expected }) => ({
      args: { callback: b.callable, ...args },
      expected: { callback: "callback must be a function", ...expected },
    })),
    member("Sync", syncLength, ({ args, expected }) => ({
      args,
      expected,
      returns: b.opaque.returning(...(syncResults[name] ?? ["undefined"])),
      uses: uses(args),
    })),
  ];
}

const cp = {
  ...js,
  args: {
    ...paths("src", "dest"),
    recursive: b.bool.loose,
    errorOnExist: b.bool.loose,
    /** Without it, true. */
    force: b.bool.loose.ifPassed,
  },
  length: 2,
} as const;
const getter = { getter: b.opaque.returning("object"), capability: "js" } as const;

/** The default export of `src/js/internal/fs/binding.ts`. */
export const NodeJSFS = b.class({
  rustPath: "crate::node::node_fs_binding::Binding",
  types: [table.exactType("$Node.NodeJSFS"), table.exactType("$Bindgen.NodeJSFS")],
  proto: Object.fromEntries(
    [
      ...Object.entries(operations).flatMap(([name, operation]) => members(name, operation)),
      ["cp", { ...cp, returns: b.promise, uses: uses(cp.args) }] as const,
      ["cpSync", { ...cp, uses: uses(cp.args) }] as const,
      [
        "watch",
        {
          ...js,
          args: { filename: PathLike, options: WatchOptions.otherAsNull, listener: b.callable.otherAsNull },
          returns: b.opaque.returning("FSWatcher", "undefined"),
          length: 3,
        },
      ] as const,
      [
        "watchFile",
        {
          ...js,
          args: { filename: PathLike, options: WatchFileOptions.deferred, listener: b.callable.otherAsNull },
          returns: b.opaque.returning("StatWatcher", "undefined"),
          length: 3,
        },
      ] as const,
      ["Dirent", getter] as const,
      ["Stats", { getter: b.opaque.returning(table.builtin("%Stats%").spec), capability: "js" }] as const,
    ].sort(([x], [y]) => x.localeCompare(y)),
  ),
});

export const binding = b.value({ returns: NodeJSFS, capability: "js" });

export const RmOptions = b.dictionary({
  retryDelay: b.u32,
  maxRetries: b.u32,
  recursive: b.bool,
  force: b.bool,
});
/** `(path, options)`, parsed as `fs.rm` parses them. */
export const rmOptionsForTesting = b.fn({
  ...js,
  args: { ...path, options: RmOptionsArgument.default({}).deferred },
  expected: rmdirExpected,
  returns: RmOptions,
  length: 2,
});
export const stringToFlagsForTesting = b.fn({ ...js, args: { flags: FileFlags.nullable }, returns: b.i32, length: 1 });
/** Without `size` it makes nothing. */
export const createMemfdForTesting = b.fn({
  args: { size: b.f64.optional },
  returns: b.i32.optional,
  capability: "js",
  throws: true,
  length: 1,
});
