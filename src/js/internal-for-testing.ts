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
  parse: $newNativeFunction("patch_jsc/testing.rs", "TestingAPIs.parse", 1),
  apply: $newNativeFunction("patch_jsc/testing.rs", "TestingAPIs.apply", 2),
  makeDiff: $newNativeFunction("patch_jsc/testing.rs", "TestingAPIs.makeDiff", 2),
};

export const internalSourceMap = {
  fromVLQ: $newNativeFunction("sourcemap/InternalSourceMap.rs", "TestingAPIs.fromVLQ", 1) as (
    vlq: string,
  ) => Uint8Array,
  toVLQ: $newNativeFunction("sourcemap/InternalSourceMap.rs", "TestingAPIs.toVLQ", 1) as (blob: Uint8Array) => string,
  find: $newNativeFunction("sourcemap/InternalSourceMap.rs", "TestingAPIs.find", 3) as (
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

const shellLex = $newNativeFunction("shell_body.rs", "TestingAPIs.shellLex", 2);
const shellParse = $newNativeFunction("shell_body.rs", "TestingAPIs.shellParse", 2);

export const sslCtxLiveCount = $newNativeFunction("SecureContext.rs", "jsLiveCount", 0);

export const escapeRegExp = $newNativeFunction("escapeRegExp.rs", "jsEscapeRegExp", 1);
export const escapeRegExpForPackageNameMatching = $newNativeFunction(
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
  builtinDisabled: $newNativeFunction("shell_body.rs", "TestingAPIs.disabledOnThisPlatform", 1),
};

export const subprocessInternals = {
  injectStdioReadError: $newNativeFunction("subprocess.rs", "TestingAPIs.injectStdioReadError", 2) as (
    subprocess: import("bun").Subprocess,
    kind: "stdout" | "stderr",
  ) => boolean,
};

export const iniInternals = {
  parse: $newNativeFunction("ini_jsc.rs", "IniTestingAPIs.parse", 1),
  loadNpmrc: $newNativeFunction("ini_jsc.rs", "IniTestingAPIs.loadNpmrcFromJS", 2),
};

export const cssInternals = {
  minifyTestWithOptions: $newNativeFunction("css_internals.rs", "minifyTestWithOptions", 3),
  minifyErrorTestWithOptions: $newNativeFunction("css_internals.rs", "minifyErrorTestWithOptions", 3),
  testWithOptions: $newNativeFunction("css_internals.rs", "testWithOptions", 3),
  prefixTestWithOptions: $newNativeFunction("css_internals.rs", "prefixTestWithOptions", 3),
  minifyTest: $newNativeFunction("css_internals.rs", "minifyTest", 3),
  prefixTest: $newNativeFunction("css_internals.rs", "prefixTest", 3),
  _test: $newNativeFunction("css_internals.rs", "_test", 3),
  attrTest: $newNativeFunction("css_internals.rs", "attrTest", 3),
};

export const crash_handler = $native("crash_handler_jsc.rs", "js_bindings.generate") as {
  getMachOImageZeroOffset: () => number;
  segfault: () => void;
  panic: () => void;
  rootError: () => void;
  outOfMemory: () => void;
  raiseIgnoringPanicHandler: () => void;
};

export const upgrade_test_helpers = $native("upgrade_command.rs", "upgrade_js_bindings.generate") as {
  openTempDirWithoutSharingDelete: () => void;
  closeTempDirHandle: () => void;
};

export const install_test_helpers = $native("install_binding.rs", "bun_install_js_bindings.generate") as {
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
export const memfd_create: (size: number) => number = $newNativeFunction(
  "node_fs_binding.rs",
  "createMemfdForTesting",
  1,
);

export const createStatsForIno: (ino: bigint, big: boolean) => any = $newNativeFunction(
  "Stat.rs",
  "createStatsForIno",
  2,
);

export const setSyntheticAllocationLimitForTesting: (limit: number) => number = $newNativeFunction(
  "virtual_machine_exports.rs",
  "Bun__setSyntheticAllocationLimitForTesting",
  1,
);

export const npm_manifest_test_helpers = $native("npm.rs", "PackageManifest.bindings.generate") as {
  /**
   * Returns the parsed manifest file. Currently only returns an array of available versions.
   */
  parseManifest: (manifestFileName: string, registryUrl: string) => any;
};

// Like npm-package-arg, sort of https://www.npmjs.com/package/npm-package-arg
export type Dependency = any;
export const npa: (name: string) => Dependency = $newNativeFunction("dependency.rs", "fromJS", 1);

export const npmTag: (
  name: string,
) => undefined | "npm" | "dist_tag" | "tarball" | "folder" | "symlink" | "workspace" | "git" | "github" =
  $newNativeFunction("dependency.rs", "Version.Tag.inferFromJS", 1);

export const readTarball: (tarball: string) => any = $newNativeFunction("pack_command.rs", "bindings.jsReadTarball", 1);

export const isArchitectureMatch: (architecture: string[]) => boolean = $newNativeFunction(
  "npm.rs",
  "Architecture.jsFunctionArchitectureIsMatch",
  1,
);

export const isOperatingSystemMatch: (operatingSystem: string[]) => boolean = $newNativeFunction(
  "npm.rs",
  "OperatingSystem.jsFunctionOperatingSystemIsMatch",
  1,
);

export const createSocketPair: () => [number, number] = $newNativeFunction("socket_body.rs", "jsCreateSocketPair", 0);

export const isModuleResolveFilenameSlowPathEnabled: () => boolean = $newCppFunction(
  "NodeModuleModule.cpp",
  "jsFunctionIsModuleResolveFilenameSlowPathEnabled",
  0,
);

export const frameworkRouterInternals = $native("FrameworkRouter.rs", "JSFrameworkRouter.getBindings") as {
  parseRoutePattern: (style: string, pattern: string) => null | { kind: string; pattern: string };
  FrameworkRouter: {
    new (opts: any): any;
  };
};

export const bindgen = $native("bindgen_test.rs", "getBindgenTestFunctions") as {
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
};

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
  timerClockMs: $newNativeFunction("runtime/timer/Timer.rs", "internal_bindings.timerClockMs", 0),
};

export const decodeURIComponentSIMD = $newCppFunction(
  "decodeURIComponentSIMD.cpp",
  "jsFunctionDecodeURIComponentSIMD",
  1,
);

export const getDevServerDeinitCount = $bindgenFn("DevServer.bind.ts", "getDeinitCountForTesting");
export const getCounters = $newNativeFunction("Counters.rs", "createCountersObject", 0);
export const linearFifoOrderedRemoveProbe = $newNativeFunction(
  "collections/linear_fifo.rs",
  "TestingAPIs.orderedRemoveProbe",
  1,
) as (scenario: number) => number[];
export const hasNonReifiedStatic = $newCppFunction("InternalForTesting.cpp", "jsFunction_hasReifiedStatic", 1);

interface setSocketOptionsFn {
  (socket: Bun.Socket, sendBuffer: 1, size: number): void;
  (socket: Bun.Socket, recvBuffer: 2, size: number): void;
}

export const setSocketOptions: setSocketOptionsFn = $newNativeFunction("socket_body.rs", "jsSetSocketOptions", 3);
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

export const getEventLoopStats: () => { activeTasks: number; concurrentRef: number; numPolls: number } =
  $newNativeFunction("event_loop.rs", "getActiveTasks", 0);

export const hostedGitInfo = {
  parseUrl: $newNativeFunction("hosted_git_info.rs", "TestingAPIs.jsParseUrl", 1),
  fromUrl: $newNativeFunction("hosted_git_info.rs", "TestingAPIs.jsFromUrl", 1),
};

export const translateUVErrorToE: (code: number) => string | undefined = $newNativeFunction(
  "sys/Error.rs",
  "TestingAPIs.translateUVErrorToE",
  1,
);

export const translateNtStatusToE: (status: number) => string | undefined = $newNativeFunction(
  "sys/Error.rs",
  "TestingAPIs.translateNtStatusToE",
  1,
);

export const sysErrorNameFromLibuv: (errno: number) => string | undefined = $newNativeFunction(
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
    } = $newNativeFunction("sys/Error.rs", "TestingAPIs.sigactionLayout", 0);

export const stringsInternals = {
  /**
   * Calls `bun.strings.toUTF16AllocForReal(allocator, bytes, false, true)` and
   * returns the resulting UTF-16 data as a JS string. The `sentinel = true`
   * path is otherwise only reachable from Windows `bun build --compile`
   * metadata, so this binding lets us exercise it on all platforms.
   */
  toUTF16AllocSentinel: $newNativeFunction(
    "bun_core/string/immutable/unicode.rs",
    "TestingAPIs.toUTF16AllocSentinel",
    1,
  ) as (bytes: Uint8Array) => string,
};

export const fetchH2Internals = {
  liveCounts: $newNativeFunction("http/H2Client.rs", "TestingAPIs.liveCounts", 0) as () => {
    sessions: number;
    streams: number;
  },
};

export const fetchH3Internals = {
  liveCounts: $newNativeFunction("http/H3Client.rs", "TestingAPIs.quicLiveCounts", 0) as () => {
    sessions: number;
    streams: number;
  },
};

export const fileSinkInternals = {
  liveCount: $newNativeFunction("runtime/webcore/FileSink.rs", "TestingAPIs.fileSinkLiveCount", 0) as () => number,
};
