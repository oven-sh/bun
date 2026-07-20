// Hardcoded module "bun:internal-for-testing"

// If you want to test an internal API, add a binding into this file.
//
// Then at test time: import ... from "bun:internal-for-testing"
//
// In a debug build, the import is always allowed.
// It is disallowed in release builds unless run in Bun's CI.

const fmtBinding = $bindgenFn("fmt_jsc.bind.ts", "fmtString");

export const highlightJavaScript = (code: string) => fmtBinding(code, "highlight-javascript");
export const highlightJavaScriptRedacted = (code: string) => fmtBinding(code, "highlight-javascript-redacted");
export const escapePowershell = (code: string) => fmtBinding(code, "escape-powershell");

export const canonicalizeIP = $newCppFunction("NodeTLS.cpp", "Bun__canonicalizeIP", 1);

// Runtime-dispatched SIMD xxHash3 kernel (src/jsc/bindings/xxhash3.cpp), driven
// directly so tests can exercise the Highway path independent of Bun.hash.
export const xxHash3ForTesting: (view: ArrayBufferView, seed?: number | bigint) => bigint = $newCppFunction(
  "xxhash3_testing.cpp",
  "Bun__xxhash3_64_forTesting",
  2,
);

export const SQL = $cpp("JSSQLStatement.cpp", "createJSSQLStatementConstructor");

export const patchInternals = {
  parse: $newRustFunction("patch.rs", "TestingAPIs.parse", 1),
  apply: $newRustFunction("patch.rs", "TestingAPIs.apply", 2),
  makeDiff: $newRustFunction("patch.rs", "TestingAPIs.makeDiff", 2),
};

export const internalSourceMap = {
  fromVLQ: $newRustFunction("sourcemap/InternalSourceMap.rs", "TestingAPIs.fromVLQ", 1) as (vlq: string) => Uint8Array,
  toVLQ: $newRustFunction("sourcemap/InternalSourceMap.rs", "TestingAPIs.toVLQ", 1) as (blob: Uint8Array) => string,
  find: $newRustFunction("sourcemap/InternalSourceMap.rs", "TestingAPIs.find", 3) as (
    blob: Uint8Array,
    line: number,
    col: number,
  ) => {
    generatedLine: number;
    generatedColumn: number;
    originalLine: number;
    originalColumn: number;
    sourceIndex: number;
  } | null,
};

const shellLex = $newRustFunction("shell.rs", "TestingAPIs.shellLex", 2);
const shellParse = $newRustFunction("shell.rs", "TestingAPIs.shellParse", 2);

export const sslCtxLiveCount = $newRustFunction("SecureContext.rs", "jsLiveCount", 0);

export const napiThreadsafeFunctionLiveCount = $newRustFunction("napi_body.rs", "jsThreadsafeFunctionLiveCount", 0);

export const escapeRegExp = $newRustFunction("escapeRegExp.rs", "jsEscapeRegExp", 1);
export const escapeRegExpForPackageNameMatching = $newRustFunction(
  "escapeRegExp.rs",
  "jsEscapeRegExpForPackageNameMatching",
  1,
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
  builtinDisabled: $newRustFunction("shell.rs", "TestingAPIs.disabledOnThisPlatform", 1),
};

export const subprocessInternals = {
  injectStdioReadError: $newRustFunction("subprocess.rs", "TestingAPIs.injectStdioReadError", 2) as (
    subprocess: import("bun").Subprocess,
    kind: "stdout" | "stderr",
  ) => boolean,
};

export const iniInternals = {
  parse: $newRustFunction("ini.rs", "IniTestingAPIs.parse", 1),
  loadNpmrc: $newRustFunction("ini.rs", "IniTestingAPIs.loadNpmrcFromJS", 2),
};

export const cssInternals = {
  minifyTestWithOptions: $newRustFunction("css_internals.rs", "minifyTestWithOptions", 3),
  minifyErrorTestWithOptions: $newRustFunction("css_internals.rs", "minifyErrorTestWithOptions", 3),
  testWithOptions: $newRustFunction("css_internals.rs", "testWithOptions", 3),
  prefixTestWithOptions: $newRustFunction("css_internals.rs", "prefixTestWithOptions", 3),
  minifyTest: $newRustFunction("css_internals.rs", "minifyTest", 3),
  prefixTest: $newRustFunction("css_internals.rs", "prefixTest", 3),
  _test: $newRustFunction("css_internals.rs", "_test", 3),
  attrTest: $newRustFunction("css_internals.rs", "attrTest", 3),
};

export const crash_handler = $rust("crash_handler.rs", "js_bindings.generate") as {
  getMachOImageZeroOffset: () => number;
  segfault: () => void;
  segfaultWithRegisters: () => void;
  panic: () => void;
  rootError: () => void;
  outOfMemory: () => void;
  raiseIgnoringPanicHandler: () => void;
};

export const upgrade_test_helpers = $rust("upgrade_command.rs", "upgrade_js_bindings.generate") as {
  openTempDirWithoutSharingDelete: () => void;
  closeTempDirHandle: () => void;
};

export const install_test_helpers = $rust("install_binding.rs", "bun_install_js_bindings.generate") as {
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
export const memfd_create: (size: number) => number = $newRustFunction(
  "node_fs_binding.rs",
  "createMemfdForTesting",
  1,
);

export const createStatsForIno: (ino: bigint, big: boolean) => any = $newRustFunction(
  "Stat.rs",
  "createStatsForIno",
  2,
);

export const setSyntheticAllocationLimitForTesting: (limit: number) => number = $newRustFunction(
  "virtual_machine_exports.rs",
  "Bun__setSyntheticAllocationLimitForTesting",
  1,
);

// Shrink the markdown parser's block-metadata cap (in bytes) so its
// `TooManyBlocks` error is reachable without 4 GiB of input. The cap can only
// be lowered, never raised past the real limit. Returns the previous value so
// a test can restore it.
export const setMaxMarkdownBlockBytesForTesting: (limit: number) => number = $newRustFunction(
  "MarkdownObject.rs",
  "setMaxMarkdownBlockBytesForTesting",
  1,
);

export const npm_manifest_test_helpers = $rust("npm.rs", "PackageManifest.bindings.generate") as {
  /**
   * Returns the parsed manifest file. Currently only returns an array of available versions.
   */
  parseManifest: (manifestFileName: string, registryUrl: string) => any;
};

// Like npm-package-arg, sort of https://www.npmjs.com/package/npm-package-arg
export type Dependency = any;
export const npa: (name: string) => Dependency = $newRustFunction("dependency.rs", "fromJS", 1);

export const npmTag: (
  name: string,
) => undefined | "npm" | "dist_tag" | "tarball" | "folder" | "symlink" | "workspace" | "git" | "github" =
  $newRustFunction("dependency.rs", "Version.Tag.inferFromJS", 1);

export const readTarball: (tarball: string) => any = $newRustFunction("pack_command.rs", "bindings.jsReadTarball", 1);

export const isArchitectureMatch: (architecture: string[]) => boolean = $newRustFunction(
  "npm.rs",
  "Architecture.jsFunctionArchitectureIsMatch",
  1,
);

export const isOperatingSystemMatch: (operatingSystem: string[]) => boolean = $newRustFunction(
  "npm.rs",
  "OperatingSystem.jsFunctionOperatingSystemIsMatch",
  1,
);

export const createSocketPair: () => [number, number] = $newRustFunction(
  "runtime/socket/socket.rs",
  "jsCreateSocketPair",
  0,
);

export const isModuleResolveFilenameSlowPathEnabled: () => boolean = $newCppFunction(
  "NodeModuleModule.cpp",
  "jsFunctionIsModuleResolveFilenameSlowPathEnabled",
  0,
);

export const frameworkRouterInternals = $rust("FrameworkRouter.rs", "JSFrameworkRouter.getBindings") as {
  parseRoutePattern: (style: string, pattern: string) => null | { kind: string; pattern: string };
  FrameworkRouter: {
    new (opts: any): any;
  };
};

export const bindgen = $rust("bindgen_test.rs", "getBindgenTestFunctions") as {
  add: (a: any, b: any) => number;
  requiredAndOptionalArg: (a: any, b?: any, c?: any, d?: any) => number;
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

// Userland access to node-internal modules for vendored node tests that
// declare `// Flags: --expose-internals` (served via the require interceptor
// in test/js/node/test/common/index.js). Static requires only — the builtin
// bundler cannot rewrite variable-path requires. Extend the map as more
// vendored tests need more internals.
export const exposedInternals = {
  "internal/streams/add-abort-signal": require("internal/streams/add-abort-signal"),
  "internal/async_context_frame": require("internal/async_context_frame"),
  "internal/async_hooks": require("internal/async_hooks"),
  "internal/webstreams/adapters": require("internal/webstreams_adapters"),
  "internal/dgram": require("internal/dgram"),
  // Node's internal/fixed_queue module IS the FixedQueue class.
  "internal/fixed_queue": require("internal/fixed_queue").FixedQueue,
  "internal/freelist": require("internal/freelist"),
  "internal/validators": require("internal/validators"),
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

export const fs = require("node:fs/promises").$data;

export const fsStreamInternals = {
  writeStreamFastPath(str) {
    return str[require("internal/fs/streams").kWriteStreamFastPath];
  },
};

export const arrayBufferViewHasBuffer = $newCppFunction(
  "InternalForTesting.cpp",
  "jsFunction_arrayBufferViewHasBuffer",
  1,
);

export const timerInternals = {
  timerClockMs: $newRustFunction("runtime/timer/Timer.rs", "internal_bindings.timerClockMs", 0),
};

// Raw datagram descriptor helpers for tests that need an unbound fd (which
// the internal/dgram UDP wrap does not expose — it binds on create).
export const dgramInternals = {
  newRawSocketFd: $newRustFunction("udp_socket.rs", "jsDgramNewSocketFd", 2),
  closeRawFd: $newRustFunction("udp_socket.rs", "jsDgramCloseFd", 1),
  isFdAdopted: $newRustFunction("udp_socket.rs", "jsDgramIsFdAdopted", 1),
};

export const decodeURIComponentSIMD = $newCppFunction(
  "decodeURIComponentSIMD.cpp",
  "jsFunctionDecodeURIComponentSIMD",
  1,
);

export const getDevServerDeinitCount = $bindgenFn("DevServer.bind.ts", "getDeinitCountForTesting");
export const getCounters = $newRustFunction("Counters.rs", "createCountersObject", 0);
export const linearFifoOrderedRemoveProbe = $newRustFunction(
  "collections/linear_fifo.rs",
  "TestingAPIs.orderedRemoveProbe",
  1,
) as (scenario: number) => number[];
export const hasNonReifiedStatic = $newCppFunction("InternalForTesting.cpp", "jsFunction_hasReifiedStatic", 1);

interface setSocketOptionsFn {
  (socket: Bun.Socket, sendBuffer: 1, size: number): void;
  (socket: Bun.Socket, recvBuffer: 2, size: number): void;
}

export const setSocketOptions: setSocketOptionsFn = $newRustFunction(
  "runtime/socket/socket.rs",
  "jsSetSocketOptions",
  3,
);

/**
 * The syscalls instrumented in bsd.c, plus non-syscall hooks whose failure
 * paths are otherwise unreachable without injection ("ssl_loop_buffer",
 * "poll_start"; see fault_inject.h for the per-hook description). Arming
 * anything else is rejected.
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
  | "poll_start";

export type SocketFaultRule = {
  syscall: SocketFaultSyscall;
  action: "errno" | "short" | "zero" | "none";
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
  /** match only this fd; -1 (default) = any. Rejected for "ssl_loop_buffer", which has no fd. */
  fd?: number;
};

export const socketFaultInjection = {
  /** True when the current binary was built with `--socket-fault-injection=on` (defaults to on for ASan builds). */
  available: $newRustFunction(
    "runtime/socket/socket.rs",
    "TestingAPIs.jsSocketFaultInjectionAvailable",
    0,
  ) as () => boolean,
  /** Arm a process-wide fault rule for one usockets bsd_* syscall. */
  set: $newRustFunction("runtime/socket/socket.rs", "TestingAPIs.jsSetSocketFault", 1) as (
    rule: SocketFaultRule,
  ) => boolean,
  /** Disarm all fault rules. */
  clear: $newRustFunction("runtime/socket/socket.rs", "TestingAPIs.jsClearSocketFaults", 0) as () => void,
};
type SerializationContext = "worker" | "window" | "postMessage" | "default";
export const structuredCloneAdvanced: (
  value: any,
  transferList: any[],
  forTransfer: boolean,
  forStorage: boolean,
  serializationContext: SerializationContext,
) => any = $newCppFunction("StructuredClone.cpp", "jsFunctionStructuredCloneAdvanced", 5);

export const lsanDoLeakCheck = $newCppFunction("InternalForTesting.cpp", "jsFunction_lsanDoLeakCheck", 1);

export const isASANEnabled: () => boolean = $newCppFunction("InternalForTesting.cpp", "jsFunction_isASANEnabled", 0);

export const BunString_toThreadSafeRefCountDelta: () => number = $newCppFunction(
  "InternalForTesting.cpp",
  "jsFunction_BunString_toThreadSafeRefCountDelta",
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

export const getEventLoopStats: () => { activeTasks: number; concurrentRef: number; numPolls: number } =
  $newRustFunction("event_loop.rs", "getActiveTasks", 0);

export const hostedGitInfo = {
  parseUrl: $newRustFunction("hosted_git_info.rs", "TestingAPIs.jsParseUrl", 1),
  fromUrl: $newRustFunction("hosted_git_info.rs", "TestingAPIs.jsFromUrl", 1),
};

export const translateUVErrorToE: (code: number) => string | undefined = $newRustFunction(
  "sys.rs",
  "TestingAPIs.translateUVErrorToE",
  1,
);

export const translateNtStatusToE: (status: number) => string | undefined = $newRustFunction(
  "sys.rs",
  "TestingAPIs.translateNtStatusToE",
  1,
);

export const sysErrorNameFromLibuv: (errno: number) => string | undefined = $newRustFunction(
  "sys/Error.rs",
  "TestingAPIs.sysErrorNameFromLibuv",
  1,
);

export const sigactionLayout: () =>
  | undefined
  | {
      installed: { handler: number; flags: number };
      readback: { handler: number; flags: number };
      sizeof: number;
    } = $newRustFunction("sys.rs", "TestingAPIs.sigactionLayout", 0);

export const stringsInternals = {
  /**
   * Calls `bun.strings.toUTF16AllocForReal(allocator, bytes, false, true)` and
   * returns the resulting UTF-16 data as a JS string. The `sentinel = true`
   * path is otherwise only reachable from Windows `bun build --compile`
   * metadata, so this binding lets us exercise it on all platforms.
   */
  toUTF16AllocSentinel: $newRustFunction("string/immutable/unicode.rs", "TestingAPIs.toUTF16AllocSentinel", 1) as (
    bytes: Uint8Array,
  ) => string,
};

export const fetchH2Internals = {
  liveCounts: $newRustFunction("http/H2Client.rs", "TestingAPIs.liveCounts", 0) as () => {
    sessions: number;
    streams: number;
  },
};

export const fetchH3Internals = {
  liveCounts: $newRustFunction("http/H3Client.rs", "TestingAPIs.quicLiveCounts", 0) as () => {
    sessions: number;
    streams: number;
  },
};

export const fileSinkInternals = {
  liveCount: $newRustFunction("runtime/webcore/FileSink.rs", "TestingAPIs.fileSinkLiveCount", 0) as () => number,
};
