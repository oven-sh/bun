// `require('internal/test/binding')` — Node.js-internal testing shim used by
// the vendored node test suite. Resolution is gated like
// `bun:internal-for-testing`: release builds require `--expose-internals`
// (or BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING); debug builds always allow it.
// See HardcodedModule::InternalTestBinding.

const agent = require("internal/trace_events");

const newRawSocketFd = $newRustFunction("udp_socket.rs", "jsDgramNewSocketFd", 2);
const listenRawFd = $newRustFunction("udp_socket.rs", "jsDgramListenFd", 1);
const closeRawFd = $newRustFunction("udp_socket.rs", "jsDgramCloseFd", 1);

let cachedTcpWrapBinding: any;

// Node's internalBinding('tcp_wrap').TCP for the vendored tests, over
// Bun.listen/Bun.connect (which bind synchronously, like uv_tcp_bind). Two
// deviations from libuv, both invisible to the tests: bind() also starts
// listening (uSockets has no separate bind step), and the constructor keeps
// the raw-fd path the vendored dgram tests use to produce a stream descriptor
// (`handle.fd` + zero-argument `listen()`).
function getTcpWrapBinding() {
  if (cachedTcpWrapBinding !== undefined) return cachedTcpWrapBinding;
  const { UV_EINVAL, UV_EOF } = process.binding("uv") as Record<string, number>;
  const kAccepted = Symbol("accepted");

  class TCPConnectWrap {}

  class TCP {
    #fd = -1;
    #listener: any = null;
    #socket: any = null;
    #bound = false;
    #boundIPv6 = false;
    #reading = false;
    #queued: Array<Uint8Array | null> = []; // null = EOF
    #eofDelivered = false;
    onconnection: any;
    onread: any;
    writeQueueSize = 0;

    constructor(type: unknown) {
      if (type === kAccepted) return;
      this.#fd = newRawSocketFd(false, true);
    }

    get fd() {
      return this.#fd;
    }

    // Shared per-socket event handlers; the owning wrap travels in socket.data.
    static #handlers = {
      data(socket: any, buffer: Uint8Array) {
        (socket.data as TCP)?.#onData(buffer);
      },
      end(socket: any) {
        (socket.data as TCP)?.#onEOF();
      },
      close(socket: any) {
        (socket.data as TCP)?.#onEOF();
      },
      error() {},
      drain() {},
    };

    #onData(buffer: Uint8Array) {
      if (this.#reading && typeof this.onread === "function") this.#deliver(buffer);
      else this.#queued.push(new Uint8Array(buffer.slice().buffer));
    }

    #onEOF() {
      if (this.#eofDelivered) return;
      if (this.#reading && typeof this.onread === "function") this.#deliverEOF();
      else this.#queued.push(null);
    }

    // EmitRead: a fresh ArrayBuffer sized exactly to the chunk, reported
    // through the shared streamBaseState array.
    #deliver(view: Uint8Array) {
      const copy = new Uint8Array(view.byteLength);
      copy.set(view);
      streamBaseState[kReadBytesOrError] = copy.byteLength;
      streamBaseState[kArrayBufferOffset] = 0;
      this.onread(copy.buffer);
    }

    #deliverEOF() {
      if (this.#eofDelivered) return;
      this.#eofDelivered = true;
      streamBaseState[kReadBytesOrError] = UV_EOF;
      this.onread();
    }

    #bind(addr: string, port: number, ipv6: boolean) {
      if (this.#bound) return UV_EINVAL;
      try {
        this.#listener = Bun.listen({
          hostname: addr,
          port: port >>> 0,
          allowHalfOpen: true,
          socket: {
            open: (socket: any) => {
              const client = new TCP(kAccepted);
              client.#socket = socket;
              socket.data = client;
              if (typeof this.onconnection === "function") this.onconnection(0, client);
              else socket.end();
            },
            ...TCP.#handlers,
          },
        });
        this.#bound = true;
        this.#boundIPv6 = ipv6;
        return 0;
      } catch (err) {
        return typeof err?.errno === "number" && err.errno < 0 ? err.errno : UV_EINVAL;
      }
    }

    bind(addr: string, port: number) {
      return this.#bind(addr, port, false);
    }

    bind6(addr: string, port: number) {
      return this.#bind(addr, port, true);
    }

    getsockname(out: Record<string, unknown>) {
      const listener = this.#listener;
      if (listener !== null) {
        out.address = listener.hostname;
        out.family = this.#boundIPv6 ? "IPv6" : "IPv4";
        out.port = listener.port;
        return 0;
      }
      const socket = this.#socket;
      if (socket !== null) {
        out.address = socket.localAddress;
        out.family = typeof socket.localAddress === "string" && socket.localAddress.includes(":") ? "IPv6" : "IPv4";
        out.port = socket.localPort;
        return 0;
      }
      return UV_EINVAL;
    }

    listen(backlog?: number) {
      if (this.#bound) {
        // Already listening: Bun.listen has no separate bind step.
        return 0;
      }
      // Raw-fd path (vendored dgram tests): produce a listening stream fd.
      try {
        listenRawFd(this.#fd);
        return 0;
      } catch (err) {
        return typeof err?.errno === "number" && err.errno < 0 ? err.errno : -1;
      }
    }

    connect(req: any, addr: string, port: number) {
      const self = this;
      Bun.connect({
        hostname: addr,
        port: port >>> 0,
        allowHalfOpen: true,
        socket: {
          open(socket: any) {
            socket.data = self;
          },
          ...TCP.#handlers,
        },
      }).then(
        function onConnect(socket: any) {
          self.#socket = socket;
          socket.data = self;
          if (typeof req.oncomplete === "function") req.oncomplete(0, self, req, true, true);
        },
        function onConnectError(err: any) {
          const status = typeof err?.errno === "number" && err.errno < 0 ? err.errno : -1;
          if (typeof req.oncomplete === "function") req.oncomplete(status, self, req, false, false);
        },
      );
      return 0;
    }

    readStart() {
      this.#reading = true;
      if (typeof this.onread === "function") {
        while (this.#queued.length > 0) {
          const item = this.#queued.shift();
          if (item === null) this.#deliverEOF();
          else this.#deliver(item as Uint8Array);
        }
      }
      return 0;
    }

    readStop() {
      this.#reading = false;
      return 0;
    }

    writeBuffer(req: any, buf: Uint8Array) {
      const socket = this.#socket;
      if (socket === null) return UV_EINVAL;
      const wrote = socket.write(buf);
      streamBaseState[kBytesWritten] = buf.byteLength;
      streamBaseState[kLastWriteWasAsync] = 0;
      // uSockets buffers any short-write remainder internally; the request
      // completes synchronously either way (the test drives the sync path:
      // `if (req.async) ... else process.nextTick(done)`).
      req.async = false;
      return 0;
    }

    shutdown(req: any) {
      const socket = this.#socket;
      if (socket !== null) socket.end();
      const self = this;
      process.nextTick(function shutdownComplete() {
        if (typeof req.oncomplete === "function") req.oncomplete(0, self, undefined);
      });
      return 0;
    }

    ref() {}
    unref() {}

    close(cb?: () => void) {
      if (this.#listener !== null) {
        this.#listener.stop();
        this.#listener = null;
      }
      if (this.#socket !== null) {
        this.#socket.end();
        this.#socket = null;
      }
      if (this.#fd >= 0) {
        closeRawFd(this.#fd);
        this.#fd = -1;
      }
      if (typeof cb === "function") process.nextTick(cb);
    }
  }

  cachedTcpWrapBinding = {
    TCP,
    TCPConnectWrap,
    constants: { SOCKET: 0, SERVER: 1 },
  };
  return cachedTcpWrapBinding;
}

const { isInsideNodeModules } = require("internal/shared");

// ---- StreamBase JS-handle protocol emulation ----------------------------
// Node's internalBinding("stream_wrap") exposes the request classes and the
// shared state array every StreamBase handle reports reads/writes through
// (src/stream_base.h). The vendored stream_wrap/js_stream tests and the
// internal/js_stream_socket shim speak this protocol; the state array is
// shared between this binding and every handle emulation below.
const kReadBytesOrError = 0;
const kArrayBufferOffset = 1;
const kBytesWritten = 2;
const kLastWriteWasAsync = 3;
const streamBaseState = new Int32Array(4);

class WriteWrap {
  handle: unknown = null;
  async = false;
  bytes = 0;
}
class ShutdownWrap {
  handle: unknown = null;
}

function getStreamWrapBinding() {
  return {
    WriteWrap,
    ShutdownWrap,
    streamBaseState,
    kReadBytesOrError,
    kArrayBufferOffset,
    kBytesWritten,
    kLastWriteWasAsync,
  };
}

let cachedJSStreamClass: any;

// Node's JSStream (src/js_stream.cc): a StreamBase handle whose "system" side
// is driven by JS callbacks. Consumers assign onread/onwrite/onreadstart/
// onreadstop/onshutdown/isClosing on the instance; readBuffer()/emitEOF()/
// finishWrite()/finishShutdown() inject completions. Extends TextEncoder so
// instances stay host objects: the vendored worker tests require
// postMessage(new JSStream()) to be rejected by the structured-clone
// serializer like a real native handle.
function getJSStreamClass() {
  if (cachedJSStreamClass !== undefined) return cachedJSStreamClass;
  const { UV_EOF, UV_EPROTO } = process.binding("uv") as Record<string, number>;

  class JSStream extends TextEncoder {
    readStart() {
      return typeof (this as any).onreadstart === "function" ? (this as any).onreadstart() | 0 : 0;
    }
    readStop() {
      return typeof (this as any).onreadstop === "function" ? (this as any).onreadstop() | 0 : 0;
    }
    shutdown(req) {
      return typeof (this as any).onshutdown === "function" ? (this as any).onshutdown(req) | 0 : 0;
    }
    writeBuffer(req, buf) {
      streamBaseState[kBytesWritten] = buf.byteLength;
      streamBaseState[kLastWriteWasAsync] = 1;
      if (typeof (this as any).onwrite !== "function") return 0;
      try {
        return (this as any).onwrite(req, [buf]) | 0;
      } catch (err) {
        // Node's C++ DoWrite: a throwing onwrite surfaces as an uncaught
        // exception while the write itself fails with UV_EPROTO.
        process.nextTick(() => {
          throw err;
        });
        return UV_EPROTO;
      }
    }
    // EmitRead: a fresh copy sized exactly to the chunk, reported through the
    // shared state array (JSStream::ReadBuffer EmitAllocs per read).
    readBuffer(buf) {
      const view = ArrayBuffer.isView(buf) ? (buf as Uint8Array) : new Uint8Array(buf);
      const copy = new Uint8Array(view.byteLength);
      copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      streamBaseState[kReadBytesOrError] = copy.byteLength;
      streamBaseState[kArrayBufferOffset] = 0;
      if (typeof (this as any).onread === "function") (this as any).onread(copy.buffer);
    }
    emitEOF() {
      streamBaseState[kReadBytesOrError] = UV_EOF;
      if (typeof (this as any).onread === "function") (this as any).onread();
    }
    finishWrite(req, errCode) {
      if (req != null && typeof req.oncomplete === "function") req.oncomplete(errCode, this, undefined);
    }
    finishShutdown(req, errCode) {
      if (req != null && typeof req.oncomplete === "function") req.oncomplete(errCode, this, undefined);
    }
    close(cb) {
      if (typeof cb === "function") process.nextTick(cb);
    }
  }
  cachedJSStreamClass = JSStream;
  return cachedJSStreamClass;
}

let cachedHttp2Binding: any;

// Node's internalBinding("http2") exposes the native handle classes that sit
// beneath the JS-level Http2Session/Http2Stream; several vendored tests stub
// methods on those prototypes to inject nghttp2 error codes into the JS layer.
// Bun's node:http2 drives its Rust engine directly and has no handle layer, so
// the first internalBinding("http2") call wraps the real node:http2 entry
// points that node routes through the handle (request/respond/info/
// pushPromise) to consult these stand-in prototypes at call time, replicating
// node's error dispatch (lib/internal/http2/core.js) when a stub returns a
// code. With nothing stubbed on the prototypes every wrapper falls through to
// the real implementation.
function getHttp2Binding() {
  if (cachedHttp2Binding !== undefined) return cachedHttp2Binding;
  const http2 = require("node:http2");
  const constants = http2.constants;
  const internals = http2[Symbol.for("::bunhttp2internals::")];
  const { ClientHttp2Session, ClientHttp2Stream, ServerHttp2Stream } = internals.core;
  const { NghttpError, nghttp2ErrorString, createPendingStreamCancelError } = internals.util;
  const { validateFunction } = require("internal/validators");

  const {
    NGHTTP2_ERR_STREAM_ID_NOT_AVAILABLE,
    NGHTTP2_ERR_INVALID_ARGUMENT,
    NGHTTP2_ERR_STREAM_CLOSED,
    NGHTTP2_INTERNAL_ERROR,
    NGHTTP2_DEFAULT_WEIGHT,
  } = constants;

  // Handle stand-ins: prototypes start empty so a wrapper can tell "stubbed by
  // the test" (own function) apart from "untouched" (undefined).
  class Http2Session {}
  class Http2Stream {}

  // ERR_HTTP2_STREAM_SELF_DEPENDENCY is not in the native error-code registry
  // (positional and shared across Rust/C++/the JS bundle); construct the
  // node-shaped error directly, like http2.ts does for ERR_HTTP2_STREAM_CANCEL.
  function streamSelfDependencyError() {
    const err = new Error("A stream cannot depend on itself");
    (err as Error & { code: string }).code = "ERR_HTTP2_STREAM_SELF_DEPENDENCY";
    return err;
  }

  // node's requestOnConnect: the handle request() returns either a stream
  // handle or an nghttp2 error code, dispatched once the session is connected.
  const realRequest = ClientHttp2Session.prototype.request;
  ClientHttp2Session.prototype.request = function request(headers, options) {
    const mock = Http2Session.prototype.request;
    if (typeof mock !== "function") return realRequest.$call(this, headers, options);
    const session = this;
    // Mirrors the early-reject paths of the real request(): an id-less stream
    // that never reaches the wire.
    const req = new ClientHttp2Stream(undefined, session, headers ? { ...headers } : {});
    function dispatch() {
      if (session.destroyed || req.destroyed) return;
      const ret = mock.$call(undefined, undefined, 0, options?.parent | 0, NGHTTP2_DEFAULT_WEIGHT, !!options?.exclusive);
      if (typeof ret !== "number") return;
      switch (ret) {
        case NGHTTP2_ERR_STREAM_ID_NOT_AVAILABLE:
          req.destroy($ERR_HTTP2_OUT_OF_STREAMS());
          break;
        case NGHTTP2_ERR_INVALID_ARGUMENT:
          req.destroy(streamSelfDependencyError());
          break;
        default: {
          const err = new NghttpError(ret);
          session.destroy(err);
          // node's closeSession cancels the pending stream created above with
          // the session error as the cause.
          if (!req.destroyed) {
            req.rstCode = NGHTTP2_INTERNAL_ERROR;
            req.destroy(createPendingStreamCancelError(err));
          }
        }
      }
    }
    if (session.connecting) session.once("connect", dispatch);
    else process.nextTick(dispatch);
    return req;
  };

  const realRespond = ServerHttp2Stream.prototype.respond;
  ServerHttp2Stream.prototype.respond = function respond(headers, options) {
    const mock = Http2Stream.prototype.respond;
    if (typeof mock !== "function") return realRespond.$call(this, headers, options);
    if (this.destroyed || this.session === undefined) throw $ERR_HTTP2_INVALID_STREAM();
    if (this.headersSent) throw $ERR_HTTP2_HEADERS_SENT();
    this.headersSent = true;
    const ret = mock.$call(undefined, undefined, 0);
    if (typeof ret === "number" && ret < 0) this.destroy(new NghttpError(ret));
  };

  const realRespondWithFile = ServerHttp2Stream.prototype.respondWithFile;
  ServerHttp2Stream.prototype.respondWithFile = function respondWithFile(path, headers, options) {
    const mock = Http2Stream.prototype.respond;
    if (typeof mock !== "function") return realRespondWithFile.$call(this, path, headers, options);
    if (this.destroyed || this.session === undefined) throw $ERR_HTTP2_INVALID_STREAM();
    if (this.headersSent) throw $ERR_HTTP2_HEADERS_SENT();
    const self = this;
    // node consults the handle from the fs.open callback (processRespondWithFD).
    process.nextTick(function dispatchRespondWithFile() {
      if (self.destroyed) return;
      self.headersSent = true;
      const ret = mock.$call(undefined, undefined, 0);
      if (typeof ret === "number" && ret < 0) self.destroy(new NghttpError(ret));
    });
  };

  const realAdditionalHeaders = ServerHttp2Stream.prototype.additionalHeaders;
  ServerHttp2Stream.prototype.additionalHeaders = function additionalHeaders(headers) {
    const mock = Http2Stream.prototype.info;
    if (typeof mock !== "function") return realAdditionalHeaders.$call(this, headers);
    if (this.destroyed || this.closed || this.session === undefined) throw $ERR_HTTP2_INVALID_STREAM();
    if (this.headersSent) throw $ERR_HTTP2_HEADERS_AFTER_RESPOND();
    const ret = mock.$call(undefined, undefined);
    if (typeof ret === "number" && ret < 0) this.destroy(new NghttpError(ret));
  };

  const realPushStream = ServerHttp2Stream.prototype.pushStream;
  ServerHttp2Stream.prototype.pushStream = function pushStream(headers, options, callback) {
    const mock = Http2Stream.prototype.pushPromise;
    if (typeof mock !== "function") return realPushStream.$call(this, headers, options, callback);
    if (typeof options === "function") {
      callback = options;
      options = undefined;
    }
    validateFunction(callback, "callback");
    const ret = mock.$call(undefined, undefined, 0);
    if (typeof ret === "number") {
      let err;
      switch (ret) {
        case NGHTTP2_ERR_STREAM_ID_NOT_AVAILABLE:
          err = $ERR_HTTP2_OUT_OF_STREAMS();
          break;
        case NGHTTP2_ERR_STREAM_CLOSED:
          err = $ERR_HTTP2_INVALID_STREAM();
          break;
        default:
          err = new NghttpError(ret);
          break;
      }
      process.nextTick(callback, err);
    }
  };

  // The shared state arrays node's binding exposes (node_http2_state.h);
  // internal/http2/util.js destructures all four at module load.
  const settingsBuffer = new Float64Array(8 + 1 + 2 * 10); // IDX_SETTINGS_COUNT + custom-length slot + MAX_ADDITIONAL_SETTINGS pairs
  const optionsBuffer = new Float64Array(14); // IDX_OPTIONS_FLAGS + 1
  const sessionState = new Float64Array(9);
  const streamState = new Float64Array(6);

  // Http2Settings::RefreshDefaults: every settable default plus its flag bit.
  function refreshDefaultSettings() {
    settingsBuffer[0] = 4096; // header table size
    settingsBuffer[1] = 1; // enable push
    settingsBuffer[2] = 65535; // initial window size
    settingsBuffer[3] = 16384; // max frame size
    settingsBuffer[4] = 4294967295; // max concurrent streams
    settingsBuffer[5] = 65535; // max header list size
    settingsBuffer[6] = 0; // enable connect protocol
    settingsBuffer[7] = 0b1111111; // IDX_SETTINGS_FLAGS
    settingsBuffer[8] = 0; // no additional settings
  }

  cachedHttp2Binding = {
    Http2Session,
    Http2Stream,
    // The very same table node:http2 exposes publicly, so the vendored tests
    // check Bun's real values.
    constants,
    nghttp2ErrorString,
    settingsBuffer,
    optionsBuffer,
    sessionState,
    streamState,
    refreshDefaultSettings,
  };
  return cachedHttp2Binding;
}

function safeGetenv(name: string) {
  return process.env[name];
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
    case "http2":
      return getHttp2Binding();
    case "udp_wrap":
      return { UDP: require("internal/dgram").UDP };
    case "tcp_wrap":
      return getTcpWrapBinding();
    // Just what vendored modules destructure at load; Bun always builds with ICU.
    case "config":
      return { hasIntl: true };
    // node's C++ encoding binding, backed by the runtime's own encoders.
    case "encoding_binding": {
      const utf8Encoder = new TextEncoder();
      const encodeIntoResults = new Uint32Array(2);
      return {
        encodeInto(source: string, dest: Uint8Array) {
          const { read, written } = utf8Encoder.encodeInto(source, dest);
          encodeIntoResults[0] = read;
          encodeIntoResults[1] = written;
        },
        encodeIntoResults,
        encodeUtf8String(source: string) {
          return utf8Encoder.encode(source);
        },
        decodeUTF8(input: ArrayBufferView, ignoreBOM: boolean, fatal: boolean) {
          return new TextDecoder("utf-8", { ignoreBOM, fatal }).decode(input);
        },
      };
    }
    case "util":
      return {
        isInsideNodeModules,
        // node's util binding exposes engine-private symbols; vendored
        // internal/errors.js stores its arrow message under this one.
        privateSymbols: { arrow_message_private_symbol: Symbol("node:arrowMessage") },
      };
    // Vendored tls engine tests construct binding.SecureContext (or replace it)
    // before requiring node:tls; Bun's SecureContext class is the equivalent
    // native surface.
    case "crypto":
      return { SecureContext: require("node:tls").SecureContext };
    // BoringSSL does not compile in OpenSSL's SSL_trace(), so a Node built
    // against it reports HAVE_SSL_TRACE = false; --trace-tls tests skip.
    case "tls_wrap":
      return { HAVE_SSL_TRACE: false };
    case "worker":
      // node's env message port is the thread's control channel to its parent;
      // bun's equivalent is the port to the main-thread messaging hub.
      return { getEnvMessagePort: require("internal/worker/messaging").getMainThreadPort };
    case "js_stream":
      return { JSStream: getJSStreamClass() };
    case "stream_wrap":
      return getStreamWrapBinding();
    case "fs": {
      // Just writeBuffer (internal/net's module-level destructure); node's
      // binding fills `ctx` on failure instead of throwing.
      const { writeSync } = require("node:fs");
      return {
        writeBuffer(fd: number, buffer: Uint8Array, offset: number, length: number, position: number | null, ctx: any) {
          try {
            return writeSync(fd, buffer, offset, length, position);
          } catch (err: any) {
            ctx.errno = err.errno;
            ctx.syscall = err.syscall;
            ctx.code = err.code;
            ctx.message = err.message;
            return 0;
          }
        },
      };
    }
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
