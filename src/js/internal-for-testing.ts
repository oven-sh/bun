// Hardcoded module "bun:internal-for-testing"

// If you want to test an internal API, add a binding into this file.
//
// Then at test time: import ... from "bun:internal-for-testing"
//
// In a debug build, the import is always allowed.
// It is disallowed in release builds unless run in Bun's CI.

const fmtBinding = $bindgenFn("fmt_jsc.bind.ts", "fmtString");

export const highlightJavaScript = (code: string) => fmtBinding(code, "highlight-javascript");
export const escapePowershell = (code: string) => fmtBinding(code, "escape-powershell");

export const canonicalizeIP = $newCppFunction("NodeTLS.cpp", "Bun__canonicalizeIP", 1);

export const SQL = $cpp("JSSQLStatement.cpp", "createJSSQLStatementConstructor");

export const patchInternals = {
  parse: $newRustFunction("patch.rust", "TestingAPIs.parse", 1),
  apply: $newRustFunction("patch.rust", "TestingAPIs.apply", 2),
  makeDiff: $newRustFunction("patch.rust", "TestingAPIs.makeDiff", 2),
};

export const internalSourceMap = {
  fromVLQ: $newRustFunction("sourcemap/InternalSourceMap.rust", "TestingAPIs.fromVLQ", 1) as (vlq: string) => Uint8Array,
  toVLQ: $newRustFunction("sourcemap/InternalSourceMap.rust", "TestingAPIs.toVLQ", 1) as (blob: Uint8Array) => string,
  find: $newRustFunction("sourcemap/InternalSourceMap.rust", "TestingAPIs.find", 3) as (
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

const shellLex = $newRustFunction("shell.rust", "TestingAPIs.shellLex", 2);
const shellParse = $newRustFunction("shell.rust", "TestingAPIs.shellParse", 2);

export const sslCtxLiveCount = $newRustFunction("SecureContext.rust", "jsLiveCount", 0);

export const escapeRegExp = $newRustFunction("escapeRegExp.rust", "jsEscapeRegExp", 1);
export const escapeRegExpForPackageNameMatching = $newRustFunction(
  "escapeRegExp.rust",
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
  builtinDisabled: $newRustFunction("shell.rust", "TestingAPIs.disabledOnThisPlatform", 1),
};

export const subprocessInternals = {
  injectStdioReadError: $newRustFunction("subprocess.rust", "TestingAPIs.injectStdioReadError", 2) as (
    subprocess: import("bun").Subprocess,
    kind: "stdout" | "stderr",
  ) => boolean,
};

export const iniInternals = {
  parse: $newRustFunction("ini.rust", "IniTestingAPIs.parse", 1),
  // loadNpmrc: (
  //   src: string,
  //   env?: Record<string, string>,
  // ): {
  //   default_registry_url: string;
  //   default_registry_token: string;
  //   default_registry_username: string;
  //   default_registry_password: string;
  // } => $newRustFunction("ini.rust", "IniTestingAPIs.loadNpmrcFromJS", 2)(src, env),
  loadNpmrc: $newRustFunction("ini.rust", "IniTestingAPIs.loadNpmrcFromJS", 2),
};

export const cssInternals = {
  minifyTestWithOptions: $newRustFunction("css_internals.rust", "minifyTestWithOptions", 3),
  minifyErrorTestWithOptions: $newRustFunction("css_internals.rust", "minifyErrorTestWithOptions", 3),
  testWithOptions: $newRustFunction("css_internals.rust", "testWithOptions", 3),
  prefixTestWithOptions: $newRustFunction("css_internals.rust", "prefixTestWithOptions", 3),
  minifyTest: $newRustFunction("css_internals.rust", "minifyTest", 3),
  prefixTest: $newRustFunction("css_internals.rust", "prefixTest", 3),
  _test: $newRustFunction("css_internals.rust", "_test", 3),
  attrTest: $newRustFunction("css_internals.rust", "attrTest", 3),
};

export const crash_handler = $rust("crash_handler.rust", "js_bindings.generate") as {
  getMachOImageZeroOffset: () => number;
  segfault: () => void;
  panic: () => void;
  rootError: () => void;
  outOfMemory: () => void;
  raiseIgnoringPanicHandler: () => void;
};

export const upgrade_test_helpers = $rust("upgrade_command.rust", "upgrade_js_bindings.generate") as {
  openTempDirWithoutSharingDelete: () => void;
  closeTempDirHandle: () => void;
};

export const install_test_helpers = $rust("install_binding.rust", "bun_install_js_bindings.generate") as {
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
  "node_fs_binding.rust",
  "createMemfdForTesting",
  1,
);

export const createStatsForIno: (ino: bigint, big: boolean) => any = $newRustFunction(
  "Stat.rust",
  "createStatsForIno",
  2,
);

export const setSyntheticAllocationLimitForTesting: (limit: number) => number = $newRustFunction(
  "virtual_machine_exports.rust",
  "Bun__setSyntheticAllocationLimitForTesting",
  1,
);

export const npm_manifest_test_helpers = $rust("npm.rust", "PackageManifest.bindings.generate") as {
  /**
   * Returns the parsed manifest file. Currently only returns an array of available versions.
   */
  parseManifest: (manifestFileName: string, registryUrl: string) => any;
};

// Like npm-package-arg, sort of https://www.npmjs.com/package/npm-package-arg
export type Dependency = any;
export const npa: (name: string) => Dependency = $newRustFunction("dependency.rust", "fromJS", 1);

export const npmTag: (
  name: string,
) => undefined | "npm" | "dist_tag" | "tarball" | "folder" | "symlink" | "workspace" | "git" | "github" =
  $newRustFunction("dependency.rust", "Version.Tag.inferFromJS", 1);

export const readTarball: (tarball: string) => any = $newRustFunction("pack_command.rust", "bindings.jsReadTarball", 1);

export const isArchitectureMatch: (architecture: string[]) => boolean = $newRustFunction(
  "npm.rust",
  "Architecture.jsFunctionArchitectureIsMatch",
  1,
);

export const isOperatingSystemMatch: (operatingSystem: string[]) => boolean = $newRustFunction(
  "npm.rust",
  "OperatingSystem.jsFunctionOperatingSystemIsMatch",
  1,
);

export const createSocketPair: () => [number, number] = $newRustFunction("runtime/socket/socket.rust", "jsCreateSocketPair", 0);

export const isModuleResolveFilenameSlowPathEnabled: () => boolean = $newCppFunction(
  "NodeModuleModule.cpp",
  "jsFunctionIsModuleResolveFilenameSlowPathEnabled",
  0,
);

export const frameworkRouterInternals = $rust("FrameworkRouter.rust", "JSFrameworkRouter.getBindings") as {
  parseRoutePattern: (style: string, pattern: string) => null | { kind: string; pattern: string };
  FrameworkRouter: {
    new (opts: any): any;
  };
};

export const bindgen = $rust("bindgen_test.rust", "getBindgenTestFunctions") as {
  add: (a: any, b: any) => number;
  requiredAndOptionalArg: (a: any, b?: any, c?: any, d?: any) => number;
};

export const noOpForTesting = $cpp("NoOpForTesting.cpp", "createNoOpForTesting");
export const Dequeue = require("internal/fifo");

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
  timerClockMs: $newRustFunction("runtime/timer/Timer.rust", "internal_bindings.timerClockMs", 0),
};

export const decodeURIComponentSIMD = $newCppFunction(
  "decodeURIComponentSIMD.cpp",
  "jsFunctionDecodeURIComponentSIMD",
  1,
);

export const getDevServerDeinitCount = $bindgenFn("DevServer.bind.ts", "getDeinitCountForTesting");
export const getCounters = $newRustFunction("Counters.rust", "createCountersObject", 0);
export const hasNonReifiedStatic = $newCppFunction("InternalForTesting.cpp", "jsFunction_hasReifiedStatic", 1);

interface setSocketOptionsFn {
  (socket: Bun.Socket, sendBuffer: 1, size: number): void;
  (socket: Bun.Socket, recvBuffer: 2, size: number): void;
}

export const setSocketOptions: setSocketOptionsFn = $newRustFunction("runtime/socket/socket.rust", "jsSetSocketOptions", 3);
type SerializationContext = "worker" | "window" | "postMessage" | "default";
export const structuredCloneAdvanced: (
  value: any,
  transferList: any[],
  forTransfer: boolean,
  forStorage: boolean,
  serializationContext: SerializationContext,
) => any = $newCppFunction("StructuredClone.cpp", "jsFunctionStructuredCloneAdvanced", 5);

export const lsanDoLeakCheck = $newCppFunction("InternalForTesting.cpp", "jsFunction_lsanDoLeakCheck", 1);

export const BunString_toThreadSafeRefCountDelta: () => number = $newCppFunction(
  "InternalForTesting.cpp",
  "jsFunction_BunString_toThreadSafeRefCountDelta",
  0,
);

export const getEventLoopStats: () => { activeTasks: number; concurrentRef: number; numPolls: number } =
  $newRustFunction("event_loop.rust", "getActiveTasks", 0);

export const hostedGitInfo = {
  parseUrl: $newRustFunction("hosted_git_info.rust", "TestingAPIs.jsParseUrl", 1),
  fromUrl: $newRustFunction("hosted_git_info.rust", "TestingAPIs.jsFromUrl", 1),
};

export const translateUVErrorToE: (code: number) => string | undefined = $newRustFunction(
  "sys.rust",
  "TestingAPIs.translateUVErrorToE",
  1,
);

export const sysErrorNameFromLibuv: (errno: number) => string | undefined = $newRustFunction(
  "sys/Error.rust",
  "TestingAPIs.sysErrorNameFromLibuv",
  1,
);

export const sigactionLayout: () =>
  | undefined
  | {
      installed: { handler: number; flags: number };
      readback: { handler: number; flags: number };
      sizeof: number;
    } = $newRustFunction("sys.rust", "TestingAPIs.sigactionLayout", 0);

export const stringsInternals = {
  /**
   * Calls `bun.strings.toUTF16AllocForReal(allocator, bytes, false, true)` and
   * returns the resulting UTF-16 data as a JS string. The `sentinel = true`
   * path is otherwise only reachable from Windows `bun build --compile`
   * metadata, so this binding lets us exercise it on all platforms.
   */
  toUTF16AllocSentinel: $newRustFunction("string/immutable/unicode.rust", "TestingAPIs.toUTF16AllocSentinel", 1) as (
    bytes: Uint8Array,
  ) => string,
};

export const fetchH2Internals = {
  liveCounts: $newRustFunction("http/H2Client.rust", "TestingAPIs.liveCounts", 0) as () => {
    sessions: number;
    streams: number;
  },
};

export const fetchH3Internals = {
  liveCounts: $newRustFunction("http/H3Client.rust", "TestingAPIs.quicLiveCounts", 0) as () => {
    sessions: number;
    streams: number;
  },
};

export const fileSinkInternals = {
  liveCount: $newRustFunction("runtime/webcore/FileSink.rust", "TestingAPIs.fileSinkLiveCount", 0) as () => number,
};
