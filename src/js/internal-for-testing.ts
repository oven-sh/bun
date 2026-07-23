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

// node's getStringWidth counts each code point of an emoji ZWJ sequence (family
// emoji = 8) where grapheme-based Bun.stringWidth sees one cluster (= 2); mirror
// node's ICU algorithm (inspect.js wrapper + node_i18n.cc) for the exposed internal.
// node's ansi matcher: Bun.stripANSI also eats bare ESC/CSI + trailing chars.
const nodeAnsiRe = new RegExp(
  "[\\u001B\\u009B][[\\]()#;?]*" +
    "(?:(?:(?:(?:;[-a-zA-Z\\d\\/\\#&.:=?%@~_]+)*" +
    "|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/\\#&.:=?%@~_]*)*)?" +
    "(?:\\u0007|\\u001B\\u005C|\\u009C))" +
    "|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?" +
    "[\\dA-PR-TZcf-nq-uy=><~]))",
  "g",
);
const nodeZeroWidthRe = /[\p{Cc}\p{Cf}\p{Me}\p{Mn}]/u;
const nodeEmojiPresentationRe = /\p{Emoji_Presentation}/u;
const nodeEmojiModifierRe = /\p{Emoji_Modifier}/u;
const nodeUnassignedRe = /\p{Cn}/u;

// East_Asian_Width Fullwidth/Wide ranges, from node's isFullWidthCodePoint.
function isFullWidthCodePoint(code: number): boolean {
  // prettier-ignore
  return code >= 0x1100 && (
    code <= 0x115f ||  // Hangul Jamo
    code === 0x2329 || // LEFT-POINTING ANGLE BRACKET
    code === 0x232a || // RIGHT-POINTING ANGLE BRACKET
    // CJK Radicals Supplement .. Enclosed CJK Letters and Months
    (code >= 0x2e80 && code <= 0x3247 && code !== 0x303f) ||
    // Enclosed CJK Letters and Months .. CJK Unified Ideographs Extension A
    (code >= 0x3250 && code <= 0x4dbf) ||
    // CJK Unified Ideographs .. Yi Radicals
    (code >= 0x4e00 && code <= 0xa4c6) ||
    // Hangul Jamo Extended-A
    (code >= 0xa960 && code <= 0xa97c) ||
    // Hangul Syllables
    (code >= 0xac00 && code <= 0xd7a3) ||
    // CJK Compatibility Ideographs
    (code >= 0xf900 && code <= 0xfaff) ||
    // Vertical Forms
    (code >= 0xfe10 && code <= 0xfe19) ||
    // CJK Compatibility Forms .. Small Form Variants
    (code >= 0xfe30 && code <= 0xfe6b) ||
    // Halfwidth and Fullwidth Forms
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    // Kana Supplement
    (code >= 0x1b000 && code <= 0x1b001) ||
    // Enclosed Ideographic Supplement
    (code >= 0x1f200 && code <= 0x1f251) ||
    // Miscellaneous Symbols and Pictographs .. Emoticons
    (code >= 0x1f300 && code <= 0x1f64f) ||
    // CJK Unified Ideographs Extension B .. Tertiary Ideographic Plane
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

// node's GetColumnWidth with ambiguous_as_full_width=false: EAW first, then
// Emoji_Presentation, then the Cc/Cf/Me/Mn + Emoji_Modifier zero-width check.
function nodeGetColumnWidth(char: string, code: number): number {
  if (isFullWidthCodePoint(code) && !nodeUnassignedRe.test(char)) {
    return 2;
  }
  if (nodeEmojiPresentationRe.test(char)) {
    return 2;
  }
  if (code !== 0x00ad && (nodeZeroWidthRe.test(char) || nodeEmojiModifierRe.test(char))) {
    return 0;
  }
  return 1;
}

function nodeGetStringWidth(str: string, removeControlChars: boolean = true): number {
  let width = 0;
  if (removeControlChars) {
    str = str.replace(nodeAnsiRe, "");
  }
  for (let i = 0; i < str.length; i++) {
    // ASCII fast path, as in node's ICU-mode wrapper.
    const code = str.charCodeAt(i);
    if (code >= 127) {
      const rest: string = str.slice(i).normalize("NFC");
      for (const char of rest) {
        width += nodeGetColumnWidth(char, char.codePointAt(0)!);
      }
      break;
    }
    width += code >= 32 ? 1 : 0;
  }
  return width;
}

// node lib/internal/util.js normalizeEncoding: nullish and '' mean utf8, and
// non-strings are undefined; Bun's Rust binding does not fold 'utf-16le',
// so the node edge cases are handled here.
const rustNormalizeEncoding = $newRustFunction("node_util_binding.rs", "normalizeEncoding", 1);
const nodeKEmptyObject = require("internal/shared").kEmptyObject;
function nodeNormalizeEncoding(enc) {
  if (enc == null) return "utf8";
  if (typeof enc !== "string") return undefined;
  const lower = enc.toLowerCase();
  if (lower === "utf-16le") return "utf16le";
  // The Rust map also accepts Buffer-only names node's normalizeEncoding rejects.
  if (lower === "buffer" || lower === "utf16-le") return undefined;
  return rustNormalizeEncoding(enc);
}

// Verbatim from node lib/internal/util.js (countBinaryOnes/getCIDR).
function countBinaryOnes(n) {
  // Count the number of bits set in parallel, which is faster than looping
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0xf0f0f0f) * 0x1010101) >>> 24;
}

function getCIDR(address, netmask, family) {
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
  #ref;
  #strong = null;
  #refCount = 0;
  constructor(object) {
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

function nodeGetValidStdio(stdio, sync?) {
  const { isArrayBufferView } = require("node:util/types");
  let ipc;
  let ipcFd;

  if (typeof stdio === "string") {
    stdio = stdioStringToArray(stdio);
  } else if (!Array.isArray(stdio)) {
    throw $ERR_INVALID_ARG_VALUE("stdio", stdio);
  }

  while (stdio.length < 3) stdio.push(undefined);

  stdio = stdio.reduce(function reduceStdioEntry(acc, stdio, i) {
    function cleanup() {
      for (let i = 0; i < acc.length; i++) {
        if ((acc[i].type === "pipe" || acc[i].type === "ipc") && acc[i].handle) acc[i].handle.close();
      }
    }

    stdio ??= i < 3 ? "pipe" : "ignore";

    if (stdio === "ignore") {
      acc.push({ type: "ignore" });
    } else if (stdio === "pipe" || stdio === "overlapped" || (typeof stdio === "number" && stdio < 0)) {
      const a: Record<string, unknown> = {
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
  // Bun's real implementations, under the names node's tests import them by.
  "internal/validators": require("internal/validators"),
  "internal/util/inspect": {
    ...require("internal/util/inspect"),
    getStringWidth: nodeGetStringWidth,
  },
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
