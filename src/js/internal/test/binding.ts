// `require('internal/test/binding')` — Node.js-internal testing shim used by
// the vendored node test suite. Resolution is gated like
// `bun:internal-for-testing`: release builds require `--expose-internals`
// (or BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING); debug builds always allow it.
// See HardcodedModule::InternalTestBinding.

const agent = require("internal/trace_events");

const newRawSocketFd = $newRustFunction("udp_socket.rs", "jsDgramNewSocketFd", 2);
const listenRawFd = $newRustFunction("udp_socket.rs", "jsDgramListenFd", 1);
const closeRawFd = $newRustFunction("udp_socket.rs", "jsDgramCloseFd", 1);

// Just enough of internalBinding('tcp_wrap').TCP for vendored dgram tests to
// produce a listening stream descriptor and assert it gets rejected.
class TestTCPWrap {
  #fd = -1;

  constructor(_type: number) {
    this.#fd = newRawSocketFd(false, true);
  }

  get fd() {
    return this.#fd;
  }

  listen() {
    try {
      listenRawFd(this.#fd);
      return 0;
    } catch (err) {
      return typeof err?.errno === "number" && err.errno < 0 ? err.errno : -1;
    }
  }

  close() {
    if (this.#fd >= 0) {
      closeRawFd(this.#fd);
      this.#fd = -1;
    }
  }
}

// node's internalBinding('util').isInsideNodeModules: walk the call stack via
// Error.prepareStackTrace CallSites and test the first frame that carries a
// real user filename (skipping node:/internal:/native frames).
function safeGetenv(name: string) {
  return process.env[name];
}

function returnStackFrames(_err: unknown, frames: unknown[]) {
  return frames;
}

function isInsideNodeModules() {
  const oldPrepareStackTrace = Error.prepareStackTrace;
  const oldStackTraceLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = Infinity;
  Error.prepareStackTrace = returnStackFrames;
  const target: { stack?: unknown } = {};
  Error.captureStackTrace(target, isInsideNodeModules);
  const frames = target.stack as { getFileName(): string | null }[];
  Error.prepareStackTrace = oldPrepareStackTrace;
  Error.stackTraceLimit = oldStackTraceLimit;
  for (const frame of frames) {
    const filename = frame.getFileName();
    if (!filename || filename.startsWith("node:") || filename.startsWith("internal:") || filename === "native") {
      continue;
    }
    return /[\\/]node_modules[\\/]/.test(filename);
  }
  return false;
}

let cachedUvBinding: Record<string, unknown> | undefined;

function internalBinding(name: string) {
  switch (name) {
    case "trace_events":
      return {
        trace: agent.trace,
        isTraceCategoryEnabled: agent.isTraceCategoryEnabled,
        getCategoryEnabledBuffer: agent.getCategoryEnabledBuffer,
      };
    case "constants":
      // The real thing: os/fs/crypto/zlib/trace sections, same object node's
      // internalBinding("constants") exposes (ProcessBindingConstants.cpp).
      return $processBindingConstants;
    case "uv": {
      // process.binding("uv") carries libuv's own codes on every platform
      // (including Windows' synthetic ones), same as node's uv binding —
      // but not getErrorMessage, which node's binding also exposes. Derive
      // it from the same native uv_e table (util.getSystemErrorMap) so the
      // messages can never diverge. Cached: node returns a stable object.
      if (cachedUvBinding === undefined) {
        const errmap: Map<number, [string, string]> = require("node:util").getSystemErrorMap();
        cachedUvBinding = {
          ...process.binding("uv"),
          getErrorMessage: function getErrorMessage(n: number) {
            const entry = errmap.get(n);
            return entry !== undefined ? entry[1] : `Unknown system error ${n}`;
          },
        };
      }
      return cachedUvBinding;
    }
    // node's credentials binding: without setuid/setgid mismatch handling,
    // safeGetenv degenerates to a plain env read (same as node run normally).
    case "credentials":
      return { safeGetenv };
    case "buffer": {
      const { kMaxLength, kStringMaxLength } = require("node:buffer");
      return { kMaxLength, kStringMaxLength };
    }
    case "udp_wrap":
      return { UDP: require("internal/dgram").UDP };
    case "tcp_wrap":
      return { TCP: TestTCPWrap, constants: { SOCKET: 0, SERVER: 1 } };
    case "util":
      return { isInsideNodeModules };
    // The icu-era binding node exposed until nodejs/node#55156; vendored
    // tests like test-icu-punycode still consume it.
    case "icu": {
      const icu = $cpp("NodeURL.cpp", "Bun::createNodeICUBinding");
      // Node asked ICU's converter registry; answer from the runtime's
      // encoding registry instead.
      icu.hasConverter = function hasConverter(label: string) {
        try {
          new TextDecoder(label);
          return true;
        } catch {
          return false;
        }
      };
      return icu;
    }
    default: {
      const err = new Error(`internalBinding("${name}") is not implemented in Bun`);
      // node reports unknown/restricted bindings with this code.
      (err as Error & { code: string }).code = "ERR_INVALID_MODULE";
      throw err;
    }
  }
}

export default { internalBinding };
