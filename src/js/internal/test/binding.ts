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

// Transcription of nghttp2's `nghttp2_strerror`, which is what Node's binding
// returns here. Bun's engine emits only a few of these codes; those carry the
// same messages (kNghttp2ErrorMessages in node/http2.ts).
const nghttp2ErrorMessages: Record<number, string> = {
  [0]: "Success",
  [-501]: "Invalid argument",
  [-502]: "Out of buffer space",
  [-503]: "Unsupported SPDY version",
  [-504]: "Operation would block",
  [-505]: "Protocol error",
  [-506]: "Invalid frame octets",
  [-507]: "EOF",
  [-508]: "Data transfer deferred",
  [-509]: "No more Stream ID available",
  [-510]: "Stream was already closed or invalid",
  [-511]: "Stream is closing",
  [-512]: "The transmission is not allowed for this stream",
  [-513]: "Stream ID is invalid",
  [-514]: "Invalid stream state",
  [-515]: "Another DATA frame has already been deferred",
  [-516]: "request HEADERS is not allowed",
  [-517]: "GOAWAY has already been sent",
  [-518]: "Invalid header block",
  [-519]: "Invalid state",
  [-521]: "The user callback function failed due to the temporal error",
  [-522]: "The length of the frame is invalid",
  [-523]: "Header compression/decompression error",
  [-524]: "Flow control error",
  [-525]: "Insufficient buffer size given to function",
  [-526]: "Callback was paused by the application",
  [-527]: "Too many inflight SETTINGS",
  [-528]: "Server push is disabled by peer",
  [-529]: "DATA or HEADERS frame has already been submitted for the stream",
  [-530]: "The current session is closing",
  [-531]: "Invalid HTTP header field was received",
  [-532]: "Violation in HTTP messaging rule",
  [-533]: "Stream was refused",
  [-534]: "Internal error",
  [-535]: "Cancel",
  [-536]: "When a local endpoint expects to receive SETTINGS frame, it receives an other type of frame",
  [-537]: "SETTINGS frame contained more than the maximum allowed entries",
  [-901]: "Out of memory",
  [-902]: "The user callback function failed",
  [-903]: "Received bad client magic byte string",
  [-904]: "Flooding was detected in this HTTP/2 session, and it must be closed",
  [-905]: "Too many CONTINUATION frames following a HEADER frame",
};

function nghttp2ErrorString(code: number) {
  return nghttp2ErrorMessages[code] || "Unknown error code";
}

// Node's `internalBinding('http2')` exposes the native handle classes beneath
// Http2Session/Http2Stream; Bun drives the Rust engine directly and has no such
// layer. These stand-ins give tests that stub a handle method something inert.
class Http2Session {}
class Http2Stream {}

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
    // The constants table is the very same one node:http2 exposes publicly, so
    // the vendored tests check Bun's real values.
    case "http2":
      return {
        Http2Session,
        Http2Stream,
        constants: require("node:http2").constants,
        nghttp2ErrorString,
      };
    case "udp_wrap":
      return { UDP: require("internal/dgram").UDP };
    case "tcp_wrap":
      return { TCP: TestTCPWrap, constants: { SOCKET: 0, SERVER: 1 } };
    default:
      throw new Error(`internalBinding("${name}") is not implemented in Bun`);
  }
}

export default { internalBinding };
