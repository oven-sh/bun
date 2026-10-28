// Hardcoded module "bun:internal-for-testing"

// If you want to test an internal API, add a binding into this file.
//
// Then at test time: import ... from "bun:internal-for-testing"
//
// In a debug build, the import is always allowed.
// It is disallowed in release builds unless run in Bun's CI.

const fmtBinding = $bindgen("fmt_jsc.bind.ts", "fmtString");

export const highlightJavaScript = (code: string) => fmtBinding(code, "highlight-javascript");
export const highlightJavaScriptRedacted = (code: string) => fmtBinding(code, "highlight-javascript-redacted");
export const escapePowershell = (code: string) => fmtBinding(code, "escape-powershell");

export const canonicalizeIP = $bindgen("cares_jsc.bind.ts", "canonicalizeIP");

// Process-wide additions to the public keys no certificate chain may hold (blocked_spkis.cpp). `hash` is the SHA-256 of
// a DER SubjectPublicKeyInfo.
export const addBlockedSPKIForTesting: (hash: ArrayBufferView) => void = $newCppFunction(
  "NodeTLS.cpp",
  "addBlockedSPKIForTesting",
  1,
);
export const clearBlockedSPKIsForTesting: () => void = $newCppFunction("NodeTLS.cpp", "clearBlockedSPKIsForTesting", 0);

// Runtime-dispatched SIMD xxHash3 kernel (src/jsc/bindings/xxhash3.cpp), driven
// directly so tests can exercise the Highway path independent of Bun.hash.
export const xxHash3ForTesting: (view: ArrayBufferView, seed?: number | bigint) => bigint = $newCppFunction(
  "xxhash3_testing.cpp",
  "Bun__xxhash3_64_forTesting",
  2,
);

// Runtime-dispatched SIMD byte-search kernels (src/jsc/bindings/highway_strings.cpp)
// behind `bun_core::strings`, driven directly so tests can sweep lengths and
// alignments. Returns the kernel's raw result: an index (`haystack.length` =
// not found), a count, or for memmem/memrmem the offset with -1 = not found.
// scannerRunStops fills `arg` with its three bitmaps and returns 0. lineStarts
// fills `arg` with uint32 offsets and returns how many. oddBlocks fills `arg`
// with uint64 words and returns 0.
export const highwayStringsForTesting: (
  op:
    | "indexOfChar"
    | "lastIndexOfChar"
    | "indexOfNotChar"
    | "countChar"
    | "indexOfAny"
    | "lastIndexOfAny"
    | "indexOfUntidySlash"
    | "indexOfUntidySlashOrNonAscii"
    | "lastIndexOfSlash"
    | "lastIndexOfSlashOrDot"
    | "commonPrefixLength"
    | "countSlashes"
    | "memmem"
    | "memrmem"
    | "memmem16"
    | "memrmem16"
    | "scannerRunStops"
    | "lineStarts"
    | "oddBlocks",
  haystack: Uint8Array,
  arg: number | Uint8Array,
) => number = $newCppFunction("highway_strings_testing.cpp", "Bun__highwayStringsForTesting", 3);

// The kernels of the JPEG codec that work on a row of samples (src/jsc/bindings/highway_jpeg.cpp), driven directly so
// tests can give them rows of every length. `rows` are the pointers of the kernel, in its order. False: the row is too
// short for the kernel, which has done nothing.
export const highwayJpegForTesting: (
  op: "fromYcc" | "toYcc" | "h2v2Downsample" | "h2v1Fancy" | "h2v2Fancy",
  n: number,
  ...rows: (Uint8Array | null)[]
) => boolean = $newCppFunction("highway_jpeg_testing.cpp", "Bun__highwayJpegForTesting", 2);

export const SQL = $cpp("JSSQLStatement.cpp", "createJSSQLStatementConstructor");
export const setSQLiteColumnNameTransform = (
  statement: InstanceType<$BunModules["bun:sqlite"]["Statement"]>,
  transform: ((name: string) => string) | null | undefined,
) => statement.native.$setColumnNameTransform(transform);

export const patchInternals = {
  parse: $bindgen("patch_testing.bind.ts", "parse"),
  apply: $bindgen("patch_testing.bind.ts", "apply"),
  makeDiff: $bindgen("patch_testing.bind.ts", "makeDiff"),
};

export const internalSourceMap = {
  fromVLQ: $bindgen("InternalSourceMap.bind.ts", "fromVLQ") as (vlq: string) => Uint8Array,
  toVLQ: $bindgen("InternalSourceMap.bind.ts", "toVLQ"),
  find: $bindgen("InternalSourceMap.bind.ts", "find"),
};

const shellLex = $bindgen("shell_body.bind.ts", "shellLex");
const shellParse = $bindgen("shell_body.bind.ts", "shellParse");

export const sslCtxLiveCount = $bindgen("SecureContext.bind.ts", "liveCount");

export const napiThreadsafeFunctionLiveCount = $bindgen("napi_body.bind.ts", "threadsafeFunctionLiveCount");

export const bundlerWorkerLiveCount = $bindgen("JSBundler.bind.ts", "workerLiveCount");

export const semverIntersects = $bindgen("SemverObjectInternals.bind.ts", "intersects") as (
  left: string,
  right: string,
) => boolean;

/** What a bytecode order file calls the code of `text`: `M <name>` and `<start> <kind> <name>` lines, or null. */
export const bytecodeOrderNames = $bindgen("BytecodeOrderRecorder.bind.ts", "namesForTesting") as (
  text: string,
  kind: "module" | "script" | "builtin" | "internal",
  chunkPaths?: string,
) => string | null | undefined;

/** What the checker's queries answer for every node of every compiled file that `entryPoint` (an absolute path) reaches, and every diagnostic with its class and effect. `threads` 0 or absent: one per core. */
export const describeCheckerQueries = $bindgen("checker_queries_testing.bind.ts", "describeCheckerQueries") as (
  entryPoint: string,
  threads?: number,
) => string;

export const escapeRegExp = $bindgen("bun_string_jsc.bind.ts", "escapeRegExp");
export const escapeRegExpForPackageNameMatching = $bindgen(
  "bun_string_jsc.bind.ts",
  "escapeRegExpForPackageNameMatching",
);

export const shellInternals = {
  lex: (a, ...b) => shellLex(a.raw, b),
  parse: (a, ...b) => shellParse(a.raw, b),
  /**
   * Checks if the given builtin is disabled on the current platform
   *
   * @example
   * ```typescript
   * const isDisabled = builtinDisabled("cp")
   * ```
   */
  builtinDisabled: $bindgen("shell_body.bind.ts", "disabledOnThisPlatform"),
};

export const subprocessInternals = {
  injectStdioReadError: $bindgen("subprocess.bind.ts", "injectStdioReadError"),
  closeStdinWriter: $bindgen("subprocess.bind.ts", "closeStdinWriter"),
};

export const iniInternals = {
  parse: $bindgen("ini_jsc.bind.ts", "parse"),
  loadNpmrc: $bindgen("ini_jsc.bind.ts", "loadNpmrc"),
};

export const cssInternals = {
  minifyTestWithOptions: $bindgen("css_internals.bind.ts", "minifyTestWithOptions"),
  minifyErrorTestWithOptions: $bindgen("css_internals.bind.ts", "minifyErrorTestWithOptions"),
  testWithOptions: $bindgen("css_internals.bind.ts", "testWithOptions"),
  prefixTestWithOptions: $bindgen("css_internals.bind.ts", "prefixTestWithOptions"),
  minifyTest: $bindgen("css_internals.bind.ts", "minifyTest"),
  prefixTest: $bindgen("css_internals.bind.ts", "prefixTest"),
  _test: $bindgen("css_internals.bind.ts", "test"),
  attrTest: $bindgen("css_internals.bind.ts", "attrTest"),
};

export const crash_handler = $bindgen("crash_handler_jsc.bind.ts", "crashHandler");

export const upgrade_test_helpers = $bindgen("upgrade_command.bind.ts", "upgradeTestHelpers");

export const install_test_helpers = $bindgen("install_binding.bind.ts", "installTestHelpers") as {
  /**
   * Returns the lockfile at the given path as an object.
   */
  parseLockfile: (cwd: string) => any;
};

export const jscInternals = $cpp("JSCTestingHelpers.cpp", "createJSCTestingHelpers");

export const nativeFrameForTesting: (callback: () => void) => void = $cpp(
  "CallSite.cpp",
  "createNativeFrameForTesting",
);

// Linux-only. Create an in-memory file descriptor with a preset size.
// You should call fs.closeSync(fd) when you're done with it.
export const memfd_create = $bindgen("node_fs_binding.bind.ts", "createMemfdForTesting") as (size: number) => number;

export const createStatsForIno: (ino: bigint, big: boolean) => any = $bindgen("Stat.bind.ts", "createStatsForIno");

export const setSyntheticAllocationLimitForTesting: (limit: number) => number = $bindgen(
  "virtual_machine_exports.bind.ts",
  "setSyntheticAllocationLimitForTesting",
);

// Shrink the markdown parser's block-metadata cap (in bytes) so its
// `TooManyBlocks` error is reachable without 4 GiB of input. The cap can only
// be lowered, never raised past the real limit. Returns the previous value so
// a test can restore it.
export const setMaxMarkdownBlockBytesForTesting = $bindgen(
  "MarkdownObjectInternals.bind.ts",
  "setMaxMarkdownBlockBytesForTesting",
);

export const npm_manifest_test_helpers = $bindgen("npm_jsc.bind.ts", "npmManifestTestHelpers") as {
  /**
   * Returns the parsed manifest file. Currently only returns an array of available versions.
   */
  parseManifest: (manifestFileName: string, registryUrl: string) => any;
};

export const readTarball = $bindgen("pack_command.bind.ts", "readTarball");

export const readTar = $bindgen("ArchiveInternals.bind.ts", "readTar");
export const writeTar = $bindgen("ArchiveInternals.bind.ts", "writeTar");

export const isArchitectureMatch: (architecture: string[]) => boolean = $bindgen(
  "npm_jsc.bind.ts",
  "architectureIsMatch",
);

export const isOperatingSystemMatch: (operatingSystem: string[]) => boolean = $bindgen(
  "npm_jsc.bind.ts",
  "operatingSystemIsMatch",
);

export const createSocketPair = $bindgen("socket_body.bind.ts", "createSocketPair") as () => [number, number];

export const isModuleResolveFilenameSlowPathEnabled: () => boolean = $newCppFunction(
  "NodeModuleModule.cpp",
  "jsFunctionIsModuleResolveFilenameSlowPathEnabled",
  0,
);

export const frameworkRouterInternals = {
  parseRoutePattern: $bindgen("FrameworkRouter.bind.ts", "parseRoutePattern"),
  FrameworkRouter: $bindgen("filesystem_router.bind.ts", "FrameworkFileSystemRouter"),
};

// Only in a build with assertions: `isCompiled` in scripts/build/codegen.ts.
export const bindgen = $bindgen("bindgen_test.bind.ts", "add") && {
  add: $bindgen("bindgen_test.bind.ts", "add"),
  requiredAndOptionalArg: $bindgen("bindgen_test.bind.ts", "requiredAndOptionalArg"),
  utf8Echo: $bindgen("bindgen_test.bind.ts", "utf8Echo"),
  utf8EchoLoose: $bindgen("bindgen_test.bind.ts", "utf8EchoLoose"),
  utf8Optional: $bindgen("bindgen_test.bind.ts", "utf8Optional"),
  utf8Owned: $bindgen("bindgen_test.bind.ts", "utf8Owned"),
  stringEcho: $bindgen("bindgen_test.bind.ts", "stringEcho"),
  stringLength: $bindgen("bindgen_test.bind.ts", "stringLength"),
  expectedByNode: $bindgen("bindgen_test.bind.ts", "expectedByNode"),
  expectedMessage: $bindgen("bindgen_test.bind.ts", "expectedMessage"),
  nextColor: $bindgen("bindgen_test.bind.ts", "nextColor"),
  optionsEcho: $bindgen("bindgen_test.bind.ts", "optionsEcho"),
  describeValue: $bindgen("bindgen_test.bind.ts", "describeValue"),
  describeAnything: $bindgen("bindgen_test.bind.ts", "describeAnything"),
  overloaded: $bindgen("bindgen_test.bind.ts", "overloaded"),
  describeDefaults: $bindgen("bindgen_test.bind.ts", "describeDefaults"),
  names: $bindgen("bindgen_test.bind.ts", "names"),
  bare: $bindgen("bindgen_test.bind.ts", "bare"),
  dateOf: $bindgen("bindgen_test.bind.ts", "dateOf"),
  latin1: $bindgen("bindgen_test.bind.ts", "latin1"),
  textOrBytes: $bindgen("bindgen_test.bind.ts", "textOrBytes"),
  positions: $bindgen("bindgen_test.bind.ts", "positions"),
  sumArray: $bindgen("bindgen_test.bind.ts", "sumArray"),
  range: $bindgen("bindgen_test.bind.ts", "range"),
  words: $bindgen("bindgen_test.bind.ts", "words"),
  sumBytes: $bindgen("bindgen_test.bind.ts", "sumBytes"),
  sumBytesThenText: $bindgen("bindgen_test.bind.ts", "sumBytesThenText"),
  sumBytesIfAny: $bindgen("bindgen_test.bind.ts", "sumBytesIfAny"),
  fillBuffer: $bindgen("bindgen_test.bind.ts", "fillBuffer"),
  stringOrObjectEcho: $bindgen("bindgen_test.bind.ts", "stringOrObjectEcho"),
  stringViewEcho: $bindgen("bindgen_test.bind.ts", "stringViewEcho"),
  stringViewCloneOutlivesBytes: $bindgen("bindgen_test.bind.ts", "stringViewCloneOutlivesBytes"),
  stringOrObjectViewEcho: $bindgen("bindgen_test.bind.ts", "stringOrObjectViewEcho"),
  sumBeforeAndAfterCallback: $bindgen("bindgen_test.bind.ts", "sumBeforeAndAfterCallback"),
  callOr: $bindgen("bindgen_test.bind.ts", "callOr"),
  stringAsIsOrBytesIfAny: $bindgen("bindgen_test.bind.ts", "stringAsIsOrBytesIfAny"),
  presentUnlessEmptyString: $bindgen("bindgen_test.bind.ts", "presentUnlessEmptyString"),
  fail: $bindgen("bindgen_test.bind.ts", "fail"),
  TestCounter: $bindgen("bindgen_test.bind.ts", "TestCounter"),
  TestMutates: $bindgen("bindgen_test.bind.ts", "TestMutates"),
  TestRefCounted: $bindgen("bindgen_test.bind.ts", "TestRefCounted"),
  makeToken: $bindgen("bindgen_test.bind.ts", "makeToken"),
  TestError: $bindgen("bindgen_test.bind.ts", "TestError"),
  TestReadOnly: $bindgen("bindgen_test.bind.ts", "TestReadOnly"),
  TestMemberFunctions: $bindgen("bindgen_test.bind.ts", "TestMemberFunctions"),
  TestBoundThis: $bindgen("bindgen_test.bind.ts", "TestBoundThis"),
  TestNonFinal: $bindgen("bindgen_test.bind.ts", "TestNonFinal"),
  TestShape: $bindgen("bindgen_test.bind.ts", "TestShape"),
  TestSquare: $bindgen("bindgen_test.bind.ts", "TestSquare"),
  makeShape: $bindgen("bindgen_test.bind.ts", "makeShape"),
  makeSquare: $bindgen("bindgen_test.bind.ts", "makeSquare"),
  makeSquareWrapper: $bindgen("bindgen_test.bind.ts", "makeSquareWrapper"),
  shapeFromJS: $bindgen("bindgen_test.bind.ts", "shapeFromJS"),
  droppedShapes: $bindgen("bindgen_test.bind.ts", "droppedShapes"),
  TestNote: $bindgen("bindgen_test.bind.ts", "TestNote"),
  TestRefCountedNote: $bindgen("bindgen_test.bind.ts", "TestRefCountedNote"),
  isNoteFromJSDirect: $bindgen("bindgen_test.bind.ts", "isNoteFromJSDirect"),
  tokenIdFromJS: $bindgen("bindgen_test.bind.ts", "tokenIdFromJS"),
  errorConstructor: $bindgen("bindgen_test.bind.ts", "errorConstructor"),
  afterFirst: $bindgen("bindgen_test.bind.ts", "afterFirst"),
  bytesOf: $bindgen("bindgen_test.bind.ts", "bytesOf"),
  bytesOfOrToString: $bindgen("bindgen_test.bind.ts", "bytesOfOrToString"),
  bytesOfString: $bindgen("bindgen_test.bind.ts", "bytesOfString"),
  bytesOfRefusingStringObject: $bindgen("bindgen_test.bind.ts", "bytesOfRefusingStringObject"),
  bytesOfBufferOrBlob: $bindgen("bindgen_test.bind.ts", "bytesOfBufferOrBlob"),
  bytesOfRefusingUndefined: $bindgen("bindgen_test.bind.ts", "bytesOfRefusingUndefined"),
  bytesOfThen: $bindgen("bindgen_test.bind.ts", "bytesOfThen"),
  bytesOfThenCopyingShared: $bindgen("bindgen_test.bind.ts", "bytesOfThenCopyingShared"),
  bytesOfThenCopied: $bindgen("bindgen_test.bind.ts", "bytesOfThenCopied"),
  bytesOfAreSameMemory: $bindgen("bindgen_test.bind.ts", "bytesOfAreSameMemory"),
  bytesOfAreSameMemoryCopyingShared: $bindgen("bindgen_test.bind.ts", "bytesOfAreSameMemoryCopyingShared"),
  bytesBeforeAndAfterCallback: $bindgen("bindgen_test.bind.ts", "bytesBeforeAndAfterCallback"),
  bytesBeforeAndAfterCallbackCopyingShared: $bindgen(
    "bindgen_test.bind.ts",
    "bytesBeforeAndAfterCallbackCopyingShared",
  ),
  pinnedBytesAfterCallback: $bindgen("bindgen_test.bind.ts", "pinnedBytesAfterCallback"),
  stringAsIsOrBytes: $bindgen("bindgen_test.bind.ts", "stringAsIsOrBytes"),
  asBigInt: $bindgen("bindgen_test.bind.ts", "asBigInt"),
  thisAndCallee: $bindgen("bindgen_test.bind.ts", "thisAndCallee"),
  doubled: $bindgen("bindgen_test.bind.ts", "doubled"),
  makeDoubled: $bindgen("bindgen_test.bind.ts", "makeDoubled"),
  promisePtrContext: $bindgen("bindgen_test.bind.ts", "promisePtrContext"),
  readPromisePtr: $bindgen("bindgen_test.bind.ts", "readPromisePtr"),
  makeNativePromiseContext: $bindgen("bindgen_test.bind.ts", "makeNativePromiseContext"),
  readNativePromiseContext: $bindgen("bindgen_test.bind.ts", "readNativePromiseContext"),
  primes: $bindgen("bindgen_test.bind.ts", "primes"),
  testNamespace: $bindgen("bindgen_test.bind.ts", "testNamespace"),
  nodeOptionsSize: $bindgen("bindgen_test.bind.ts", "nodeOptionsSize"),
  bareOptionsSize: $bindgen("bindgen_test.bind.ts", "bareOptionsSize"),
  timeValue: $bindgen("bindgen_test.bind.ts", "timeValue"),
  textIfPassed: $bindgen("bindgen_test.bind.ts", "textIfPassed"),
  isPassed: $bindgen("bindgen_test.bind.ts", "isPassed"),
  isPassedAfterRequired: $bindgen("bindgen_test.bind.ts", "isPassedAfterRequired"),
  requiredPair: $bindgen("bindgen_test.bind.ts", "requiredPair"),
  requiredOverloaded: $bindgen("bindgen_test.bind.ts", "requiredOverloaded"),
  lengthWithValue: $bindgen("bindgen_test.bind.ts", "lengthWithValue"),
  counterWithValue: $bindgen("bindgen_test.bind.ts", "counterWithValue"),
  keptString: $bindgen("bindgen_test.bind.ts", "keptString"),
  bracketEcho: $bindgen("bindgen_test.bind.ts", "bracketEcho"),
  describeHandle: $bindgen("bindgen_test.bind.ts", "describeHandle"),
  isObject: $bindgen("bindgen_test.bind.ts", "isObject"),
  objectEcho: $bindgen("bindgen_test.bind.ts", "objectEcho"),
  absenceEcho: $bindgen("bindgen_test.bind.ts", "absenceEcho"),
  callbackOrDelay: $bindgen("bindgen_test.bind.ts", "callbackOrDelay"),
  presentArguments: $bindgen("bindgen_test.bind.ts", "presentArguments"),
  finiteLater: $bindgen("bindgen_test.bind.ts", "finiteLater"),
  requiredFiniteLater: $bindgen("bindgen_test.bind.ts", "requiredFiniteLater"),
  integerOrBigInt: $bindgen("bindgen_test.bind.ts", "integerOrBigInt"),
  looseInteger: $bindgen("bindgen_test.bind.ts", "looseInteger"),
  looseIntegerOrBigInt: $bindgen("bindgen_test.bind.ts", "looseIntegerOrBigInt"),
  looseDoubleOrBigInt: $bindgen("bindgen_test.bind.ts", "looseDoubleOrBigInt"),
  wideIntegerOrBigInt: $bindgen("bindgen_test.bind.ts", "wideIntegerOrBigInt"),
  portOf: $bindgen("imported_class_test.bind.ts", "portOf"),
  portOfOrNull: $bindgen("imported_class_test.bind.ts", "portOfOrNull"),
  portAfterCallback: $bindgen("imported_class_test.bind.ts", "portAfterCallback"),
  describeAddressOrList: $bindgen("imported_class_test.bind.ts", "describeAddressOrList"),
  isAddress: $bindgen("imported_class_test.bind.ts", "isAddress"),
};

export const noOpForTesting = $cpp("NoOpForTesting.cpp", "createNoOpForTesting");

/**
 * `bun test --isolate` SourceProvider cache introspection: returns the cached
 * provider's JSC sourceType name ("Module", "BunTranspiledModule", ...) for a
 * resolved specifier, or null when the specifier isn't cached.
 */
export const isolatedModuleCacheSourceType: (specifier: string) => string | null = $cpp(
  "IsolatedModuleCache.cpp",
  "createIsolatedModuleCacheSourceTypeForTesting",
);
export const Dequeue = require("internal/fifo");

// node lib/internal/util.js normalizeEncoding: nullish and '' mean utf8, and
// non-strings are undefined; Bun's Rust binding does not fold 'utf-16le',
// so the node edge cases are handled here.
const rustNormalizeEncoding: (encoding: string) => string | undefined = $bindgen(
  "node_util_binding.bind.ts",
  "normalizeEncoding",
);
const nodeKEmptyObject = require("internal/shared").kEmptyObject;
function nodeNormalizeEncoding(enc: unknown) {
  if (enc == null) return "utf8";
  if (typeof enc !== "string") return undefined;
  const lower = enc.toLowerCase();
  if (lower === "utf-16le") return "utf16le";
  // The Rust map also accepts Buffer-only names node's normalizeEncoding rejects.
  if (lower === "buffer" || lower === "utf16-le") return undefined;
  return rustNormalizeEncoding(enc);
}

// Verbatim from node lib/internal/util.js (countBinaryOnes/getCIDR).
function countBinaryOnes(n: number) {
  // Count the number of bits set in parallel, which is faster than looping
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0xf0f0f0f) * 0x1010101) >>> 24;
}

function getCIDR(address: string, netmask: string, family: string) {
  let ones = 0;
  let split = ".";
  let range = 10;
  let groupLength = 8;
  let hasZeros = false;
  let lastPos = 0;

  if (family === "IPv6") {
    split = ":";
    range = 16;
    groupLength = 16;
  }

  for (let i = 0; i < netmask.length; i++) {
    if (netmask[i] !== split) {
      if (i + 1 < netmask.length) {
        continue;
      }
      i++;
    }
    const part = netmask.slice(lastPos, i);
    lastPos = i + 1;
    if (part !== "") {
      if (hasZeros) {
        if (part !== "0") {
          return null;
        }
      } else {
        const binary = parseInt(part, range);
        const binaryOnes = countBinaryOnes(binary);
        ones += binaryOnes;
        if (binaryOnes !== groupLength) {
          if (binary.toString(2).includes("01")) {
            return null;
          }
          hasZeros = true;
        }
      }
    }
  }

  return `${address}/${ones}`;
}

// Verbatim from node lib/internal/util.js assignFunctionName (assert -> throw).
function assignFunctionName(name, fn, descriptor = nodeKEmptyObject) {
  if (typeof name !== "string") {
    const symbolDescription = name.description;
    if (symbolDescription === undefined) throw new Error("Attempted to name function after descriptionless Symbol");
    name = `[${symbolDescription}]`;
  }
  return Object.defineProperty(fn, "name", {
    __proto__: null,
    writable: false,
    enumerable: false,
    configurable: true,
    ...Object.getOwnPropertyDescriptor(fn, "name"),
    ...descriptor,
    value: name,
  });
}

function nodeIsError(e) {
  return require("node:util/types").isNativeError(e) || e instanceof Error;
}

// node's internal WeakReference: a WeakRef that pins the target strongly
// while its refcount is above zero.
class WeakReference {
  #ref: WeakRef<object>;
  #strong: object | null | undefined = null;
  #refCount = 0;
  constructor(object: object) {
    this.#ref = new WeakRef(object);
  }
  get() {
    // Serving from the pinned ref (when held) is equivalent to deref() and
    // keeps the keepalive member read, not write-only.
    return this.#strong ?? this.#ref.deref();
  }
  incRef() {
    if (++this.#refCount === 1) this.#strong = this.#ref.deref();
  }
  decRef() {
    if (--this.#refCount === 0) this.#strong = null;
  }
}

// node's internal/child_process.getValidStdio, ported verbatim except that
// bun has no Pipe/TTY/TCP handle wraps: pipe entries get a closeable stand-in
// handle and wrap detection is omitted (throws ERR_INVALID_ARG_VALUE instead).
function stdioStringToArray(stdio, channel?) {
  const options: (string | number)[] = [];
  switch (stdio) {
    case "ignore":
    case "overlapped":
    case "pipe":
      options.push(stdio, stdio, stdio);
      break;
    case "inherit":
      options.push(0, 1, 2);
      break;
    default:
      throw $ERR_INVALID_ARG_VALUE("stdio", stdio);
  }
  if (channel) options.push(channel);
  return options;
}

function makeCodedError(Base: ErrorConstructor, code: string, message: string) {
  const err = new Base(message) as Error & { code: string };
  err.code = code;
  return err;
}

interface ValidStdioEntry {
  type?: string;
  fd?: number;
  handle?: { close(): void };
  ipc?: boolean;
  readable?: boolean;
  writable?: boolean;
}

function nodeGetValidStdio(stdio, sync?: boolean) {
  const { isArrayBufferView } = require("node:util/types");
  let ipc;
  let ipcFd;

  if (typeof stdio === "string") {
    stdio = stdioStringToArray(stdio);
  } else if (!Array.isArray(stdio)) {
    throw $ERR_INVALID_ARG_VALUE("stdio", stdio);
  }

  while (stdio.length < 3) (stdio as unknown[]).push(undefined);

  stdio = (stdio as any[]).reduce(function reduceStdioEntry(acc: ValidStdioEntry[], stdio, i: number) {
    function cleanup() {
      for (let i = 0; i < acc.length; i++) {
        if ((acc[i].type === "pipe" || acc[i].type === "ipc") && acc[i].handle) acc[i].handle!.close();
      }
    }

    stdio ??= i < 3 ? "pipe" : "ignore";

    if (stdio === "ignore") {
      acc.push({ type: "ignore" });
    } else if (stdio === "pipe" || stdio === "overlapped" || (typeof stdio === "number" && stdio < 0)) {
      const a: ValidStdioEntry = {
        type: stdio === "overlapped" ? "overlapped" : "pipe",
        readable: i === 0,
        writable: i !== 0,
      };
      // node: `a.handle = new Pipe(PipeConstants.SOCKET)`; bun has no Pipe wrap.
      if (!sync) a.handle = { close() {} };
      acc.push(a);
    } else if (stdio === "ipc") {
      if (sync || ipc !== undefined) {
        cleanup();
        if (!sync) throw $ERR_IPC_ONE_PIPE();
        else throw makeCodedError(Error, "ERR_IPC_SYNC_FORK", "IPC cannot be used with synchronous forks");
      }
      ipc = { close() {} };
      ipcFd = i;
      acc.push({ type: "pipe", handle: ipc, ipc: true });
    } else if (stdio === "inherit") {
      acc.push({ type: "inherit", fd: i });
    } else if (typeof stdio === "number") {
      acc.push({ type: "fd", fd: stdio });
    } else if (typeof stdio.fd === "number") {
      const { fd } = stdio;
      acc.push({ type: "fd", fd });
    } else if (isArrayBufferView(stdio) || typeof stdio === "string") {
      if (!sync) {
        cleanup();
        const inspected = require("node:util").inspect(stdio);
        throw makeCodedError(
          TypeError,
          "ERR_INVALID_SYNC_FORK_INPUT",
          `Asynchronous forks do not support Buffer, TypedArray, DataView or string input: ${inspected}`,
        );
      }
    } else {
      cleanup();
      throw $ERR_INVALID_ARG_VALUE("stdio", stdio);
    }

    return acc;
  }, []);

  return { stdio, ipc, ipcFd };
}

let cachedInternalChildProcess;

// Userland access to node-internal modules for vendored node tests that
// declare `// Flags: --expose-internals` (served via the require interceptor
// in test/js/node/test/common/index.js). Static requires only — the builtin
// bundler cannot rewrite variable-path requires. Extend the map as more
// vendored tests need more internals.
export const exposedInternals = {
  "internal/streams/add-abort-signal": require("internal/streams/add-abort-signal"),
  "internal/util/debuglog": require("internal/util/debuglog"),
  "internal/async_context_frame": require("internal/async_context_frame"),
  "internal/async_hooks": require("internal/async_hooks"),
  "internal/webstreams/adapters": require("internal/webstreams_adapters"),
  "internal/dgram": require("internal/dgram"),
  "internal/primordials": require("internal/primordials"),
  // Bun's real implementations, under the names node's tests import them by.
  "internal/validators": require("internal/validators"),
  "internal/util/inspect": require("internal/util/inspect"),
  "internal/freelist": require("internal/freelist"),
  // Node's internal/fixed_queue module IS the FixedQueue class.
  "internal/fixed_queue": require("internal/fixed_queue").FixedQueue,
  "internal/assert/myers_diff": require("internal/assert/myers_diff"),
  // Bun's internal/errors only carries aggregateTwoErrors; the ERR_* hierarchy
  // is native, not a JS `codes` table, so nothing else is exposed here.
  "internal/errors": require("internal/errors"),
  // normalizeEncoding wraps the same Rust binding node:crypto and the
  // webstream adapters call; the rest are node's own JS helpers, ported
  // verbatim from lib/internal/util.js where Bun has no native equivalent.
  "internal/util": {
    normalizeEncoding: nodeNormalizeEncoding,
    // Bun always has crypto support compiled in.
    assertCrypto() {},
    getCIDR,
    isError: nodeIsError,
    assignFunctionName,
    kEnumerableProperty: Object.freeze({ __proto__: null, enumerable: true }),
    kEmptyObject: nodeKEmptyObject,
    WeakReference,
  },
  // Bun's EventTarget/Event/CustomEvent are the native (global) ones; node
  // keeps them in internal/event_target. kWeakHandler is Bun's real weak
  // listener symbol from internal/shared. Bun has no NodeEventTarget.
  "internal/event_target": {
    Event: globalThis.Event,
    CustomEvent: globalThis.CustomEvent,
    EventTarget: globalThis.EventTarget,
    kWeakHandler: require("internal/shared").kWeakHandler,
  },
  // ChildProcess is the real class exec()/spawn() instantiate, so vendored
  // tests can monkeypatch its prototype; getValidStdio is ported from node.
  // A getter so loading this module does not eagerly pull in child_process.
  get "internal/child_process"() {
    return (cachedInternalChildProcess ??= {
      ChildProcess: require("node:child_process").ChildProcess,
      getValidStdio: nodeGetValidStdio,
    });
  },
  "internal/fs/utils": {
    // Both are the REAL parsers the fs entry points use (FileSystemFlags::from_js
    // and args::Rm::from_js), not JS reimplementations -- vendored tests assert
    // the production behavior through these.
    stringToFlags: $bindgen("node_fs_binding.bind.ts", "stringToFlagsForTesting"),
    validateRmOptionsSync: $bindgen("node_fs_binding.bind.ts", "rmOptionsForTesting"),
  },
  // internalBinding() is served by the registered "internal/test/binding"
  // module (src/js/internal/test/binding.ts), not from here.
};

// State of a web ReadableStream/WritableStream for vendored node tests that
// read Node's `stream[kState].state` / `.storedError` (served through the
// internal/webstreams/util shim in test/js/node/test/common/index.js).
// The stream's closed promise is settled from every terminal transition, so its
// status is the state. A WritableStream mid-`erroring` still reports "writable":
// erroring is not terminal, and nothing observable distinguishes the two here.
export function getWebStreamState(stream: ReadableStream | WritableStream): {
  state: string;
  storedError: unknown;
} {
  const closed = $webStreamClosedPromise(stream);
  switch (Bun.peek.status(closed)) {
    case "fulfilled":
      return { state: "closed", storedError: undefined };
    case "rejected":
      return { state: "errored", storedError: Bun.peek(closed) };
    default:
      return { state: $inheritsWritableStream(stream) ? "writable" : "readable", storedError: undefined };
  }
}

export const arrayBufferViewHasBuffer = $newCppFunction(
  "InternalForTesting.cpp",
  "jsFunction_arrayBufferViewHasBuffer",
  1,
);

export const timerInternals = {
  timerClockMs: $bindgen("Timer.bind.ts", "timerClockMs"),
  monotonicNowMs: $bindgen("Timer.bind.ts", "monotonicNowMs"),
  // Sets the id of this thread's next timer. The counter can only move forward.
  setNextTimerId: $bindgen("Timer.bind.ts", "setNextTimerId") as (id: number) => void,
};

// Raw datagram descriptor helpers for tests that need an unbound fd (which
// the internal/dgram UDP wrap does not expose — it binds on create).
export const dgramInternals = {
  newRawSocketFd: $bindgen("udp_socket.bind.ts", "dgramNewSocketFd"),
  closeRawFd: $bindgen("udp_socket.bind.ts", "dgramCloseFd"),
};

export const decodeURIComponentSIMD = $newCppFunction(
  "decodeURIComponentSIMD.cpp",
  "jsFunctionDecodeURIComponentSIMD",
  1,
);

export const getDevServerDeinitCount = $bindgen("DevServer.bind.ts", "getDeinitCountForTesting");
export const getCounters = $bindgen("Counters.bind.ts", "createCountersObject");
export const linearFifoOrderedRemoveProbe = $bindgen("linear_fifo_testing.bind.ts", "orderedRemoveProbe") as (
  scenario: number,
) => number[];
export const hasNonReifiedStatic = $newCppFunction("InternalForTesting.cpp", "jsFunction_hasReifiedStatic", 1);

const setNativeSocketOptions: (socket: unknown, option: 1 | 2, size: number) => void = $bindgen(
  "socket_body.bind.ts",
  "setSocketOptions",
);

/**
 * `setsockopt()` with `SO_SNDBUF` (`option` 1) or `SO_RCVBUF` (`option` 2) on the connection behind `socket`.
 *
 * To get backpressure without sending megabytes, shrink the send buffer of the side that sends. On loopback the kernel
 * grows the sender's buffer to its maximum (4 MiB on Linux) at once, so shrinking the receiver's buffer changes little.
 *
 * @param socket A `Bun.Socket`, a `ServerWebSocket`, a `WebSocket`, a `node:net` socket, the socket of a `node:http`
 * server's request, or a WebSocket of the `ws` package (built-in or from npm). It has to be connected.
 */
export function setSocketOptions(socket: any, option: 1 | 2, size: number): void {
  // `ws`: the stream the WebSocket runs on, or what the built-in has in its place on a native client.
  socket = socket._socket ?? socket;
  setNativeSocketOptions(
    socket[require("internal/http").kHandle] ?? socket._handle ?? socket[Symbol.for("::bunternal::")] ?? socket,
    option,
    size,
  );
}

/**
 * What `node:http` itself finds under `kOutHeaders` on `message`: the map of its headers, or null where there is none.
 *
 * In an executable that is compiled ahead of time the headers of a server's response are in a compact form until
 * somebody asks for the map, and this is null until then. A program that looks under the symbol asks for the map.
 */
export function storedOutgoingHeaders(message: any): Record<string, [string, unknown]> | null | undefined {
  return message[require("internal/http").kOutHeaders];
}

/**
 * The syscalls instrumented in bsd.c, plus non-syscall hooks whose failure
 * paths are otherwise unreachable without injection ("ssl_loop_buffer",
 * "poll_start", "session_buffer", "ssl_write"; see fault_inject.h for the per-hook
 * description). Arming anything else is rejected.
 */
export type SocketFaultSyscall =
  | "recv"
  | "send"
  | "writev"
  | "sendmsg"
  | "recvmsg"
  | "connect"
  | "accept"
  | "ssl_loop_buffer"
  | "poll_start"
  | "session_buffer"
  | "ssl_write";

export type SocketFaultRule = {
  syscall: SocketFaultSyscall;
  action: "errno" | "short" | "zero" | "excess" | "none";
  /** errno name or numeric value (only used when action === "errno") */
  errno?:
    | "ECONNRESET"
    | "EPIPE"
    | "ETIMEDOUT"
    | "ECONNREFUSED"
    | "EAGAIN"
    | "EWOULDBLOCK"
    | "EINTR"
    | "ENOBUFS"
    | "ENOMEM"
    | "EBADF"
    | "EINVAL"
    | "ENETUNREACH"
    | "EHOSTUNREACH"
    | number;
  /** clamp recv/send length to this many bytes; required and > 0 when action === "short" */
  bytes?: number;
  /** skip the first N matching calls before triggering. Default 0. */
  after?: number;
  /** fire this many times then disarm; -1 = forever. Default 1. */
  repeat?: number;
  /** match only this fd; -1 (default) = any. Rejected for "ssl_loop_buffer" and "session_buffer", which have no fd. */
  fd?: number;
};

export const socketFaultInjection = {
  /** True when the current binary was built with `--socket-fault-injection=on` (defaults to on for ASan builds). */
  available: $bindgen("socket_body.bind.ts", "socketFaultInjectionAvailable"),
  /** Arm a process-wide fault rule for one usockets bsd_* syscall. */
  set: $bindgen("socket_body.bind.ts", "setSocketFault") as (rule: SocketFaultRule) => boolean,
  /** Disarm all fault rules. */
  clear: $bindgen("socket_body.bind.ts", "clearSocketFaults"),
};

export const namedPipeInternals = {
  /**
   * Live native contexts behind sockets over Windows named pipes: one per
   * connecting or connected `Bun.connect({ unix: "\\\\.\\pipe\\..." })` socket and
   * one per accepted pipe client. Always 0 on other platforms.
   */
  liveCount: $bindgen("socket_body.bind.ts", "namedPipeContextLiveCount"),
};

export const duplexTLSInternals = {
  /**
   * Live native contexts behind TLS sockets that run over a JS stream
   * (`tls.connect({ socket: duplex })`, `new tls.TLSSocket(duplex)`): one per
   * socket, until the task that frees it after the close has run.
   */
  liveCount: $bindgen("socket_body.bind.ts", "duplexUpgradeContextLiveCount"),
};
type SerializationContext = "worker" | "window" | "postMessage" | "default";
export const structuredCloneAdvanced: (
  value: any,
  transferList: any[],
  forTransfer: boolean,
  forStorage: boolean,
  serializationContext: SerializationContext,
) => any = $newCppFunction("StructuredClone.cpp", "jsFunctionStructuredCloneAdvanced", 5);

export const isASANEnabled: () => boolean = $newCppFunction("InternalForTesting.cpp", "jsFunction_isASANEnabled", 0);

/** In a build with AddressSanitizer: reads a string of WTF's that was freed, which the sanitizer has to report. Elsewhere: nothing. */
export const readFreedStringUnderASAN: () => number | undefined = $newCppFunction(
  "InternalForTesting.cpp",
  "jsFunction_readFreedStringUnderASAN",
  0,
);

/** The native stack of the calling thread as WTF writes it into the report of a failed assertion. */
export const nativeStackTrace: () => string = $newCppFunction(
  "InternalForTesting.cpp",
  "jsFunction_nativeStackTrace",
  0,
);

/** From here on this process describes a value that a native function rejects without running code of the program. */
export const describeRejectedValuesWithoutScript: () => void = $newCppFunction(
  "InternalForTesting.cpp",
  "jsFunction_describeRejectedValuesWithoutScript",
  0,
);

/** Where the compiler's table of built-ins and this realm disagree, one message each. Empty: they agree, or this Bun has no compiler. */
export const aotBuiltinMismatches: () => string[] = $newCppFunction(
  "InternalForTesting.cpp",
  "jsFunction_aotBuiltinMismatches",
  0,
);
/** The compiler's table of built-ins as plain objects. */
export const aotBuiltinEntries: () => import("../codegen/builtins/dump.ts").TableDump = $newCppFunction(
  "InternalForTesting.cpp",
  "jsFunction_aotBuiltinEntries",
  0,
);
/**
 * What this realm holds for the entry with that `id` of the compiler's table: its object, or the getter or setter of an accessor.
 * `direct:<n>`: a function that hands its receiver and arguments to the native code that a compiled program calls for the entry's overload n without a function object.
 */
export const aotBuiltinValue: (id: number, part: "object" | "getter" | "setter" | `direct:${number}`) => unknown =
  $newCppFunction("InternalForTesting.cpp", "jsFunction_aotBuiltinValue", 2);
/** The native functions that Bun's own modules call under a private name of the global object. A key is the name, then what it is called with. */
export const privateGlobalFunctions: Record<string, (...operands: any[]) => unknown> = {
  toClass: (fn, name, base) => $toClass(fn, name, base),
  "inherits ArrayBuffer": value => $inheritsArrayBuffer(value),
  // It takes the kinds of the name and of the expected types on trust.
  "makeErrorWithCode ERR_INVALID_ARG_TYPE": actual => $ERR_INVALID_ARG_TYPE("name", ["string", "number"], actual),
  "makeErrorWithCode ERR_INVALID_ARG_VALUE": (name, value, reason) => $ERR_INVALID_ARG_VALUE(name, value, reason),
  "makeErrorWithCode ERR_OUT_OF_RANGE": (name, range, received) => $ERR_OUT_OF_RANGE(name, range, received),
  "makeErrorWithCode ERR_MISSING_ARGS": (first, second, third) => $ERR_MISSING_ARGS(first, second, third),
  "makeErrorWithCode ERR_INVALID_RETURN_VALUE": (expected, name, value) =>
    $ERR_INVALID_RETURN_VALUE(expected, name, value),
  "makeErrorWithCode ERR_INVALID_STATE": message => $ERR_INVALID_STATE(message),
  "makeErrorWithCode ERR_INVALID_URL": (input, base) => $ERR_INVALID_URL(input, base),
  "makeErrorWithCode ERR_INVALID_THIS": expected => $ERR_INVALID_THIS(expected),
  "makeErrorWithCode ERR_UNKNOWN_ENCODING": encoding => $ERR_UNKNOWN_ENCODING(encoding),
  "makeErrorWithCode ERR_TLS_CERT_ALTNAME_INVALID": (reason, host, cert) =>
    $ERR_TLS_CERT_ALTNAME_INVALID(reason, host, cert),
  makeAbortError: (message, options) => $makeAbortError(message, options),
  peekPromiseStatus: promise => $peekPromiseStatus(promise),
  peekPromiseSettledValue: promise => $peekPromiseSettledValue(promise),
  pokePromiseAsHandled: promise => $pokePromiseAsHandled(promise),
  webStreamClosedPromise: stream => $webStreamClosedPromise(stream),
  webStreamControllerError: (stream, error) => $webStreamControllerError(stream, error),
};
/** The entries of this Bun's `builtin-uses.json`: every built-in of this platform that uses a removable feature. */
export const builtinFeatureUses: () => import("../../scripts/build/trim/types.ts").BuiltinEntry[] = $newCppFunction(
  "InternalForTesting.cpp",
  "jsFunction_builtinFeatureUses",
  0,
);
/** The engine's `NameClass` of a property name, by the enumerator's name. */
export const aotNameClass: (text: string) => string | undefined = $newCppFunction(
  "InternalForTesting.cpp",
  "jsFunction_aotNameClass",
  1,
);

export const BunString_threadIsolatedCopyRefCountDelta: () => number = $newCppFunction(
  "InternalForTesting.cpp",
  "jsFunction_BunString_threadIsolatedCopyRefCountDelta",
  0,
);

export const BunString_makeThreadShareableRefCountDelta: () => number = $newCppFunction(
  "InternalForTesting.cpp",
  "jsFunction_BunString_makeThreadShareableRefCountDelta",
  0,
);

export const lowercaseHeaderNameSIMD: (name: string) => string = $newCppFunction(
  "InternalForTesting.cpp",
  "jsFunction_lowercaseHeaderNameSIMD",
  1,
);

export const emitMemoryPressure: (level: "warning" | "critical") => void = $newCppFunction(
  "InternalForTesting.cpp",
  "jsFunction_emitMemoryPressure",
  1,
);

export const isMemoryPressureWatcherInstalled: () => boolean = $newCppFunction(
  "InternalForTesting.cpp",
  "jsFunction_isMemoryPressureWatcherInstalled",
  0,
);

// `parallelism` threads each spawn `iterations` no-op threads through bun's own pthread_create,
// writing every failure to `fd`. Returns the first failing errno, or with `detach` 0 as soon as
// every loop runs; a detached loop also writes to `fd` when it runs out of iterations.
export const spawnThreadsForTesting: (iterations: number, fd: number, parallelism: number, detach?: boolean) => number =
  $newCppFunction("InternalForTesting.cpp", "jsFunction_spawnThreadsForTesting", 4);

// True when the installed watcher registered a real OS source (a PSI trigger
// on Linux). The watcher installs silently without one when the kernel
// refuses the trigger, so isMemoryPressureWatcherInstalled() cannot tell.
export const memoryPressureWatcherHasOsBackend = $bindgen("memory_pressure.bind.ts", "watcherHasOsBackend");

// The exact bytes Bun writes to /proc/pressure/memory to arm its trigger.
// null where there is no PSI backend (everything except Linux).
export const memoryPressurePsiTrigger = $bindgen("memory_pressure.bind.ts", "psiTrigger") as () => Buffer | null;

// The PSI event filter: `armed` is the file at arm time, `polls` one read per POLLPRI. null off Linux.
export const memoryPressurePsiFilter: (armed: string, ...polls: string[]) => boolean[] | null = $bindgen(
  "memory_pressure.bind.ts",
  "psiFilter",
);

export const getEventLoopStats: () => {
  activeTasks: number;
  tasks: number;
  immediateTasks: number;
  concurrentTasksEmpty: boolean;
  concurrentRef: number;
  numPolls: number;
  loopActive: boolean;
  eventLoopAlive: boolean;
  /** usockets/libuv loop iterations so far (us_internal_loop_pre count). */
  iteration: number;
} = $bindgen("event_loop.bind.ts", "getActiveTasks");

export const hostedGitInfo = {
  parseUrl: $bindgen("hosted_git_info_jsc.bind.ts", "parseUrl"),
  fromUrl: $bindgen("hosted_git_info_jsc.bind.ts", "fromUrl"),
};

export const translateUVErrorToE = $bindgen("error_jsc.bind.ts", "translateUVErrorToE");

export const translateNtStatusToE = $bindgen("error_jsc.bind.ts", "translateNtStatusToE");

export const sigactionLayout = $bindgen("error_jsc.bind.ts", "sigactionLayout");

export const stringsInternals = {
  /**
   * Calls `bun.strings.toUTF16AllocForReal(allocator, bytes, false, true)` and
   * returns the resulting UTF-16 data as a JS string. The `sentinel = true`
   * path is otherwise only reachable from Windows `bun build --compile`
   * metadata, so this binding lets us exercise it on all platforms.
   */
  toUTF16AllocSentinel: $bindgen("bun_string_jsc.bind.ts", "toUTF16AllocSentinel"),
};

/** Seed the connect-path DNS cache for `hostname` via the real `process_results` interleave; returns family order. */
export const dnsCacheSeed = $bindgen("dns_internals.bind.ts", "seedCacheForTesting") as (
  hostname: string,
  addresses: string[],
) => number[];

/** Whether the connect-path resolver answers `hostname` with the loopback addresses itself instead of asking getaddrinfo. */
export const dnsIsLocalhostName = $bindgen("dns_internals.bind.ts", "isLocalhostNameForTesting");

/** Whether a getaddrinfo() answer made of `addresses` makes the connect-path resolver retry without AI_ADDRCONFIG. */
export const dnsIsAllLoopbackOfOneFamily = $bindgen("dns_internals.bind.ts", "isAllLoopbackOfOneFamilyForTesting") as (
  addresses: string[],
) => boolean;

/** The error a getaddrinfo lookup of `hostname` reports when getaddrinfo(3) returns the `EAI_*` status named `code` (`"EAI_AGAIN"`, `"EAI_FAIL"`, `"EAI_NONAME"`). */
export const dnsGetaddrinfoError = $bindgen("dns_internals.bind.ts", "getaddrinfoErrorForTesting") as (
  code: string,
  hostname: string,
) => Error & { code: string; errno: number; syscall: string; hostname: string };

export const fetchH2Internals = {
  liveCounts: $bindgen("headers_jsc.bind.ts", "h2LiveCounts"),
};

export const fetchH3Internals = {
  liveCounts: $bindgen("headers_jsc.bind.ts", "h3LiveCounts"),
};

const proxyFor = $bindgen("proxy_testing.bind.ts", "proxyFor");

export const proxyInternals = {
  /** Whether the `NO_PROXY` value `list` exempts `hostname` on `port`. */
  noProxyMatches: $bindgen("proxy_testing.bind.ts", "noProxyMatches"),
  /** The proxy an environment of exactly `env` selects for `url`, or null. */
  proxyFor: (env: Record<string, string>, url: string) => proxyFor(Object.entries(env).flat(), url),
  /** What the HTTP client's URL parser makes of `href`. */
  parseURL: $bindgen("proxy_testing.bind.ts", "parseURL") as (href: string) => {
    username: string;
    password: string;
    hostname: string;
    port: string;
    pathname: string;
  },
};

export const fileSinkInternals = {
  liveCount: $bindgen("FileSink.bind.ts", "liveCount"),
};

export const byteStreamInternals = {
  // Swap a ByteStream-backed stream's producer for one whose drain signal
  // re-enters on_cancel, making consumed-during-signal_drained re-entrancy
  // deterministic in tests.
  cancelOnDrain: $bindgen("ByteStream.bind.ts", "cancelOnDrain") as (stream: ReadableStream) => void,
};

// How many internal modules (node:fs etc.) this process created from bytecode embedded by `bun build --compile
// --bytecode` instead of parsing their source.
export const internalModulesLoadedFromBytecode: () => number = $newCppFunction(
  "InternalModuleRegistry.cpp",
  "jsInternalModulesLoadedFromBytecode",
  0,
);

// Whether the source of `fn` knows where its lines start. Before anything asked for a position in it, that means they
// came with its code: from the parse, or out of the bytecode.
export const sourceHasLineStarts: (fn: Function) => boolean = $newCppFunction(
  "ZigSourceProvider.cpp",
  "jsSourceHasLineStarts",
  1,
);

// The bytecode `bun build --compile --bytecode` embeds for a builtin module, plus the external string table it embeds
// beside it: internal module number `index` (null past the last), or `source` written in builtin syntax (@-intrinsics,
// a function expression) compiled under `name`.
export const internalModuleBytecode: {
  (index: number): { name: string; bytecode: Uint8Array; strings: Uint8Array; lazyFunctionCount: number } | null;
  (source: string, name: string): { name: string; bytecode: Uint8Array; strings: Uint8Array };
} = $newCppFunction("InternalModuleRegistry.cpp", "jsInternalModuleBytecode", 2);

/** All paths are absolute native paths. */
export type CodeGraphFile = {
  path: string;
  role: "Checked" | "Inferred" | "TypesOnly";
  isLibrary: boolean;
  isCompiled: boolean;
  isInTypesProgram: boolean;
  typeEdges: string[];
  codeEdges: string[];
  // The rest is read from `CompiledModule`. Without one: 0, null, [], [], false.
  loader: number;
  moduleFormat: "Esm" | "CommonJs" | null;
  sites: {
    specifier: string | null;
    prefix?: string;
    suffix?: string;
    kind: "import" | "require";
    answer: string;
    externalKind: "UncompiledCode" | "HostValue" | null;
  }[];
  impliedAnswers: string[];
  isAotSource: boolean;
};

export type CodeGraph = {
  files: CodeGraphFile[];
  entryPoints: string[];
  compiledFiles: string[];
  hostModules: string[];
  unresolvedEntryPoints: { index: number; failure: string }[];
  /** `TS2307: ..` */
  diagnostics: string[];
};

const describeCodeGraphNative = $bindgen("code_resolver_testing.bind.ts", "describeCodeGraph") as (
  entryPoints: string,
  conditions: string,
  threads: number,
  defines: string,
  features: string,
  workingDirectory: string,
) => string;

/** The files and the two graphs that `bun compile` loads for `entryPoints`, before anything is checked. */
export const describeCodeGraph = (
  entryPoints: string[],
  options: {
    conditions?: string[];
    threads?: number;
    defines?: Record<string, string | boolean>;
    features?: string[];
    workingDirectory?: string;
  } = {},
): CodeGraph =>
  JSON.parse(
    describeCodeGraphNative(
      entryPoints.join("\n"),
      (options.conditions ?? []).join("\n"),
      options.threads ?? 0,
      Object.entries(options.defines ?? {})
        .map(([name, value]) => `${name}=${value}`)
        .join("\n"),
      (options.features ?? []).join("\n"),
      options.workingDirectory ?? "",
    ),
  );

const resolveComputedSpecifierNative = $bindgen("code_resolver_testing.bind.ts", "resolveComputedSpecifier") as (
  importer: string,
  prefix: string,
  suffix: string,
  kind: "import" | "require",
) => string;

/** The modules that a specifier starting with `prefix` and ending with `suffix` can name in the file `importer` (an absolute native path), by the resolver of `bun compile`: absolute native paths and `builtin:node:fs`, in the resolver's order. */
export const resolveComputedSpecifier = (
  importer: string,
  prefix: string,
  suffix: string,
  kind: "import" | "require" = "import",
): { kind: "computed"; candidates: string[] } | { kind: "all"; cause: string } =>
  JSON.parse(resolveComputedSpecifierNative(importer, prefix, suffix, kind));

const trimExecutableNative = $bindgen("trim_testing.bind.ts", "trimExecutable") as (
  path: string,
  out: string,
  featureNames: string,
  usedFeatureNames: string,
) => string;
/** Removes `featureNames` (as written in src/trim/features/*.def: "Sqlite") from the executable at `path` and writes the result to `out`. With `usedFeatureNames`, also what a program that uses only those leaves unused. Throws what `bun build --compile --trim` would print. */
export const trimExecutable = (
  path: string,
  out: string,
  featureNames: string[],
  usedFeatureNames: string[] = [],
): { removed: string[]; removedBytes: number; fileBytesSaved: number; uncutReason: string | null } =>
  JSON.parse(trimExecutableNative(path, out, featureNames.join("\n"), usedFeatureNames.join("\n")));

const readTrimTableNative = $bindgen("trim_testing.bind.ts", "readTrimTable") as (path: string) => string;
/** The trim table of the executable at `path`, as `decodeTable` of scripts/build/trim/table.ts returns it. Throws on a file without one. */
export const readTrimTable = (path: string): import("../../scripts/build/trim/table").TrimTable => {
  const table = JSON.parse(readTrimTableNative(path));
  table.featuresHash = BigInt(table.featuresHash);
  return table;
};

/** What members of prototypes, of classes and of literals answer under names that only the modules of the runtime can write: `$isOpen`, `$exchange` and `$isPrepared` are read and written by these modules alone, `$written`, `$writer` and `$warning` by native code too. One line a question. */
export function membersUnderNamesOfTheRuntime(tag: string): string[] {
  const lines: string[] = [];
  let stored: unknown;
  const ask = (question: string, answer: () => unknown) => {
    try {
      lines.push(question + ": " + String(answer()));
    } catch (error) {
      lines.push(question + ": throws " + (error as Error).name);
    }
  };
  const keysOf = (object: object) => Reflect.ownKeys(object).map(String).join();

  class Fixed {
    $isOpen(more: string) {
      return "method " + more;
    }
    get $exchange() {
      return "getter";
    }
    set $exchange(value: unknown) {
      stored = value;
    }
    static $isPrepared() {
      return "static";
    }
    $written(more: string) {
      return "method " + more;
    }
    get $writer() {
      return "getter";
    }
    set $writer(value: unknown) {
      stored = value;
    }
    static $warning() {
      return "static";
    }
  }
  class Heir extends Fixed {
    $isOpen(more: string) {
      return "heir of " + super.$isOpen(more);
    }
    $written(more: string) {
      return "heir of " + super.$written(more);
    }
    storeAbove(value: unknown) {
      super.$exchange = value;
      super.$writer = value;
    }
  }
  const makeClass = (captured: string) =>
    class {
      $isOpen(more: string) {
        return captured + " method " + more;
      }
      get $exchange() {
        return captured + " getter";
      }
      set $exchange(value: unknown) {
        stored = captured + " " + value;
      }
      static $isPrepared() {
        return captured + " static";
      }
      $written(more: string) {
        return captured + " method " + more;
      }
      get $writer() {
        return captured + " getter";
      }
      set $writer(value: unknown) {
        stored = captured + " " + value;
      }
      static $warning() {
        return captured + " static";
      }
    };
  function Plain() {}
  $toClass(Plain, "Plain");
  Plain.prototype.$isOpen = function (more: string) {
    return tag + " stored " + more;
  };
  Plain.prototype.$written = function (more: string) {
    return tag + " stored " + more;
  };
  const makeLiteral = (captured: string) => ({
    $isOpen(more: string) {
      return captured + " method " + more;
    },
    get $exchange() {
      return captured + " getter";
    },
    set $exchange(value: unknown) {
      stored = captured + " " + value;
    },
    $written(more: string) {
      return captured + " method " + more;
    },
    get $writer() {
      return captured + " getter";
    },
    set $writer(value: unknown) {
      stored = captured + " " + value;
    },
  });

  const subjects: [string, any, any][] = [
    ["a class", new Fixed(), Fixed],
    ["an heir", new Heir(), Heir],
    ["a class that captures", new (makeClass(tag))(), makeClass(tag)],
    ["a second class that captures", new (makeClass(tag + tag))(), makeClass(tag + tag)],
    ["a function", new Plain(), Plain],
    ["a literal", makeLiteral(tag), undefined],
    ["an object below a literal", Object.create(makeLiteral(tag)), undefined],
  ];
  for (const [name, instance, constructor] of subjects) {
    ask(name + " $isOpen", () => instance.$isOpen("a"));
    ask(name + " $written", () => instance.$written("b"));
    ask(name + " $exchange", () => instance.$exchange);
    ask(name + " $writer", () => instance.$writer);
    ask(name + " $exchange =", () => ((stored = "nothing"), (instance.$exchange = 1), stored));
    ask(name + " $writer =", () => ((stored = "nothing"), (instance.$writer = 2), stored));
    ask(name + " $isPrepared", () => constructor && constructor.$isPrepared && constructor.$isPrepared());
    ask(name + " $warning", () => constructor && constructor.$warning && constructor.$warning());
    ask(name + " under no such name", () => typeof instance.$isPrepared + " " + typeof instance.$warning);
    ask(name + " keys", () => keysOf(instance) + " | " + keysOf(Object.getPrototypeOf(instance)));
    ask(name + " keys of the constructor", () => constructor && keysOf(constructor));
  }
  ask("a store above", () => ((stored = "nothing"), new Heir().storeAbove(3), stored));
  ask(
    "removed",
    () =>
      delete (Fixed.prototype as { $isOpen?: unknown }).$isOpen &&
      delete (Fixed.prototype as { $written?: unknown }).$written,
  );
  ask("behind the removal", () => typeof new Fixed().$isOpen + " " + typeof new Fixed().$written);
  ask("an heir behind the removal", () => new Heir().$isOpen("c"));
  ask("stored again", () => {
    Fixed.prototype.$isOpen = Plain.prototype.$isOpen;
    Fixed.prototype.$written = Plain.prototype.$written;
    return new Fixed().$isOpen("d") + " | " + new Heir().$written("e");
  });
  return lines;
}
