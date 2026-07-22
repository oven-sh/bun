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
function isInsideNodeModules() {
  const oldPrepareStackTrace = Error.prepareStackTrace;
  const oldStackTraceLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = Infinity;
  Error.prepareStackTrace = (_err, frames) => frames;
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

function internalBinding(name: string) {
  switch (name) {
    case "trace_events":
      return {
        trace: agent.trace,
        isTraceCategoryEnabled: agent.isTraceCategoryEnabled,
        getCategoryEnabledBuffer: agent.getCategoryEnabledBuffer,
      };
    case "constants":
      return {
        trace: {
          TRACE_EVENT_PHASE_NESTABLE_ASYNC_BEGIN: 98,
          TRACE_EVENT_PHASE_NESTABLE_ASYNC_END: 101,
        },
      };
    // libuv error codes, the UDP handle wrap, and the minimal TCP wrap the
    // vendored dgram tests consume.
    case "uv": {
      const isWindows = process.platform === "win32";
      const errno = require("node:os").constants.errno;
      return {
        UV_UNKNOWN: -4094,
        UV_EBADF: isWindows ? -4083 : -errno.EBADF,
        UV_EINVAL: isWindows ? -4071 : -errno.EINVAL,
        UV_ENOTSOCK: isWindows ? -4050 : -errno.ENOTSOCK,
      };
    }
    case "udp_wrap":
      return { UDP: require("internal/dgram").UDP };
    case "tcp_wrap":
      return { TCP: TestTCPWrap, constants: { SOCKET: 0, SERVER: 1 } };
    case "util":
      return { isInsideNodeModules };
    default:
      throw new Error(`internalBinding("${name}") is not implemented in Bun`);
  }
}

export default { internalBinding };
