// The implementation of the `node:quic` API.
// Ported from Node.js lib/internal/quic/quic.js (v26.3.0).
/*
 * Portions of this code are derived from the Node.js project (https://nodejs.org/),
 * originally developed by Node.js contributors and Joyent, Inc.
 *
 * Copyright Node.js contributors. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * Modifications were made to the original code.
 */
const { uncurryThis, SafeSet } = require("internal/primordials");
const { inspect, debuglog } = require("node:util");
const { Buffer } = require("node:buffer");
const {
  isArrayBuffer,
  isArrayBufferView,
  isDataView,
  isPromise,
  isSharedArrayBuffer,
  isKeyObject,
} = require("node:util/types");
const { SocketAddress, BlockList } = require("node:net");

// The native binding hands certificates over as DER bytes; expose them as
// X509Certificate objects like Node does.
let X509Certificate;
function wrapCertificate(der) {
  if (der === undefined) return undefined;
  X509Certificate ??= require("node:crypto").X509Certificate;
  return new X509Certificate(Buffer.from(der.buffer ?? der, der.byteOffset ?? 0, der.byteLength));
}

// ----------------------------------------------------------------------------
// Stand-ins for the Node.js primordials used by the original source. The call
// sites below are kept verbatim from upstream; these definitions provide the
// same behavior with values captured at module load time.
const ArrayIsArray = Array.isArray;
const StringPrototypeStartsWith = uncurryThis(String.prototype.startsWith);
const NumberIsInteger = Number.isInteger;
const NumberIsNaN = Number.isNaN;
const ArrayPrototypePush = uncurryThis(Array.prototype.push);
const ErrorCaptureStackTrace = Error.captureStackTrace;
const FunctionPrototypeBind = uncurryThis(Function.prototype.bind);
const ObjectDefineProperties = Object.defineProperties;
const ObjectKeys = Object.keys;
const PromisePrototypeThen = uncurryThis(Promise.prototype.then);
const PromiseResolve = value => Promise.$resolve(value);
const PromiseWithResolvers = () => Promise.withResolvers();
const SymbolAsyncDispose = Symbol.asyncDispose;
const SymbolAsyncIterator = Symbol.asyncIterator;
const SymbolDispose = Symbol.dispose;
const SymbolIterator = Symbol.iterator;
const DataViewPrototypeGetByteLength = uncurryThis(
  Object.getOwnPropertyDescriptor(DataView.prototype, "byteLength").get,
);
const DataViewPrototypeGetUint32 = uncurryThis(DataView.prototype.getUint32);
const TypedArrayPrototypeGetByteLength = uncurryThis(
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength").get,
);

let debug = debuglog("quic", fn => {
  debug = fn;
});

// Internal assertion helper (stand-in for Node's `internal/assert`).
function assert(value, message) {
  if (!value) {
    throw $ERR_INTERNAL_ASSERTION(message || "Internal assertion failed");
  }
}

// Marks a promise rejection as handled without altering its observable state
// (stand-in for Node's internalBinding('util').markPromiseAsHandled).
function noop() {}
function markPromiseAsHandled(promise) {
  PromisePrototypeThen(promise, noop, noop);
}

// ----------------------------------------------------------------------------
// The native quic binding (Bun's equivalent of internalBinding('quic')).
const {
  Endpoint: Endpoint_,
  setCallbacks,

  // The constants to be exposed to end users for various options.
  CC_ALGO_RENO_STR: CC_ALGO_RENO,
  CC_ALGO_CUBIC_STR: CC_ALGO_CUBIC,
  CC_ALGO_BBR_STR: CC_ALGO_BBR,
  DEFAULT_CIPHERS,
  DEFAULT_GROUPS,

  // Internal constants for use by the implementation.
  // These are not exposed to end users.
  PREFERRED_ADDRESS_IGNORE: kPreferredAddressIgnore,
  PREFERRED_ADDRESS_USE: kPreferredAddressUse,
  DEFAULT_PREFERRED_ADDRESS_POLICY: kPreferredAddressDefault,
  STREAM_DIRECTION_BIDIRECTIONAL: kStreamDirectionBidirectional,
  STREAM_DIRECTION_UNIDIRECTIONAL: kStreamDirectionUnidirectional,
  CLOSECONTEXT_CLOSE: kCloseContextClose,
  CLOSECONTEXT_BIND_FAILURE: kCloseContextBindFailure,
  CLOSECONTEXT_LISTEN_FAILURE: kCloseContextListenFailure,
  CLOSECONTEXT_RECEIVE_FAILURE: kCloseContextReceiveFailure,
  CLOSECONTEXT_SEND_FAILURE: kCloseContextSendFailure,
  CLOSECONTEXT_START_FAILURE: kCloseContextStartFailure,
  QUIC_STREAM_HEADERS_KIND_INITIAL: kHeadersKindInitial,
  QUIC_STREAM_HEADERS_KIND_HINTS: kHeadersKindHints,
  QUIC_STREAM_HEADERS_KIND_TRAILING: kHeadersKindTrailing,
  QUIC_STREAM_HEADERS_FLAGS_NONE: kHeadersFlagsNone,
  QUIC_STREAM_HEADERS_FLAGS_TERMINAL: kHeadersFlagsTerminal,
} = require("internal/quic/binding");

// Maps the numeric HeadersKind constants from C++ to user-facing strings.
// Indexed by the enum value (HINTS=0, INITIAL=1, TRAILING=2).
const kHeadersKindName = [];
kHeadersKindName[kHeadersKindHints] = "hints";
kHeadersKindName[kHeadersKindInitial] = "initial";
kHeadersKindName[kHeadersKindTrailing] = "trailing";

// ----------------------------------------------------------------------------
// Error constructors. Plain functions returning the error object so both the
// `new ERR_X()` and `ERR_X()` call styles used by the upstream source work.
// Message templates match Node's internal/errors.js definitions.
function ERR_ILLEGAL_CONSTRUCTOR() {
  return $ERR_ILLEGAL_CONSTRUCTOR();
}
function ERR_INVALID_ARG_TYPE(name, expected, actual) {
  return $ERR_INVALID_ARG_TYPE(name, expected, actual);
}
function ERR_INVALID_ARG_VALUE(name, value, reason) {
  if (reason === undefined) return $ERR_INVALID_ARG_VALUE(name, value);
  return $ERR_INVALID_ARG_VALUE(name, value, reason);
}
function ERR_INVALID_STATE(message) {
  return $ERR_INVALID_STATE(message);
}
function ERR_INVALID_THIS(type) {
  return $ERR_INVALID_THIS(type);
}
function ERR_MISSING_ARGS(...args) {
  return $ERR_MISSING_ARGS(...args);
}
function ERR_OUT_OF_RANGE(name, range, value) {
  return $ERR_OUT_OF_RANGE(name, range, value);
}
function ERR_QUIC_CONNECTION_FAILED() {
  return $ERR_QUIC_CONNECTION_FAILED("QUIC connection failed");
}
function ERR_QUIC_ENDPOINT_CLOSED(context, status) {
  return $ERR_QUIC_ENDPOINT_CLOSED(`QUIC endpoint closed: ${context} (${status})`);
}
function ERR_QUIC_OPEN_STREAM_FAILED() {
  return $ERR_QUIC_OPEN_STREAM_FAILED("Failed to open QUIC stream");
}
function ERR_QUIC_STREAM_ABORTED(message) {
  return $ERR_QUIC_STREAM_ABORTED(`${message}`);
}
function ERR_QUIC_STREAM_RESET(code) {
  return $ERR_QUIC_STREAM_RESET(`The QUIC stream was reset by the peer with error code ${code}`);
}
function ERR_QUIC_VERSION_NEGOTIATION_ERROR() {
  return $ERR_QUIC_VERSION_NEGOTIATION_ERROR("The QUIC session requires version negotiation");
}

// ----------------------------------------------------------------------------
// Native-handle adapters. The Bun native binding accepts and returns the
// public JS objects directly (net.SocketAddress, net.BlockList, Blob,
// KeyObject), so the upstream `[kHandle]`-style accesses below resolve to the
// objects themselves and `new InternalSocketAddress(handle)` is an identity
// wrapper.
// lsquic fixes HTTP/3-vs-raw framing per client *engine*, so an implicit
// endpoint's mode is set by its first successful connect();
// `findSuitableEndpoint` must not hand out one in the other mode.
const kClientHttp = Symbol("kClientHttp");
const kNoteClientHttp = Symbol("kNoteClientHttp");

const kSocketAddressHandle = Symbol("kSocketAddressHandle");
Object.defineProperty(SocketAddress.prototype, kSocketAddressHandle, {
  __proto__: null,
  get() {
    return this;
  },
  configurable: true,
});
const kBlockListHandle = Symbol("kBlockListHandle");
Object.defineProperty(BlockList.prototype, kBlockListHandle, {
  __proto__: null,
  get() {
    return this;
  },
  configurable: true,
});
function InternalSocketAddress(handle) {
  return handle;
}

const kBlobHandle = Symbol("kBlobHandle");
Object.defineProperty(Blob.prototype, kBlobHandle, {
  __proto__: null,
  get() {
    return this;
  },
  configurable: true,
});
function isBlob(value) {
  return value instanceof Blob;
}

// KeyObject adapters. The native binding consumes private keys as PKCS#8 PEM
// text rather than KeyObject handles (Node passes the native KeyObjectHandle;
// Bun's KeyObject internals are not reachable from the quic binding yet).
// TODO(quic): pass the KeyObject itself once the binding can read its EVP_PKEY
// directly; PEM export does not work for non-exportable keys.
function getKeyObjectHandle(key) {
  return key.export({ format: "pem", type: "pkcs8" });
}
function getKeyObjectType(key) {
  return key.type;
}

// FileHandle adapters. Bun's fs.promises FileHandle is a JS class wrapping a
// numeric fd; the native binding receives the fd for fd-backed body sources.
const FileHandleImpl = require("node:fs/promises").$data.FileHandle;
const kFileLocked = Symbol("kFileLocked");
const kFileHandle = Symbol("kFileHandle");
Object.defineProperty(FileHandleImpl.prototype, kFileHandle, {
  __proto__: null,
  get() {
    return this.fd;
  },
  configurable: true,
});
const FileHandle = {
  isFileHandle(value) {
    return value instanceof FileHandleImpl;
  },
};

const { drainableProtocol, kValidatedSource } = require("internal/streams/iter/types");

const { toUint8Array, convertChunks } = require("internal/streams/iter/utils");

const { from: streamFrom, fromSync: streamFromSync } = require("internal/streams/iter/from");

const {
  validateAbortSignal,
  validateBoolean,
  validateFunction,
  validateInteger,
  validateObject,
  validateOneOf,
  validateString,
} = require("internal/validators");

const {
  buildNgHeaderString,
  assertValidPseudoHeader,
  assertValidPseudoHeaderTrailer,
} = require("internal/quic/http2util");

const kEmptyObject = { __proto__: null };

const {
  kAttachFileHandle,
  kBlocked,
  kConnect,
  kDatagram,
  kDatagramStatus,
  kDrain,
  kEarlyDataRejected,
  kFinishClose,
  kGoaway,
  kHandshake,
  kHandshakeCompleted,
  kVerifyPeer,
  kHeaders,
  kOwner,
  kRemoveSession,
  kKeylog,
  kListen,
  kNewSession,
  kQlog,
  kRemoveStream,
  kNewStream,
  kNewToken,
  kOrigin,
  kStreamCallbacks,
  kStreamIdleTimeout,
  kPathValidation,
  kPrivateConstructor,
  kReset,
  kSendHeaders,
  kSessionTicket,
  kTrailers,
  kVersionNegotiation,
  kInspect,
} = require("internal/quic/symbols");

const { QuicEndpointStats, QuicStreamStats, QuicSessionStats, kCreateDisconnected } = require("internal/quic/stats");

const { QuicEndpointState, QuicSessionState, QuicStreamState } = require("internal/quic/state");

// Performance-observer integration: 'quic' entries route through the JS-side
// node-entry-type registry (same machinery as 'net'/'dns'/'http').
const { hasObserver, startPerf, stopPerf } = require("internal/shared");

const kPerfEntry = Symbol("kPerfEntry");

const {
  onEndpointCreatedChannel,
  onEndpointListeningChannel,
  onEndpointClosingChannel,
  onEndpointClosedChannel,
  onEndpointErrorChannel,
  onEndpointBusyChangeChannel,
  onEndpointClientSessionChannel,
  onEndpointServerSessionChannel,
  onSessionOpenStreamChannel,
  onSessionReceivedStreamChannel,
  onSessionSendDatagramChannel,
  onSessionUpdateKeyChannel,
  onSessionClosingChannel,
  onSessionClosedChannel,
  onSessionReceiveDatagramChannel,
  onSessionReceiveDatagramStatusChannel,
  onSessionPathValidationChannel,
  onSessionNewTokenChannel,
  onSessionTicketChannel,
  onSessionVersionNegotiationChannel,
  onSessionOriginChannel,
  onSessionHandshakeChannel,
  onSessionGoawayChannel,
  onSessionEarlyRejectedChannel,
  onStreamClosedChannel,
  onStreamHeadersChannel,
  onStreamTrailersChannel,
  onStreamInfoChannel,
  onStreamResetChannel,
  onStreamBlockedChannel,
  onSessionErrorChannel,
  onEndpointConnectChannel,
} = require("internal/quic/diagnostics");

// ----------------------------------------------------------------------------
// Async iterable over a native stream reader handle.
// Ported verbatim from Node lib/internal/blob.js createBlobReaderIterable();
// the reader handle returned by the native binding's stream.getReader() must
// implement the same protocol: setWakeup(fn) and pull(cb(status, buffer))
// where status 0 = end-of-stream, < 0 = error, 2 = blocked, otherwise data.

// Maximum number of chunks to collect in a single batch to prevent
// unbounded memory growth when the DataQueue has a large burst of data.
const kMaxBatchChunks = 16;

async function* createBlobReaderIterable(reader, options = {}) {
  const { getReadError } = options;
  let wakeup = PromiseWithResolvers();
  reader.setWakeup(wakeup.resolve);

  try {
    while (true) {
      const batch = [];
      let blocked = false;
      let eos = false;
      let error = null;

      // Pull as many chunks as available synchronously. `pull` invokes its
      // callback synchronously, so a shared scratch pair is safe.
      let pullStatus = 0;
      let pullBuffer = null;
      const onPull = (status, buffer) => {
        pullStatus = status;
        pullBuffer = buffer;
      };
      while (true) {
        reader.pull(onPull);

        if (pullStatus === 0) {
          eos = true;
          break;
        }
        if (pullStatus < 0) {
          error =
            typeof getReadError === "function"
              ? getReadError(pullStatus)
              : new ERR_INVALID_STATE("The reader is not readable");
          break;
        }
        if (pullStatus === 2) {
          blocked = true;
          break;
        }
        ArrayPrototypePush(batch, new Uint8Array(pullBuffer));
        if (batch.length >= kMaxBatchChunks) break;
      }

      if (batch.length > 0) {
        yield batch;
      }

      if (eos) return;
      if (error) throw error;

      if (blocked) {
        const fin = await wakeup.promise;
        wakeup = PromiseWithResolvers();
        reader.setWakeup(wakeup.resolve);
        // If the wakeup was triggered by FIN (EndReadable), the DataQueue
        // is capped. Continue the loop to pull again -- the next pull will
        // return EOS. Without this, a race between the data notification
        // and the FIN notification can leave the iterator waiting for a
        // wakeup that will never come.
        if (fin) continue;
      }
    }
  } finally {
    reader.setWakeup(undefined);
  }
}

const kNilDatagramId = 0n;

// Module-level registry of all live QuicEndpoint instances. Used by
// connect() and listen() to find existing endpoints for reuse instead
// of creating a new one per session.
const endpointRegistry = new SafeSet();

// Idle endpoints (typically the implicit client endpoint that connect()
// creates) keep their socket open with the loop unref'd; release the
// socket directly at process exit so it is freed instead of leaking.
// This bypasses the JS close() flow entirely so no `endpoint.closing`
// diagnostics events fire (the implicit endpoint is never observably
// closed by user code) and runs even when the process exits on an
// unhandled error. `releaseEndpointSocket` is set in the QuicEndpoint
// static block so it can reach the private handle.
let releaseEndpointSocket;
process.on("exit", () => {
  for (const endpoint of endpointRegistry) {
    releaseEndpointSocket(endpoint);
  }
});

/**
 * @typedef {import('../socketaddress.js').SocketAddress} SocketAddress
 * @typedef {import('../crypto/keys.js').KeyObject} KeyObject
 */

/**
 * @typedef {object} OpenStreamOptions
 * @property {string|ArrayBuffer|SharedArrayBuffer|ArrayBufferView|Blob|
 *   FileHandle|AsyncIterable|Iterable|Promise|null} [body] The outbound
 *   body source. See the public docs for `stream.setBody()` for details
 *   on supported types. When omitted, the stream is closed immediately.
 * @property {object} [headers] Initial request or response headers to
 *   send. Only used when the negotiated application supports headers
 *   (e.g. HTTP/3).
 * @property {'high'|'default'|'low'} [priority] The priority level of the stream.
 * @property {boolean} [incremental] Whether to interleave data with same-priority streams.
 * @property {number} [highWaterMark] The high water mark for write
 *   backpressure, in bytes. **Default:** `65536`.
 * @property {OnHeadersCallback} [onheaders] Callback for incoming initial headers
 * @property {OnTrailersCallback} [ontrailers] Callback for incoming trailing headers
 * @property {OnInfoCallback} [oninfo] Callback for informational (1xx) headers
 * @property {OnWantTrailersCallback} [onwanttrailers] Callback fired when the
 *   transport is ready to send trailers for this stream.
 */

/**
 * Provides the configuration options for a QuicEndpoint.
 * @typedef {object} EndpointOptions
 * @property {SocketAddress|string} [address] The local address to bind to
 * @property {bigint|number} [addressLRUSize] The size of the address LRU cache
 * @property {'reno'|'cubic'|'bbr'} [cc] The congestion control algorithm
 * @property {boolean} [disableStatelessReset] When true, the endpoint will not send stateless resets
 * @property {bigint|number} [idleTimeout] The default idle timeout for sessions on this endpoint
 * @property {boolean} [ipv6Only] Use IPv6 only
 * @property {boolean} [reusePort] Enable SO_REUSEPORT for multi-process load balancing
 * @property {bigint|number} [maxConnectionsPerHost] The maximum number of connections per host
 * @property {bigint|number} [maxConnectionsTotal] The maximum number of total connections
 * @property {number} [retryRate] Global rate limit for retry packets (per second)
 * @property {number} [retryBurst] Burst capacity for retry rate limiter
 * @property {number} [statelessResetRate] Global rate limit for stateless reset packets (per second)
 * @property {number} [statelessResetBurst] Burst capacity for stateless reset rate limiter
 * @property {number} [versionNegotiationRate] Global rate limit for version negotiation packets (per second)
 * @property {number} [versionNegotiationBurst] Burst capacity for version negotiation rate limiter
 * @property {number} [immediateCloseRate] Global rate limit for immediate close packets (per second)
 * @property {number} [immediateCloseBurst] Burst capacity for immediate close rate limiter
 * @property {number} [sessionCreationRate] Per-host rate limit for session creation (per second)
 * @property {number} [sessionCreationBurst] Per-host burst capacity for session creation rate limiter
 * @property {net.BlockList} [blockList] Block list for filtering incoming packets by source address
 * @property {'deny'|'allow'} [blockListPolicy='deny'] How to interpret the block list
 * @property {ArrayBufferView} [resetTokenSecret] The reset token secret
 * @property {bigint|number} [retryTokenExpiration] The retry token expiration
 * @property {number} [rxDiagnosticLoss] The receive diagnostic loss probability (range 0.0-1.0)
 * @property {bigint|number} [tokenExpiration] The token expiration
 * @property {ArrayBufferView} [tokenSecret] The token secret
 * @property {number} [txDiagnosticLoss] The transmit diagnostic loss probability (range 0.0-1.0)
 * @property {number} [udpReceiveBufferSize] The UDP receive buffer size
 * @property {number} [udpSendBufferSize] The UDP send buffer size
 * @property {number} [udpTTL] The UDP TTL
 * @property {boolean} [validateAddress] Validate the address using retry packets
 */

/**
 * @typedef {object} TransportParams
 * @property {SocketAddress} [preferredAddressIpv4] The preferred IPv4 address
 * @property {SocketAddress} [preferredAddressIpv6] The preferred IPv6 address
 * @property {bigint|number} [initialMaxStreamDataBidiLocal] The initial maximum stream data bidirectional local
 * @property {bigint|number} [initialMaxStreamDataBidiRemote] The initial maximum stream data bidirectional remote
 * @property {bigint|number} [initialMaxStreamDataUni] The initial maximum stream data unidirectional
 * @property {bigint|number} [initialMaxData] The initial maximum data
 * @property {bigint|number} [initialMaxStreamsBidi] The initial maximum streams bidirectional
 * @property {bigint|number} [initialMaxStreamsUni] The initial maximum streams unidirectional
 * @property {bigint|number} [maxIdleTimeout] The maximum idle timeout
 * @property {bigint|number} [activeConnectionIDLimit] The active connection ID limit
 * @property {bigint|number} [ackDelayExponent] The acknowledgment delay exponent
 * @property {bigint|number} [maxAckDelay] The maximum acknowledgment delay
 * @property {bigint|number} [maxDatagramFrameSize] The maximum datagram frame size
 */

/**
 * @typedef {object} ApplicationOptions
 * @property {bigint|number} [maxHeaderPairs] The maximum header pairs
 * @property {bigint|number} [maxHeaderLength] The maximum header length
 * @property {bigint|number} [maxFieldSectionSize] The maximum field section size
 * @property {bigint|number} [qpackMaxDTableCapacity] The qpack maximum dynamic table capacity
 * @property {bigint|number} [qpackEncoderMaxDTableCapacity] The qpack encoder maximum dynamic table capacity
 * @property {bigint|number} [qpackBlockedStreams] The qpack blocked streams
 * @property {boolean} [enableConnectProtocol] Enable the connect protocol
 * @property {boolean} [enableDatagrams] Enable datagrams
 */

/**
 * Per-identity TLS options. Used as the values in the `sni` map of
 * `SessionOptions` for server endpoints.
 * @typedef {object} IdentityOptions
 * @property {KeyObject|KeyObject[]} keys The TLS private keys.
 * @property {ArrayBuffer|ArrayBufferView|Array<ArrayBuffer|ArrayBufferView>} certs The TLS certificates.
 * @property {boolean} [verifyPrivateKey] Verify the private key.
 *   **Default:** `false`.
 * @property {number} [port] The port to advertise in HTTP/3 ORIGIN frames
 *   for this host name. **Default:** `443`.
 * @property {boolean} [authoritative] Whether to include this host name
 *   in HTTP/3 ORIGIN frames. **Default:** `true`. Wildcard (`'*'`)
 *   entries are always excluded regardless of this setting.
 */

/**
 * @typedef {object} SessionOptions
 * @property {EndpointOptions|QuicEndpoint} [endpoint] An endpoint to use.
 * @property {boolean} [reuseEndpoint] When `true` (default), `connect()`
 *   will attempt to reuse an existing endpoint rather than create a new
 *   one. Has no effect for server sessions.
 * @property {number} [version] The QUIC version
 * @property {number} [minVersion] The minimum acceptable QUIC version
 * @property {'use'|'ignore'|'default'} [preferredAddressPolicy] The preferred address policy
 * @property {'strict'|'auto'|'manual'} [verifyPeer='auto'] Peer certificate verification policy (client only)
 * @property {ApplicationOptions} [application] The application options
 * @property {TransportParams} [transportParams] The transport parameters
 * @property {string} [servername] The server name identifier (client only)
 * @property {string|string[]} [alpn] The ALPN protocol identifier(s).
 *   For client sessions, a single string. For server sessions, an array
 *   of protocol names in preference order.
 * @property {string} [ciphers] The TLS ciphers
 * @property {string} [groups] The TLS key-exchange groups
 * @property {boolean} [keylog] Enable TLS key logging
 * @property {boolean} [verifyClient] Verify the client certificate (server only)
 * @property {boolean} [tlsTrace] Enable TLS tracing
 * @property {boolean} [enableEarlyData] Enable 0-RTT early data.
 *   **Default:** `true`.
 * @property {boolean} [rejectUnauthorized] Verify the peer certificate
 *   against the supplied CAs. **Default:** `true`.
 * @property {boolean} [verifyPrivateKey] Verify the private key (client only)
 * @property {KeyObject|KeyObject[]} [keys] The TLS private keys (client only)
 * @property {ArrayBuffer|ArrayBufferView|Array<ArrayBuffer|ArrayBufferView>} [certs] The TLS certificates (client only)
 * @property {ArrayBuffer|ArrayBufferView|Array<ArrayBuffer|ArrayBufferView>} [ca] The certificate authority
 * @property {ArrayBuffer|ArrayBufferView|Array<ArrayBuffer|ArrayBufferView>} [crl] The certificate revocation list
 * @property {{[key: string]: IdentityOptions}} [sni] Map of host names to
 *   per-identity TLS options for Server Name Indication. Required for
 *   server sessions. The special key `'*'` specifies the optional
 *   default/fallback identity.
 * @property {boolean} [qlog] Enable qlog
 * @property {ArrayBufferView} [sessionTicket] A session ticket from a
 *   prior session, used to resume that session (client only).
 * @property {ArrayBufferView} [token] An opaque address validation token
 *   previously received from the server via `onnewtoken` (client only).
 * @property {bigint|number} [handshakeTimeout] The handshake timeout
 * @property {bigint|number} [initialRtt] The initial round-trip time estimate in milliseconds.
 *   Used for PTO computation and initial pacing before the first RTT sample. Default uses
 *   the default of 333ms. Set lower for low-latency environments.
 * @property {bigint|number} [keepAlive] The keep-alive timeout in milliseconds. When set,
 *   PING frames will be sent automatically to prevent idle timeout.
 * @property {bigint|number} [maxStreamWindow] The maximum stream window
 * @property {bigint|number} [maxWindow] The maximum connection window
 * @property {bigint|number} [maxPayloadSize] The maximum payload size
 * @property {bigint|number} [unacknowledgedPacketThreshold] The unacknowledged packet threshold
 * @property {'reno'|'cubic'|'bbr'} [cc] The congestion control algorithm
 * @property {'drop-oldest'|'drop-newest'} [datagramDropPolicy] The
 *   policy used when the pending datagram queue is full.
 *   **Default:** `'drop-oldest'`.
 * @property {number} [drainingPeriodMultiplier] Multiplier applied to the
 *   draining period (3 * PTO). Range `3..255`.
 *   **Default:** `3`.
 * @property {bigint|number} [streamIdleTimeout] Time in ms before idle peer-initiated streams are destroyed
 * @property {number} [maxDatagramSendAttempts] Maximum number of times a
 *   datagram is retried before being abandoned. Range `1..255`.
 *   **Default:** `5`.
 * @property {OnSessionErrorCallback} [onerror] Session error callback.
 * @property {OnStreamCallback} [onstream] Incoming stream callback.
 * @property {OnDatagramCallback} [ondatagram] Incoming datagram callback.
 * @property {OnDatagramStatusCallback} [ondatagramstatus] Outgoing datagram status callback.
 * @property {OnPathValidationCallback} [onpathvalidation] Path validation callback.
 * @property {OnSessionTicketCallback} [onsessionticket] New session-ticket callback.
 * @property {OnVersionNegotiationCallback} [onversionnegotiation] Version negotiation callback.
 * @property {OnHandshakeCallback} [onhandshake] Handshake-completed callback.
 * @property {OnNewTokenCallback} [onnewtoken] NEW_TOKEN frame callback (client only).
 * @property {OnOriginCallback} [onorigin] ORIGIN frame callback (client only).
 * @property {OnGoawayCallback} [ongoaway] GOAWAY frame callback.
 * @property {OnKeylogCallback} [onkeylog] TLS key-log callback.
 * @property {OnQlogCallback} [onqlog] qlog data callback.
 * @property {OnHeadersCallback} [onheaders] Default per-stream initial-headers callback.
 * @property {OnTrailersCallback} [ontrailers] Default per-stream trailing-headers callback.
 * @property {OnInfoCallback} [oninfo] Default per-stream informational-headers callback.
 * @property {OnWantTrailersCallback} [onwanttrailers] Default per-stream
 *   want-trailers callback.
 */

/**
 * @typedef {object} Datagrams
 * @property {ReadableStream} readable The readable stream
 * @property {WritableStream} writable The writable stream
 */

/**
 * @typedef {object} Path
 * @property {SocketAddress} local The local address
 * @property {SocketAddress} remote The remote address
 */

/**
 * @typedef {object} QuicSessionInfo
 * @property {SocketAddress} local The local address
 * @property {SocketAddress} remote The remote address
 * @property {string} protocol The alpn protocol identifier negotiated for this session
 * @property {string} servername The servername identifier for this session
 * @property {string} cipher The cipher suite negotiated for this session
 * @property {string} cipherVersion The version of the cipher suite negotiated for this session
 * @property {string} [validationErrorReason] The reason the session failed validation (if any)
 * @property {string} [validationErrorCode] The error code for the validation failure (if any)
 */

/**
 * @typedef {object} QuicStreamDestroyOptions
 * @property {bigint|number} [code] An explicit application
 *   error code to send on the resulting `RESET_STREAM` /
 *   `STOP_SENDING` frames. Numbers are coerced to `BigInt`. When
 *   omitted, the code is derived from `error` per the precedence
 *   above.
 * @property {string} [reason] Optional human-readable reason.
 *   Accepted for symmetry with `session.close()` /
 *   `session.destroy()`; QUIC `RESET_STREAM` and `STOP_SENDING`
 *   frames do not themselves carry a reason field over the wire.
 */

/**
 * @typedef {object} SendHeadersOptions
 * @property {boolean} [terminal] When true, indicates that no body data will be
 *   sent after these headers.
 */

/**
 * @typedef {object} StreamPriority
 * @property {'default' | 'low' | 'high'} level The priority level of the stream.
 * @property {boolean} incremental Whether to interleave data with same-priority streams.
 */

/**
 * @typedef {object} QuicSessionPath
 * @property {SocketAddress} local The local address for this path
 * @property {SocketAddress} remote The remote address for this path
 */

/**
 * @typedef {object} SNIContextOptions
 * @property {boolean} [replace] When `true`, the provided SNI context will replace
 *   the default context for the session. When `false` (default), the provided
 *   context will be merged with the default context, with precedence given to
 *   the provided context on any overlapping options.
 */

/**
 * @typedef {object} ProcessSessionOptions
 * @property {boolean} forServer true if processing options for a server session
 * @property {string} addressFamily the address family to use for validating
 */

/**
 * Called when the Endpoint receives a new server-side Session.
 * @callback OnSessionCallback
 * @this {QuicEndpoint}
 * @param {QuicSession} session
 * @returns {void}
 */

/**
 * Called when a session is destroyed with an error.
 * @callback OnSessionErrorCallback
 * @this {QuicSession}
 * @param {any} error
 * @returns {void}
 */

/**
 * @callback OnStreamCallback
 * @this {QuicSession}
 * @param {QuicStream} stream
 * @returns {void}
 */

/**
 * @callback OnDatagramCallback
 * @this {QuicSession}
 * @param {Uint8Array} datagram
 * @param {boolean} early A datagram is early if it was received before the TLS handshake completed
 * @returns {void}
 */

/**
 * Called when the status of a previously sent datagram is reported.
 * @callback OnDatagramStatusCallback
 * @this {QuicSession}
 * @param {bigint} id The datagram id
 * @param {'acknowledged'|'lost'|'abandoned'} status
 * @returns {void}
 */

/**
 * Called when QUIC path validation completes (or fails).
 * @callback OnPathValidationCallback
 * @this {QuicSession}
 * @param {'success'|'failure'|'aborted'} result
 * @param {SocketAddress} newLocalAddress
 * @param {SocketAddress} newRemoteAddress
 * @param {SocketAddress|null} oldLocalAddress
 * @param {SocketAddress|null} oldRemoteAddress
 * @param {boolean} [preferredAddress] `true` if the validation was triggered
 *   by a preferred-address migration on the client side.
 * @returns {void}
 */

/**
 * @callback OnSessionTicketCallback
 * @this {QuicSession}
 * @param {object} ticket
 * @returns {void}
 */

/**
 * Called when the server responds with a Version Negotiation packet.
 * The session is destroyed immediately after this returns.
 * @callback OnVersionNegotiationCallback
 * @this {QuicSession}
 * @param {number} version The QUIC version configured for this session
 * @param {number[]} requestedVersions The versions advertised by the server
 * @param {number[]} supportedVersions A `[minVersion, maxVersion]` pair
 * @returns {void}
 */

/**
 * Called when the TLS handshake completes successfully.
 * @callback OnHandshakeCallback
 * @this {QuicSession}
 * @param {string} sni
 * @param {string} alpn
 * @param {string} cipher
 * @param {string} cipherVersion
 * @param {string} [validationErrorReason]
 * @param {number} [validationErrorCode]
 * @param {boolean} earlyDataAttempted
 * @param {boolean} earlyDataAccepted
 * @returns {void}
 */

/**
 * Called when the server issues a NEW_TOKEN frame to the client.
 * @callback OnNewTokenCallback
 * @this {QuicSession}
 * @param {Buffer} token The opaque token data
 * @param {SocketAddress} address The remote server address
 * @returns {void}
 */

/**
 * Called when the server sends an ORIGIN frame.
 * @callback OnOriginCallback
 * @this {QuicSession}
 * @param {string[]} origins The list of origins the server claims authority for
 * @returns {void}
 */

/**
 * Called when the peer sends a GOAWAY frame (HTTP/3 only).
 * @callback OnGoawayCallback
 * @this {QuicSession}
 * @param {bigint} lastStreamId The highest stream ID the peer may have processed
 * @returns {void}
 */

/**
 * Called when TLS key-log material is available. Only fires when
 * `sessionOptions.keylog` is `true`.
 * @callback OnKeylogCallback
 * @this {QuicSession}
 * @param {string} line A single NSS Key Log Format line, including trailing newline.
 * @returns {void}
 */

/**
 * Called when qlog diagnostic data is available. Only fires when
 * `sessionOptions.qlog` is `true`.
 * @callback OnQlogCallback
 * @this {QuicSession}
 * @param {string} data A chunk of JSON-SEQ formatted qlog data
 * @param {boolean} fin `true` if this is the final qlog chunk for the session.
 * @returns {void}
 */

/**
 * @callback OnBlockedCallback
 * @this {QuicStream}
 * @returns {void}
 */

/**
 * @callback OnStreamErrorCallback
 * @this {QuicStream}
 * @param {any} error
 * @returns {void}
 */

/**
 * Called when initial request or response headers are received.
 * @callback OnHeadersCallback
 * @this {QuicStream}
 * @param {object} headers Header object with lowercase string keys and
 *   string or string-array values.
 * @returns {void}
 */

/**
 * Called when trailing headers are received from the peer.
 * @callback OnTrailersCallback
 * @this {QuicStream}
 * @param {object} trailers Trailing header object.
 * @returns {void}
 */

/**
 * Called when informational (1xx) headers are received from the server
 * (e.g. 103 Early Hints).
 * @callback OnInfoCallback
 * @this {QuicStream}
 * @param {object} headers Informational header object.
 * @returns {void}
 */

/**
 * Called when the transport is ready to send trailers for this stream.
 * The handler should call `stream.sendTrailers(...)` (or
 * `stream.sendTrailers()` with previously-set trailers) to provide them.
 * @callback OnWantTrailersCallback
 * @this {QuicStream}
 * @returns {void}
 */

setCallbacks({
  // QuicEndpoint callbacks

  /**
   * Called when the QuicEndpoint C++ handle has closed and we need to finish
   * cleaning up the JS side.
   * @param {number} context Identifies the reason the endpoint was closed.
   * @param {number} status If context indicates an error, provides the error code.
   */
  onEndpointClose(context, status) {
    debug("endpoint close callback", status);
    this[kOwner][kFinishClose](context, status);
  },
  /**
   * Called when the QuicEndpoint C++ handle receives a new server-side session
   * @param {object} session The QuicSession C++ handle
   */
  onSessionNew(session) {
    debug("new server session callback", this[kOwner], session);
    this[kOwner][kNewSession](session);
  },

  // QuicSession callbacks

  /**
   * Called when the underlying session C++ handle is closed either normally
   * or with an error.
   * @param {number} errorType
   * @param {number} code
   * @param {string} [reason]
   * @param {string} [errorName] Decoded TLS alert name when `code` is a
   *   CRYPTO_ERROR; otherwise undefined.
   */
  onSessionClose(errorType, code, reason, errorName) {
    debug("session close callback", errorType, code, reason, errorName);
    this[kOwner][kFinishClose](errorType, code, reason, errorName);
  },

  /**
   * Called when the peer sends a GOAWAY frame (HTTP/3 only).
   * @param {bigint} lastStreamId The highest stream ID the peer may have
   *   processed. Streams above this ID were not processed and can be retried.
   */
  onSessionGoaway(lastStreamId) {
    debug("session goaway callback", lastStreamId);
    this[kOwner][kGoaway](lastStreamId);
  },

  /**
   * Called when a datagram is received on this session.
   * @param {Uint8Array} uint8Array
   * @param {boolean} early
   */
  onSessionDatagram(uint8Array, early) {
    debug("session datagram callback", TypedArrayPrototypeGetByteLength(uint8Array), early);
    this[kOwner][kDatagram](uint8Array, early);
  },

  /**
   * Called when the status of a datagram is received.
   * @param {bigint} id
   * @param {'lost' | 'acknowledged'} status
   */
  onSessionDatagramStatus(id, status) {
    debug("session datagram status callback", id, status);
    this[kOwner][kDatagramStatus](id, status);
  },

  /**
   * Called when the session handshake completes.
   * @param {string} servername
   * @param {string} protocol
   * @param {string} cipher
   * @param {string} cipherVersion
   * @param {string} validationErrorReason
   * @param {number} validationErrorCode
   * @param {boolean} earlyDataAttempted
   * @param {boolean} earlyDataAccepted
   */
  onSessionHandshake(
    servername,
    protocol,
    cipher,
    cipherVersion,
    validationErrorReason,
    validationErrorCode,
    earlyDataAttempted,
    earlyDataAccepted,
  ) {
    debug(
      "session handshake callback",
      servername,
      protocol,
      cipher,
      cipherVersion,
      validationErrorReason,
      validationErrorCode,
      earlyDataAttempted,
      earlyDataAccepted,
    );
    this[kOwner][kHandshake](
      servername,
      protocol,
      cipher,
      cipherVersion,
      validationErrorReason,
      validationErrorCode,
      earlyDataAttempted,
      earlyDataAccepted,
    );
  },

  /**
   * Called when the session path validation completes.
   * @param {'aborted'|'failure'|'success'} result
   * @param {SocketAddress} newLocalAddress
   * @param {SocketAddress} newRemoteAddress
   * @param {SocketAddress} oldLocalAddress
   * @param {SocketAddress} oldRemoteAddress
   * @param {boolean} preferredAddress
   */
  onSessionPathValidation(
    result,
    newLocalAddress,
    newRemoteAddress,
    oldLocalAddress,
    oldRemoteAddress,
    preferredAddress,
  ) {
    debug("session path validation callback", this[kOwner]);
    this[kOwner][kPathValidation](
      result,
      newLocalAddress,
      newRemoteAddress,
      oldLocalAddress,
      oldRemoteAddress,
      preferredAddress,
    );
  },

  /**
   * Called when the session generates a new TLS session ticket
   * @param {object} ticket An opaque session ticket
   */
  onSessionTicket(ticket) {
    debug("session ticket callback", this[kOwner]);
    this[kOwner][kSessionTicket](ticket);
  },

  /**
   * Called when the client receives a NEW_TOKEN frame from the server.
   * The token can be used for future connections to the same server
   * address to skip address validation.
   * @param {Buffer} token The opaque token data
   * @param {SocketAddress} address The remote server address
   */
  onSessionNewToken(token, address) {
    debug("session new token callback", this[kOwner]);
    this[kOwner][kNewToken](token, address);
  },

  /**
   * Called when the server rejects 0-RTT early data. All streams
   * opened during the 0-RTT phase have been destroyed. The
   * application should re-open streams if needed.
   */
  onSessionEarlyDataRejected() {
    debug("session early data rejected callback", this[kOwner]);
    this[kOwner][kEarlyDataRejected]();
  },

  /**
   * Called when the session receives an ORIGIN frame from the peer (RFC 9412).
   * @param {string[]} origins The list of origins the peer claims authority for
   */
  onSessionOrigin(origins) {
    debug("session origin callback", this[kOwner]);
    this[kOwner][kOrigin](origins);
  },

  /**
   * Called when the session receives a session version negotiation request
   * @param {number} version
   * @param {number[]} requestedVersions
   * @param {number[]} supportedVersions
   */
  onSessionVersionNegotiation(version, requestedVersions, supportedVersions) {
    debug("session version negotiation callback", version, requestedVersions, supportedVersions, this[kOwner]);
    this[kOwner][kVersionNegotiation](version, requestedVersions, supportedVersions);
    // Note that immediately following a version negotiation event, the
    // session will be destroyed.
  },

  onSessionKeyLog(line) {
    debug("session key log callback", line, this[kOwner]);
    this[kOwner][kKeylog](line);
  },

  onSessionQlog(data, fin) {
    if (this[kOwner] === undefined) {
      // Qlog data can arrive during native conn creation, before the
      // QuicSession JS wrapper exists. Cache until the wrapper is ready.
      this._pendingQlog ??= [];
      this._pendingQlog.push(data, fin);
      return;
    }
    debug("session qlog callback", this[kOwner]);
    this[kOwner][kQlog](data, fin);
  },

  /**
   * Called when a new stream has been received for the session
   * @param {object} stream The QuicStream C++ handle
   * @param {number} direction The stream direction (0 == bidi, 1 == uni)
   */
  onStreamCreated(stream, direction) {
    const session = this[kOwner];
    // The event is ignored and the stream destroyed if the session has been destroyed.
    debug("stream created callback", session, direction);
    if (session.destroyed) {
      stream.destroy();
      return;
    }
    session[kNewStream](stream, direction);
  },

  // QuicStream callbacks
  onStreamBlocked() {
    debug("stream blocked callback", this[kOwner]);
    // Called when the stream C++ handle has been blocked by flow control.
    this[kOwner][kBlocked]();
  },

  onStreamDrain() {
    // Called when the stream's outbound buffer has capacity for more data.
    debug("stream drain callback", this[kOwner]);
    this[kOwner][kDrain]();
  },

  onStreamClose(error) {
    // Called when the stream C++ handle has been closed. The error is
    // either undefined (clean close) or a raw array [type, code, reason]
    // from QuicError::ToV8Value. Convert to a proper Node.js Error.
    if (error !== undefined) {
      error = convertQuicError(error);
    } else if (this[kOwner] && !this[kOwner].destroyed) {
      // The stream is closing cleanly, but it may have been reset by the
      // peer (ReceiveStreamReset) or locally (resetStream). The C++ side
      // records the reset code in state.resetCode. If set, surface the
      // reset as the close error so stream.closed rejects -- the reset
      // was an abnormal termination even if the session closed cleanly.
      const resetCode = getQuicStreamState(this[kOwner]).resetCode;
      if (resetCode !== undefined && resetCode > 0n) {
        error = makeQuicError(
          "ERR_QUIC_APPLICATION_ERROR",
          "QUIC application error",
          "application",
          resetCode,
          `stream reset with code ${resetCode}`,
        );
      }
    }
    debug(`stream ${this[kOwner].id} closed callback with error: ${error}`);
    this[kOwner][kFinishClose](error);
  },

  onStreamReset(error) {
    // Called when the stream C++ handle has received a stream reset.
    if (error !== undefined) {
      error = convertQuicError(error);
    }
    debug("stream reset callback", this[kOwner], error);
    this[kOwner][kReset](error);
  },

  onStreamHeaders(headers, kind) {
    // Called when the stream C++ handle has received a full block of headers.
    debug(`stream ${this[kOwner].id} headers callback`, headers, kind);
    this[kOwner][kHeaders](headers, kind);
  },

  onStreamTrailers() {
    // Called when the stream C++ handle is ready to receive trailing headers.
    debug("stream want trailers callback", this[kOwner]);
    this[kOwner][kTrailers]();
  },
});

function assertPrivateSymbol(privateSymbol) {
  if (privateSymbol !== kPrivateConstructor) {
    throw new ERR_ILLEGAL_CONSTRUCTOR();
  }
}

// QUIC error codes are 62-bit varints (RFC 9000 section 16). The
// maximum representable code is 2**62 - 1.
const kMaxQuicErrorCode = (1n << 62n) - 1n;

/**
 * An Error subclass that carries an explicit numeric QUIC error code.
 * Use this when destroying a stream or aborting an outbound writer to
 * communicate a specific application-protocol-defined error code to
 * the peer. When a `QuicError` is supplied, the QUIC stack uses
 * `errorCode` as the wire code for the resulting RESET_STREAM /
 * STOP_SENDING / CONNECTION_CLOSE frame; otherwise the negotiated
 * application's "internal error" code is used (see
 * `QuicSessionState.internalErrorCode`).
 *
 * The Node.js error code (`error.code`) defaults to
 * `'ERR_QUIC_STREAM_ABORTED'` but can be overridden via
 * `options.code`. The numeric QUIC code lives on the separate
 * `errorCode` property to avoid colliding with Node.js's convention
 * that `error.code` is a string.
 */
class QuicError extends Error {
  /** @type {bigint} */
  #errorCode;
  /** @type {'transport' | 'application'} */
  #type;

  static isQuicError(val) {
    return val != null && typeof val === "object" && #errorCode in val;
  }

  /**
   * @param {string} message
   * @param {object} options
   * @param {bigint|number} options.errorCode The numeric QUIC error
   *   code. Numbers are coerced to BigInt. Must be a non-negative
   *   62-bit unsigned varint
   *   (`0n <= errorCode <= 2n ** 62n - 1n`).
   * @param {string} [options.code] The Node.js-style error code
   *   string assigned to `error.code`. Defaults to
   *   `'ERR_QUIC_STREAM_ABORTED'`.
   * @param {'transport'|'application'} [options.type] Whether the
   *   code is a transport-layer code (defined by RFC 9000) or an
   *   application-layer code (defined by the negotiated ALPN, e.g.
   *   RFC 9114 for HTTP/3). Defaults to `'application'`. Stream
   *   resets always carry application codes; this option is exposed
   *   for use sites that may target either layer.
   */
  constructor(message, options = kEmptyObject) {
    validateString(message, "message");
    validateObject(options, "options");
    const { errorCode, code = "ERR_QUIC_STREAM_ABORTED", type = "application" } = options;
    if (errorCode === undefined) {
      throw new ERR_MISSING_ARGS("options.errorCode");
    }
    if (typeof errorCode !== "bigint" && typeof errorCode !== "number") {
      throw new ERR_INVALID_ARG_TYPE("options.errorCode", ["bigint", "number"], errorCode);
    }
    validateString(code, "options.code");
    validateOneOf(type, "options.type", ["transport", "application"]);
    const numericCode = BigInt(errorCode);
    if (numericCode < 0n || numericCode > kMaxQuicErrorCode) {
      throw new ERR_OUT_OF_RANGE("options.errorCode", `>= 0 and <= ${kMaxQuicErrorCode}`, errorCode);
    }
    super(message);
    this.code = code;
    this.#errorCode = numericCode;
    this.#type = type;
  }

  /** @type {bigint} */
  get errorCode() {
    return this.#errorCode;
  }

  /** @type {'transport' | 'application'} */
  get type() {
    return this.#type;
  }
}

// Build the human-readable message for an ERR_QUIC_TRANSPORT_ERROR or
// ERR_QUIC_APPLICATION_ERROR. `errorName` is the symbolic name for
// the wire code when known: either the OpenSSL-decoded TLS alert
// (CRYPTO_ERROR; 0x100..0x1ff) or one of the named transport codes
// from RFC 9000 (e.g. PROTOCOL_VIOLATION). Otherwise undefined.
// `reason` is the peer-supplied UTF-8 reason string from the
// CONNECTION_CLOSE / RESET_STREAM frame, often empty.
function quicErrorMessage(prefix, errorCode, reason, errorName) {
  let msg = `${prefix} `;
  msg += errorName ? `${errorName} (${errorCode})` : `${errorCode}`;
  if (reason) msg += `: ${reason}`;
  return msg;
}

function makeQuicError(code, prefix, type, errorCode, reason, errorName) {
  const err = new QuicError(quicErrorMessage(prefix, errorCode, reason, errorName), { errorCode, code, type });
  ErrorCaptureStackTrace(err, makeQuicError);
  if (reason) err.reason = reason;
  if (errorName) err.errorName = errorName;
  return err;
}

function convertQuicError(error) {
  const type = error[0];
  const code = error[1];
  const reason = error[2];
  const errorName = error[3];
  switch (type) {
    case "transport":
      return makeQuicError("ERR_QUIC_TRANSPORT_ERROR", "QUIC transport error", "transport", code, reason, errorName);
    case "application":
      return makeQuicError(
        "ERR_QUIC_APPLICATION_ERROR",
        "QUIC application error",
        "application",
        code,
        reason,
        errorName,
      );
    case "version_negotiation":
      return new ERR_QUIC_VERSION_NEGOTIATION_ERROR();
    default:
      return makeQuicError("ERR_QUIC_TRANSPORT_ERROR", "QUIC transport error", "transport", code, reason, errorName);
  }
}

// Convert a JavaScript error into close options suitable for
// `session.close()` / `session.destroy(error, options)`. The returned
// shape is `{ code, type, reason }` matching what `validateCloseOptions`
// expects (and what the native side reads via `MaybeSetCloseError`).
//
// Used so that destroying a session with an error actually emits a
// CONNECTION_CLOSE frame on the wire, instead of dropping the connection
// silently and leaving the peer waiting on its idle timer.
//
// Returns `undefined` when no error was supplied (caller falls back to
// a clean / silent close).
function errorToCloseOptions(error) {
  if (error === undefined || error === null) return undefined;
  // Generic mapping for now: any error becomes a transport-level
  // INTERNAL_ERROR (NGTCP2_INTERNAL_ERROR == 0x1) with the original
  // error message used as the human-readable reason. Future work could
  // detect specific `ERR_QUIC_*` subclasses and round-trip their
  // original code/type back onto the wire.
  const reason = typeof error === "object" && error !== null && error.message ? `${error.message}` : `${error}`;
  return { code: 0x1n, type: "transport", reason };
}

/**
 * Safely invoke a user-supplied callback. If the callback throws
 * synchronously, the owning object is destroyed with the error. If the
 * callback returns a promise that rejects, the rejection is caught and the
 * owning object is destroyed. Sync callbacks that do not throw incur no
 * promise allocation overhead.
 * @param {Function} fn  The callback to invoke.
 * @param {object} owner The QuicSession or QuicStream that owns the callback.
 * @param  {...any} args Arguments forwarded to the callback.
 */
function safeCallbackInvoke(fn, owner, ...args) {
  try {
    const result = fn(...args, owner);
    if (isPromise(result)) {
      // Block body - do NOT return the result of `owner.destroy(err)`.
      // For some owners (e.g. `QuicEndpoint`), `destroy(err)` returns the
      // owner's `closed` promise which itself eventually rejects with
      // the same error. If we let that propagate through the `.then()`
      // chain promise, nobody is awaiting that chain and we surface the
      // rejection as unhandled.
      PromisePrototypeThen(result, undefined, err => {
        owner.destroy(err);
      });
    }
  } catch (err) {
    owner.destroy(err);
  }
}

/**
 * Invoke an onerror callback. If the callback itself throws synchronously
 * or returns a promise that rejects, a SuppressedError wrapping both the
 * onerror failure and the original error is surfaced as an uncaught exception.
 * @param {Function} fn  The onerror callback.
 * @param {any} error    The original error that triggered destruction.
 */
function invokeOnerror(fn, error) {
  try {
    const result = fn(error);
    if (isPromise(result)) {
      PromisePrototypeThen(result, undefined, err => {
        process.nextTick(() => {
          // eslint-disable-next-line no-restricted-syntax
          throw new SuppressedError(err, error, err?.message);
        });
      });
    }
  } catch (err) {
    process.nextTick(() => {
      // eslint-disable-next-line no-restricted-syntax
      throw new SuppressedError(err, error, err?.message);
    });
  }
}

function validateBody(body) {
  if (body === undefined) return body;
  // ArrayBuffers, SharedArrayBuffers, and ArrayBufferViews are passed
  // through to the C++ layer which copies the bytes into its own
  // BackingStore. Callers can therefore safely reuse or mutate their
  // input buffers after the call returns. Callers that want to ensure
  // their buffer cannot be mutated after handing it off (for example,
  // when sharing the source with another async consumer) can call
  // ArrayBuffer.prototype.transfer() themselves before passing the
  // buffer.
  if (isArrayBuffer(body) || isSharedArrayBuffer(body) || isArrayBufferView(body)) {
    return body;
  }
  if (isBlob(body)) return body[kBlobHandle];

  // Strings are encoded as UTF-8.
  if (typeof body === "string") {
    return Buffer.from(body, "utf8");
  }

  // FileHandle -- lock it and pass the C++ handle to GetDataQueueFromSource
  // which creates an fd-backed DataQueue entry from the file path.
  if (FileHandle.isFileHandle(body)) {
    if (body[kFileLocked]) {
      throw new ERR_INVALID_STATE("FileHandle is locked");
    }
    body[kFileLocked] = true;
    return body[kFileHandle];
  }

  throw new ERR_INVALID_ARG_TYPE(
    "options.body",
    ["string", "ArrayBuffer", "ArrayBufferView", "Blob", "FileHandle"],
    body,
  );
}

/**
 * Parses an alternating [name, value, name, value, ...] array from C++
 * into a plain header object. Multi-value headers become arrays.
 * @param {string[]} pairs
 * @returns {object}
 */
function parseHeaderPairs(pairs) {
  assert(ArrayIsArray(pairs));
  assert(pairs.length % 2 === 0);
  const block = { __proto__: null };
  for (let n = 0; n + 1 < pairs.length; n += 2) {
    if (block[pairs[n]] !== undefined) {
      if (ArrayIsArray(block[pairs[n]])) {
        ArrayPrototypePush(block[pairs[n]], pairs[n + 1]);
      } else {
        block[pairs[n]] = [block[pairs[n]], pairs[n + 1]];
      }
    } else {
      block[pairs[n]] = pairs[n + 1];
    }
  }
  return block;
}

/**
 * Applies session and stream callbacks from an options object to a session.
 * @param {QuicSession} session
 * @param {object} cbs
 */
function applyCallbacks(session, cbs) {
  const {
    onerror,
    onstream,
    ondatagram,
    ondatagramstatus,
    onpathvalidation,
    onsessionticket,
    onversionnegotiation,
    onhandshake,
    onnewtoken,
    onearlyrejected,
    onorigin,
    ongoaway,
    onkeylog,
    onqlog,
    onheaders,
    ontrailers,
    oninfo,
    onwanttrailers,
    streamIdleTimeout,
  } = cbs;
  if (onerror) session.onerror = onerror;
  if (onstream) session.onstream = onstream;
  if (ondatagram) session.ondatagram = ondatagram;
  if (ondatagramstatus) session.ondatagramstatus = ondatagramstatus;
  if (onpathvalidation) session.onpathvalidation = onpathvalidation;
  if (onsessionticket) session.onsessionticket = onsessionticket;
  if (onversionnegotiation) session.onversionnegotiation = onversionnegotiation;
  if (onhandshake) session.onhandshake = onhandshake;
  if (onnewtoken) session.onnewtoken = onnewtoken;
  if (onearlyrejected) session.onearlyrejected = onearlyrejected;
  if (onorigin) session.onorigin = onorigin;
  if (ongoaway) session.ongoaway = ongoaway;
  if (onkeylog) session.onkeylog = onkeylog;
  if (onqlog) session.onqlog = onqlog;
  if (onheaders || ontrailers || oninfo || onwanttrailers) {
    session[kStreamCallbacks] = {
      __proto__: null,
      onheaders,
      ontrailers,
      oninfo,
      onwanttrailers,
    };
  }
  if (streamIdleTimeout) {
    session[kStreamIdleTimeout] = streamIdleTimeout;
  }
}

/**
 * Configures the outbound data source for a stream. Detects the source
 * type and calls the appropriate C++ method.
 * @param {object} handle The C++ stream handle
 * @param {QuicStream} stream The JS stream object
 * @param {any} body The body source
 */
const kDefaultHighWaterMark = 65536;
const kDefaultMaxPendingDatagrams = 128;

function configureOutbound(handle, stream, body) {
  // body: null - close writable side immediately (FIN)
  if (body === null) {
    handle.initStreamingSource();
    handle.endWrite();
    return;
  }

  // Handle Promise - await and recurse. Native promises auto-flatten,
  // so the resolved value will never itself be a promise.
  if (isPromise(body)) {
    PromisePrototypeThen(
      body,
      resolved => configureOutbound(handle, stream, resolved),
      err => {
        if (!stream.destroyed) {
          stream.destroy(err);
        }
      },
    );
    return;
  }

  // Tier: One-shot - string (checked before sync iterable since
  // strings are iterable but we want the one-shot path).
  // Buffer.from may return a pooled buffer whose ArrayBuffer cannot
  // be transferred, so run it through validateBody which copies when
  // the buffer is a partial view of a larger ArrayBuffer.
  if (typeof body === "string") {
    handle.attachSource(validateBody(Buffer.from(body, "utf8")));
    return;
  }

  // Tier: Streaming - FileHandle, pumped through the streaming source (the
  // native side has no fd-backed one-shot source). Locked to prevent
  // concurrent use; closed automatically when the stream finishes
  // ([kFinishClose] closes inner.fileHandle).
  if (FileHandle.isFileHandle(body)) {
    if (body[kFileLocked]) {
      throw new ERR_INVALID_STATE("FileHandle is locked");
    }
    body[kFileLocked] = true;
    consumeAsyncSource(handle, stream, body.createReadStream());
    return;
  }

  // Tier: Streaming - Blob, pumped via its ReadableStream (the native side
  // has no blob-backed one-shot source).
  if (isBlob(body)) {
    consumeAsyncSource(handle, stream, body.stream());
    return;
  }

  // Tier: One-shot - ArrayBuffer, SharedArrayBuffer, TypedArray,
  // DataView. validateBody handles transfer-vs-copy logic,
  // SharedArrayBuffer copying, and partial view safety.
  if (isArrayBuffer(body) || isSharedArrayBuffer(body) || isArrayBufferView(body)) {
    handle.attachSource(validateBody(body));
    return;
  }

  // Tier: Streaming - AsyncIterable (ReadableStream, stream.Readable,
  // async generators, etc.). Checked before sync iterable because some
  // objects implement both protocols and we prefer async.
  if (isAsyncIterable(body)) {
    consumeAsyncSource(handle, stream, body);
    return;
  }

  // Tier: Sync iterable - consumed synchronously
  if (isSyncIterable(body)) {
    consumeSyncSource(handle, stream, body);
    return;
  }

  throw new ERR_INVALID_ARG_TYPE(
    "body",
    [
      "string",
      "ArrayBuffer",
      "SharedArrayBuffer",
      "TypedArray",
      "Blob",
      "Iterable",
      "AsyncIterable",
      "Promise",
      "null",
    ],
    body,
  );
}

// Sets the high water mark and initial writeDesiredSize for a streaming
// outbound source. Called after handle.initStreamingSource() for both
// body-source and writer paths. One-shot body sources (string, Uint8Array,
// Blob, FileHandle, etc.) do not use this -- they go through attachSource
// and are not subject to backpressure.
function initStreamingBackpressure(stream) {
  const state = getQuicStreamState(stream);
  // Only set defaults if the user hasn't already configured them
  // (e.g., via createBidirectionalStream({ highWaterMark: N })).
  if (state.highWaterMark === 0) {
    state.highWaterMark = kDefaultHighWaterMark;
  }
  if (state.writeDesiredSize === 0) {
    state.writeDesiredSize = state.highWaterMark;
  }
}

// Waits for the stream's drain callback to fire, indicating the
// outbound has capacity for more data.
function waitForDrain(stream) {
  const { promise, resolve } = PromiseWithResolvers();
  const prevDrain = stream[kDrain];
  stream[kDrain] = () => {
    stream[kDrain] = prevDrain;
    resolve();
  };
  return promise;
}

// Writes a batch to the handle, awaiting drain if backpressured.
// Returns true if the stream was destroyed during the wait.
// Only waits when writeDesiredSize is 0 (no capacity at all).
// When there is any capacity, the write proceeds even if the batch
// is larger -- the C++ side buffers the data and writeDesiredSize
// drops toward 0, letting the normal drain mechanism take over.
async function writeBatchWithDrain(handle, stream, batch) {
  const state = getQuicStreamState(stream);

  if (state.writeDesiredSize === 0) {
    await waitForDrain(stream);
    if (stream.destroyed) return true;
  }

  // Write the batch. The return value is the total queued byte count
  // on success, or undefined on failure (e.g., DataQueue append
  // rejected). Guard against silent data loss.
  const result = handle.write(batch);
  if (result === undefined) {
    if (!stream.destroyed) {
      stream.destroy(new ERR_INVALID_STATE("Stream write failed"));
    }
    return true;
  }
  return false;
}

async function consumeAsyncSource(handle, stream, source) {
  handle.initStreamingSource();
  initStreamingBackpressure(stream);
  try {
    // Normalize to AsyncIterable<Uint8Array[]>
    const normalized = streamFrom(source);
    for await (const batch of normalized) {
      if (stream.destroyed) return;
      if (await writeBatchWithDrain(handle, stream, batch)) return;
    }
    handle.endWrite();
  } catch (err) {
    if (!stream.destroyed) {
      stream.destroy(err);
    } else {
      throw err;
    }
  }
}

async function consumeSyncSource(handle, stream, source) {
  handle.initStreamingSource();
  initStreamingBackpressure(stream);
  // Normalize to Iterable<Uint8Array[]>. Manually iterate so we can
  // pause between next() calls when backpressure hits.
  const normalized = streamFromSync(source);
  const iter = normalized[SymbolIterator]();
  try {
    while (true) {
      if (stream.destroyed) return;
      const { value: batch, done } = iter.next();
      if (done) break;
      if (await writeBatchWithDrain(handle, stream, batch)) return;
    }
    handle.endWrite();
  } catch (err) {
    if (!stream.destroyed) {
      stream.destroy(err);
    } else {
      // If the stream is already destroyed, rethrow the error to avoid
      // silently swallowing it. Tho in practice this shouldn't happen.
      throw err;
    }
  }
}

function isAsyncIterable(obj) {
  return obj != null && typeof obj[SymbolAsyncIterator] === "function";
}

function isSyncIterable(obj) {
  return obj != null && typeof obj[SymbolIterator] === "function";
}

// Functions used specifically for internal or assertion purposes only.
let getQuicStreamState;
let getQuicSessionState;
let isQuicSessionDestroying;
let getQuicEndpointState;
let assertIsQuicEndpoint;
let assertIsQuicStream;
let assertIsQuicSession;
let assertHeadersSupported;
let assertEndpointNotClosedOrClosing;
let assertEndpointIsNotBusy;
let isQuicStream;
let isQuicSession;
let isQuicEndpoint;

function maybeGetCloseError(context, status, pendingError) {
  switch (context) {
    case kCloseContextClose: {
      return pendingError;
    }
    case kCloseContextBindFailure: {
      return new ERR_QUIC_ENDPOINT_CLOSED("Bind failure", status);
    }
    case kCloseContextListenFailure: {
      return new ERR_QUIC_ENDPOINT_CLOSED("Listen failure", status);
    }
    case kCloseContextReceiveFailure: {
      return new ERR_QUIC_ENDPOINT_CLOSED("Receive failure", status);
    }
    case kCloseContextSendFailure: {
      return new ERR_QUIC_ENDPOINT_CLOSED("Send failure", status);
    }
    case kCloseContextStartFailure: {
      return new ERR_QUIC_ENDPOINT_CLOSED("Start failure", status);
    }
  }
  // Otherwise return undefined.
}

class QuicStream {
  #handle;
  #inner = {
    __proto__: null,
    session: undefined,
    direction: undefined,
    isLocal: false,
    state: undefined,
    stats: undefined,
    pendingClose: undefined,
    reader: undefined,
    destroying: false,
    iteratorLocked: false,
    outboundSet: false,
    localResetError: undefined,
    writer: undefined,
    fileHandle: undefined,
    headers: undefined,
    pendingTrailers: undefined,
    onerror: undefined,
    onblocked: undefined,
    onreset: undefined,
    onheaders: undefined,
    ontrailers: undefined,
    oninfo: undefined,
    onwanttrailers: undefined,
  };

  static {
    isQuicStream = function (val) {
      return val != null && typeof val === "object" && #handle in val;
    };

    assertIsQuicStream = function (val) {
      if (!isQuicStream(val)) {
        throw new ERR_INVALID_THIS("QuicStream");
      }
    };

    assertHeadersSupported = function (session) {
      if (getQuicSessionState(session).headersSupported === 2) {
        throw new ERR_INVALID_STATE("The negotiated QUIC application protocol does not support headers");
      }
    };

    getQuicStreamState = function (stream) {
      assertIsQuicStream(stream);
      return stream.#inner.state;
    };
  }

  /**
   * @param {symbol} privateSymbol
   * @param {object} handle
   * @param {QuicSession} session
   * @param {number} direction
   * @param {boolean} [isLocal]
   */
  constructor(privateSymbol, handle, session, direction, isLocal) {
    assertPrivateSymbol(privateSymbol);

    this.#handle = handle;
    handle[kOwner] = this;
    const inner = this.#inner;
    inner.session = session;
    inner.direction = direction;
    inner.isLocal = isLocal;
    inner.state = new QuicStreamState(kPrivateConstructor, handle.state, handle.stateByteOffset);

    if (hasObserver("quic")) {
      startPerf(this, kPerfEntry, { type: "quic", name: "QuicStream" });
    }

    debug("stream created");
  }

  get [kValidatedSource]() {
    return true;
  }

  /**
   * Returns an AsyncIterator that yields Uint8Array[] batches of
   * incoming data. Only one iterator can be obtained per stream.
   * Non-readable streams return an immediately-finished iterator.
   * @yields {Uint8Array[]}
   */
  async *[SymbolAsyncIterator]() {
    assertIsQuicStream(this);
    const inner = this.#inner;
    if (inner.iteratorLocked) {
      throw new ERR_INVALID_STATE("Stream is already being read");
    }
    inner.iteratorLocked = true;

    inner.reader ??= this.#handle?.getReader();
    // Non-readable stream (outbound-only unidirectional, or closed)
    if (!inner.reader) return;

    yield* createBlobReaderIterable(inner.reader, {
      getReadError: () => {
        // The read side ends for one of three reasons:
        //   * Clean FIN received from the peer (state.finReceived
        //     === true). The iterator stops without calling this;
        //     fall through to the generic state error if it does.
        //   * Peer sent us a RESET_STREAM. The C++ side records the
        //     code in state.resetCode regardless of whether the JS
        //     onreset handler was attached. state.finReceived stays
        //     false because no FIN was seen.
        //   * We aborted locally via stream.resetStream() or
        //     stream.stopSending(). Both paths run EndReadable in
        //     C++, setting state.readEnded without setting
        //     state.finReceived. There is no peer code to surface.
        if (inner.state.readEnded && !inner.state.finReceived) {
          // `state.reset` (not the code) distinguishes the two: a peer
          // RESET_STREAM may legally carry code 0, and stopSending() records
          // a code without setting `reset`.
          if (inner.state.reset) {
            return new ERR_QUIC_STREAM_RESET(Number(inner.state.resetCode ?? 0n));
          }
          return new ERR_QUIC_STREAM_ABORTED("Stream aborted before FIN was received");
        }
        return new ERR_INVALID_STATE("The stream is not readable");
      },
    });
  }

  /**
   * True if the stream is still pending (i.e. it has not yet been opened
   * and assigned an ID).
   * @type {boolean}
   */
  get pending() {
    assertIsQuicStream(this);
    return this.#inner.state.pending;
  }

  /**
   * True if any data on this stream was received as 0-RTT (early data)
   * before the TLS handshake completed. Early data is less secure and
   * could be replayed by an attacker.
   * @type {boolean}
   */
  get early() {
    assertIsQuicStream(this);
    return this.#inner.state.early ?? this.#inner.earlySnapshot;
  }

  /**
   * The high water mark for write backpressure. When the total queued
   * outbound bytes exceeds this value, writeSync returns false and
   * desiredSize drops to 0. Default is 65536 (64KB).
   * @type {number}
   */
  get highWaterMark() {
    assertIsQuicStream(this);
    return this.#inner.state.highWaterMark;
  }

  set highWaterMark(val) {
    assertIsQuicStream(this);
    validateInteger(val, "highWaterMark", 0, 0xffffffff);
    const inner = this.#inner;
    inner.state.highWaterMark = val;
    // If writeDesiredSize hasn't been set yet (still 0 from initialization),
    // initialize it to the highWaterMark so the first write can proceed.
    if (inner.state.writeDesiredSize === 0 && val > 0) {
      inner.state.writeDesiredSize = val;
    }
  }

  /** @type {Function|undefined} */
  get onerror() {
    assertIsQuicStream(this);
    return this.#inner.onerror;
  }

  set onerror(fn) {
    assertIsQuicStream(this);
    const inner = this.#inner;
    if (fn === undefined) {
      inner.onerror = undefined;
    } else {
      validateFunction(fn, "onerror");
      inner.onerror = FunctionPrototypeBind(fn, this);
      // Lazily create the close promise so it can be marked handled.
      inner.pendingClose ??= PromiseWithResolvers();
      markPromiseAsHandled(inner.pendingClose.promise);
    }
  }

  /** @type {OnBlockedCallback} */
  get onblocked() {
    assertIsQuicStream(this);
    return this.#inner.onblocked;
  }

  set onblocked(fn) {
    assertIsQuicStream(this);
    const inner = this.#inner;
    if (fn === undefined) {
      inner.onblocked = undefined;
      inner.state.wantsBlock = false;
    } else {
      validateFunction(fn, "onblocked");
      inner.onblocked = FunctionPrototypeBind(fn, this);
      inner.state.wantsBlock = true;
    }
  }

  /** @type {OnStreamErrorCallback} */
  get onreset() {
    assertIsQuicStream(this);
    return this.#inner.onreset;
  }

  set onreset(fn) {
    assertIsQuicStream(this);
    const inner = this.#inner;
    if (fn === undefined) {
      inner.onreset = undefined;
      inner.state.wantsReset = false;
    } else {
      validateFunction(fn, "onreset");
      inner.onreset = FunctionPrototypeBind(fn, this);
      inner.state.wantsReset = true;
    }
  }

  /** @type {OnHeadersCallback} */
  get onheaders() {
    assertIsQuicStream(this);
    return this.#inner.onheaders;
  }

  set onheaders(fn) {
    assertIsQuicStream(this);
    const inner = this.#inner;
    if (fn === undefined) {
      inner.onheaders = undefined;
      inner.state.wantsHeaders = false;
    } else {
      validateFunction(fn, "onheaders");
      assertHeadersSupported(inner.session);
      inner.onheaders = FunctionPrototypeBind(fn, this);
      inner.state.wantsHeaders = true;
    }
  }

  /** @type {Function|undefined} */
  get oninfo() {
    assertIsQuicStream(this);
    return this.#inner.oninfo;
  }

  set oninfo(fn) {
    assertIsQuicStream(this);
    const inner = this.#inner;
    if (fn === undefined) {
      inner.oninfo = undefined;
    } else {
      validateFunction(fn, "oninfo");
      assertHeadersSupported(inner.session);
      inner.oninfo = FunctionPrototypeBind(fn, this);
    }
  }

  /** @type {Function|undefined} */
  get ontrailers() {
    assertIsQuicStream(this);
    return this.#inner.ontrailers;
  }

  set ontrailers(fn) {
    assertIsQuicStream(this);
    const inner = this.#inner;
    if (fn === undefined) {
      inner.ontrailers = undefined;
    } else {
      validateFunction(fn, "ontrailers");
      assertHeadersSupported(inner.session);
      inner.ontrailers = FunctionPrototypeBind(fn, this);
    }
  }

  /** @type {Function|undefined} */
  get onwanttrailers() {
    assertIsQuicStream(this);
    return this.#inner.onwanttrailers;
  }

  set onwanttrailers(fn) {
    assertIsQuicStream(this);
    const inner = this.#inner;
    if (fn === undefined) {
      inner.onwanttrailers = undefined;
      inner.state.wantsTrailers = false;
    } else {
      validateFunction(fn, "onwanttrailers");
      assertHeadersSupported(inner.session);
      inner.onwanttrailers = FunctionPrototypeBind(fn, this);
      inner.state.wantsTrailers = true;
    }
  }

  /**
   * The buffered initial headers received on this stream, or undefined
   * if the application does not support headers or no headers have
   * been received yet.
   * @type {object|undefined}
   */
  get headers() {
    assertIsQuicStream(this);
    return this.#inner.headers;
  }

  /**
   * Set trailing headers to be sent when the HTTP/3 layer asks for them.
   * @type {object|undefined}
   */
  get pendingTrailers() {
    assertIsQuicStream(this);
    return this.#inner.pendingTrailers;
  }

  set pendingTrailers(headers) {
    const inner = this.#inner;
    assertIsQuicStream(this);
    assertHeadersSupported(inner.session);
    if (headers === undefined) {
      inner.pendingTrailers = undefined;
      return;
    }
    validateObject(headers, "headers");
    inner.pendingTrailers = headers;
  }

  /**
   * The statistics collected for this stream.
   * @type {QuicStreamStats}
   */
  get stats() {
    assertIsQuicStream(this);
    const inner = this.#inner;
    const handle = this.#handle;
    return (inner.stats ??=
      handle == null
        ? QuicStreamStats[kCreateDisconnected]()
        : new QuicStreamStats(kPrivateConstructor, handle.stats, handle.statsByteOffset));
  }

  /**
   * The session this stream belongs to. If the stream is destroyed,
   * `null` will be returned.
   * @type {QuicSession | null}
   */
  get session() {
    assertIsQuicStream(this);
    return this.#inner.session;
  }

  /**
   * Returns the id for this stream. If the stream is still pending,
   * `null` will be returned.
   * @type {bigint | null}
   */
  get id() {
    assertIsQuicStream(this);
    if (this.pending) return null;
    return this.#inner.state.id;
  }

  /**
   * Returns the directionality of this stream.
   * @type {'bidi'|'uni'}
   */
  get direction() {
    assertIsQuicStream(this);
    return this.#inner.direction === kStreamDirectionBidirectional ? "bidi" : "uni";
  }

  /**
   * True if the stream has been destroyed.
   * @type {boolean}
   */
  get destroyed() {
    assertIsQuicStream(this);
    return this.#handle === undefined;
  }

  /**
   * A promise that will be resolved when the stream is closed.
   * @type {Promise<void>}
   */
  get closed() {
    assertIsQuicStream(this);
    this.#inner.pendingClose ??= PromiseWithResolvers();
    return this.#inner.pendingClose.promise;
  }

  /**
   * Immediately destroys the stream. Any queued data is discarded. If
   * an error is given, the closed promise will be rejected with that
   * error. If no error is given, the closed promise will be resolved.
   * When destroying with an error, RESET_STREAM and/or STOP_SENDING
   * are emitted to the peer for any still-open writable / readable
   * side of the stream. The wire code is resolved as:
   * `options.code` -> `error.errorCode` (when `error` is a
   * `QuicError`) -> the negotiated application's "internal error"
   * code from `QuicSessionState.internalErrorCode`.
   * @param {any} error
   * @param {QuicStreamDestroyOptions} [options]
   */
  destroy(error, options = kEmptyObject) {
    assertIsQuicStream(this);
    const inner = this.#inner;
    // Two distinct guards:
    //   * `#destroying` flips synchronously here so any re-entrant call
    //     from inside this method's user callbacks hits the guard and
    //     returns immediately.
    //   * `destroyed` (i.e. `#handle === undefined`) catches the case
    //     where the C++ side already finished cleanup via the
    //     `onStreamClose -> [kFinishClose]` path - which does NOT go
    //     through `destroy()` and therefore never sets `#destroying`.
    //     `[kFinishClose]` clears `#handle` at the end of its work.
    if (inner.destroying || this.destroyed) return;
    // Validate options up front so a malformed `options` argument
    // throws before any side effects (mutating `#destroying`,
    // emitting wire frames, invoking `onerror`, settling the closed
    // promise). The caller may retry with valid options.
    validateObject(options, "options");
    const { code: optionCode, reason } = options;
    if (optionCode !== undefined && typeof optionCode !== "bigint" && typeof optionCode !== "number") {
      throw new ERR_INVALID_ARG_TYPE("options.code", ["bigint", "number"], optionCode);
    }
    if (reason !== undefined) {
      validateString(reason, "options.reason");
    }
    inner.destroying = true;
    // Resolve the wire error code for any RESET_STREAM / STOP_SENDING
    // frames emitted below.
    let abortCode;
    if (optionCode !== undefined) {
      abortCode = BigInt(optionCode);
    } else if (error !== undefined) {
      // RESET_STREAM / STOP_SENDING carry APPLICATION error codes
      // (RFC 9000 §19.4/§19.5); a transport-typed QuicError cannot go on
      // the wire as-is and maps to the application's internal error code
      // (Node's ShutdownStream does the same).
      abortCode =
        QuicError.isQuicError(error) && error.type !== "transport"
          ? error.errorCode
          : getQuicSessionState(inner.session).internalErrorCode;
    } else {
      // No error: Node still shuts the stream down on the wire with
      // RESET_STREAM(0)/STOP_SENDING(0) (ngtcp2_conn_shutdown_stream with
      // app code 0) — a clean FIN would make the peer surface a normal
      // empty stream instead of never seeing it.
      abortCode = 0n;
    }
    // When the whole session is being torn down, the cascaded per-stream
    // destroys must not emit wire frames: the session goes away immediately
    // (Node destroys the native session before its deferred send runs), and
    // the surviving peer is expected to clean up via its own close/idle
    // timeout rather than via per-stream RESET/STOP_SENDING.
    const cascadingFromSessionDestroy = inner.session !== undefined && isQuicSessionDestroying(inner.session);
    // When destroying with an error, ensure the peer stops sending
    // data we are about to discard by emitting STOP_SENDING. The
    // condition gates the emission to error-path destroys with a
    // still-open readable side. The C++ state.readEnded flag is
    // authoritative -- it is set for locally-initiated uni streams
    // (which have no readable side) and when reading completes.
    // When destroying with an error, ensure the peer learns about it via
    // RESET_STREAM (the writer.fail path inside [kFinishClose] emits it
    // only when a writer was created) and stops sending data we are about
    // to discard via STOP_SENDING. Routed through a single native call so
    // that a stream which never reached the wire can defer (and possibly
    // drop) the frames — Node parity for streams created and abandoned in
    // one turn.
    if (abortCode !== undefined && !cascadingFromSessionDestroy) {
      const wantStop = !inner.state.readEnded;
      const wantReset = inner.writer === undefined && !inner.state.writeEnded;
      if (wantStop || wantReset) {
        this.#handle.abortForDestroy(wantStop ? abortCode : undefined, wantReset ? abortCode : undefined);
      }
    }
    const { onerror } = inner;
    if (error !== undefined && typeof onerror === "function") {
      invokeOnerror(onerror, error);
    }
    const handle = this.#handle;
    this[kFinishClose](error);
    // The cascade flag tells the native side to skip its own wire actions
    // too (reset/close of the lsquic stream): the session teardown that
    // follows frees the streams, and any frame emitted here would make the
    // otherwise-silent session destroy ack-eliciting.
    handle.destroy(cascadingFromSessionDestroy);
  }

  /**
   * Sets the outbound data source for the stream. This can only be called
   * once and must be called before any data will be sent. The body can be
   * an ArrayBuffer, a TypedArray or DataView, or a Blob. If the stream
   * is destroyed or already has an outbound data source, an error will
   * be thrown.
   * @param {ArrayBuffer|SharedArrayBuffer|ArrayBufferView|Blob} outbound
   */
  setOutbound(outbound) {
    assertIsQuicStream(this);
    if (this.destroyed) {
      throw new ERR_INVALID_STATE("Stream is destroyed");
    }
    if (this.#inner.state.hasOutbound) {
      throw new ERR_INVALID_STATE("Stream already has an outbound data source");
    }
    this.#handle.attachSource(validateBody(outbound));
  }

  /**
   * @param {object} headers
   * @param {SendHeadersOptions} [options]
   * @returns {boolean}
   */
  sendHeaders(headers, options = kEmptyObject) {
    assertIsQuicStream(this);
    if (this.destroyed) return false;
    if (getQuicSessionState(this.#inner.session).headersSupported === 2) {
      throw new ERR_INVALID_STATE("The negotiated QUIC application protocol does not support headers");
    }
    validateObject(headers, "headers");
    const { terminal = false } = options;
    const headerString = buildNgHeaderString(headers, assertValidPseudoHeader, true /* strictSingleValueFields */);
    const flags = terminal ? kHeadersFlagsTerminal : kHeadersFlagsNone;
    return this.#handle.sendHeaders(kHeadersKindInitial, headerString, flags);
  }

  /**
   * Send informational (1xx) headers on this stream. Server only.
   * Throws if the application does not support headers.
   * @param {object} headers
   * @returns {boolean}
   */
  sendInformationalHeaders(headers) {
    assertIsQuicStream(this);
    if (this.destroyed) return false;
    if (getQuicSessionState(this.#inner.session).headersSupported === 2) {
      throw new ERR_INVALID_STATE("The negotiated QUIC application protocol does not support headers");
    }
    validateObject(headers, "headers");
    const headerString = buildNgHeaderString(headers, assertValidPseudoHeader, true);
    return this.#handle.sendHeaders(kHeadersKindHints, headerString, kHeadersFlagsNone);
  }

  /**
   * Send trailing headers on this stream. Must be called synchronously
   * during the onwanttrailers callback, or set via pendingTrailers before
   * the body completes. Throws if the application does not support headers.
   * @param {object} headers
   * @returns {boolean}
   */
  sendTrailers(headers) {
    assertIsQuicStream(this);
    if (this.destroyed) return false;
    if (getQuicSessionState(this.#inner.session).headersSupported === 2) {
      throw new ERR_INVALID_STATE("The negotiated QUIC application protocol does not support headers");
    }
    validateObject(headers, "headers");
    const headerString = buildNgHeaderString(headers, assertValidPseudoHeaderTrailer);
    return this.#handle.sendHeaders(kHeadersKindTrailing, headerString, kHeadersFlagsNone);
  }

  /**
   * Returns a Writer for pushing data to this stream incrementally.
   * Only available when no body source was provided at creation time
   * or via setBody(). Non-writable streams return an already-closed Writer.
   * @type {object}
   */
  get writer() {
    assertIsQuicStream(this);
    const inner = this.#inner;
    const existingWriter = inner.writer;
    if (existingWriter !== undefined) return existingWriter;
    if (inner.outboundSet) {
      throw new ERR_INVALID_STATE("Stream outbound already configured with a body source");
    }

    const handle = this.#handle;
    const stream = this;
    let closed = false;
    let errored = false;
    let error = null;
    let totalBytesWritten = 0;
    let drainWakeup = null;

    // Drain callback - C++ fires this when send buffer has space
    stream[kDrain] = () => {
      if (drainWakeup) {
        drainWakeup.resolve(true);
        drainWakeup = null;
      }
    };

    // A note on backpressure handling: per the stream/iter spec, the default
    // backpressure policy for writers is strict, meaning that if the stream
    // signals backpressure additional writes are rejected until the buffer has
    // capacity again.

    function writeSync(chunk) {
      // If the stream is closed, errored, or write-ended, we cannot accept
      // more data. Refuse the sync write.
      // If a drain is already pending, another operation is waiting
      // for capacity. Refuse the sync write.
      if (closed || errored || stream.#inner.state.writeEnded || drainWakeup != null) {
        return false;
      }
      chunk = toUint8Array(chunk);
      const len = TypedArrayPrototypeGetByteLength(chunk);
      if (len === 0) return true;
      // Refuse the write only when there is no available capacity at
      // all. When writeDesiredSize > 0 we allow the write even if the
      // chunk is larger than the remaining capacity -- the C++ side
      // will accept the data into the DataQueue and
      // UpdateWriteDesiredSize() will drop writeDesiredSize toward 0,
      // at which point the standard drain mechanism takes over.
      // This follows the Web Streams model where writes beyond the HWM
      // succeed and backpressure applies to *subsequent* writes.
      if (stream.#inner.state.writeDesiredSize === 0) return false;
      const result = handle.write([chunk]);
      if (result === undefined) return false;
      totalBytesWritten += len;
      return true;
    }

    async function write(chunk, options = kEmptyObject) {
      validateObject(options, "options");
      const { signal } = options;
      if (signal !== undefined) {
        validateAbortSignal(signal, "options.signal");
        signal.throwIfAborted();
      }
      if (errored) throw error;
      if (closed || stream.#inner.state.writeEnded) {
        throw new ERR_INVALID_STATE("Writer is closed");
      }
      // If a drain is already pending, another operation is waiting
      // for capacity. Under strict policy, reject immediately.
      // Later, if we add support for other backpressure policies,
      // we could instead await the existing drain before proceeding.
      if (drainWakeup != null) {
        throw new ERR_INVALID_STATE("Stream write buffer is full");
      }

      if (!writeSync(chunk)) {
        throw new ERR_INVALID_STATE("Stream write buffer is full");
      }
    }

    function writevSync(chunks) {
      if (closed || errored || stream.#inner.state.writeEnded || drainWakeup != null) {
        return false;
      }
      chunks = convertChunks(chunks);
      let len = 0;
      for (const c of chunks) len += TypedArrayPrototypeGetByteLength(c);
      if (len === 0) return true;
      if (stream.#inner.state.writeDesiredSize === 0) return false;
      const result = handle.write(chunks);
      if (result === undefined) return false;
      totalBytesWritten += len;
      return true;
    }

    async function writev(chunks, options = kEmptyObject) {
      validateObject(options, "options");
      const { signal } = options;
      if (signal !== undefined) {
        validateAbortSignal(signal, "options.signal");
        signal.throwIfAborted();
      }

      if (errored) throw error;
      if (closed || stream.#inner.state.writeEnded) {
        throw new ERR_INVALID_STATE("Writer is closed");
      }

      // If a drain is already pending, another operation is waiting
      // for capacity. Under strict policy, reject immediately.
      // Later, if we add support for other backpressure policies,
      // we could instead await the existing drain before proceeding.
      if (drainWakeup != null) {
        throw new ERR_INVALID_STATE("Stream write buffer is full");
      }

      if (!writevSync(chunks)) {
        throw new ERR_INVALID_STATE("Stream write buffer is full");
      }
    }

    function endSync() {
      // Per the streams/iter spec, endSync and end follow a try-fallback
      // pattern. That is, callers should try endSync first and if it returns
      // -1, then they should call and await end(). This is a signal that sync
      // end is not currently possible. However, we always support sync end
      // here unless the stream is already errored.
      if (errored) return -1;

      // If we're already closed, just return the total bytes written.
      if (closed) return totalBytesWritten;

      // If we are waiting for drain to complete, we cannot end synchronously.
      if (drainWakeup != null) return -1;

      // Fantastic, we can end synchronously!
      handle.endWrite();
      closed = true;
      return totalBytesWritten;
    }

    async function end(options = kEmptyObject) {
      validateObject(options, "options");
      const { signal } = options;
      if (signal !== undefined) {
        validateAbortSignal(signal, "options.signal");
        signal.throwIfAborted();
        // TODO(@jasnell): The stream/iter spec allows individual sync end
        // calls to be canceled via an AbortSignal. We currently do not support
        // this, but we can add before the impl is graduated from experimental.
        // At most we do here is check for signal abort at the start of the call.
      }

      // Per the streams/iter spec, endSync and end follow a try-fallback
      // pattern. That is, callers should try endSync first and if it returns
      // -1, then they should call and await end(). This is a signal that sync
      // end is not currently possible. However, we always support sync end
      // here unless the stream is already errored.
      // While the user should have already called endSync, we call it again
      // here to actually process the end request. At worst it's called twice.
      const n = endSync();

      // A return value of -1 indicates that endSync was not yet able to
      // process the end request, either because we are errored or because we
      // are awaiting drain. If we're errored, throw the error. If we're waiting
      // for drain, await it and then try ending again.

      if (n >= 0) return n;
      if (errored) throw error;

      drainWakeup ??= PromiseWithResolvers();
      try {
        await drainWakeup.promise;
      } finally {
        drainWakeup = null;
      }
      return endSync();
    }

    function fail(reason) {
      if (closed || errored) return;
      errored = true;
      error = reason ?? new ERR_INVALID_STATE("Failed");
      // Resolve the wire code for the RESET_STREAM in priority order:
      //   1. If `reason` is a `QuicError`, use its explicit
      //      `errorCode`.
      //   2. Any other `reason` falls back to the negotiated
      //      application's "internal error" code, surfaced via
      //      `QuicSessionState.internalErrorCode`. For HTTP/3 this is
      //      `H3_INTERNAL_ERROR` (0x102); for raw QUIC applications
      //      it falls back to the QUIC transport-layer
      //      `INTERNAL_ERROR` (0x1).
      //   3. `fail()` with no reason (writer disposal, clean teardown)
      //      uses `0n`, which the peer treats as a clean completion.
      const code =
        reason === undefined
          ? 0n
          : QuicError.isQuicError(error)
            ? error.errorCode
            : getQuicSessionState(stream.#inner.session).internalErrorCode;
      handle.resetStream(code);
      // The error already reached the writer's caller; the stream's
      // `closed` promise will reject with the locally recorded reset code
      // when the stream tears down, and nothing is required to observe it.
      markPromiseAsHandled(stream.closed);
      if (drainWakeup != null) {
        drainWakeup.reject(error);
        drainWakeup = null;
      }
    }

    const writer = {
      __proto__: null,
      get desiredSize() {
        if (closed || errored || stream.#inner.state.writeEnded) return null;
        return stream.#inner.state.writeDesiredSize;
      },
      writeSync,
      write,
      writevSync,
      writev,
      endSync,
      end,
      fail,
      [drainableProtocol]() {
        if (closed || errored) return null;
        // If a drain is already pending, return the existing promise.
        if (drainWakeup != null) return drainWakeup.promise;
        if (stream.#inner.state.writeDesiredSize > 0) return null;
        drainWakeup = PromiseWithResolvers();
        return drainWakeup.promise;
      },
      [SymbolAsyncDispose]() {
        if (!closed && !errored) fail();
        return PromiseResolve();
      },
      [SymbolDispose]() {
        if (!closed && !errored) fail();
      },
    };

    // Non-writable stream - return a pre-closed writer.
    // A remote unidirectional stream is read-only and has no writable
    // side. isLocal distinguishes locally-initiated (writable) from
    // remotely-initiated (read-only) uni streams.
    if (
      !handle ||
      this.destroyed ||
      inner.state.writeEnded ||
      (inner.direction === kStreamDirectionUnidirectional && !inner.isLocal)
    ) {
      closed = true;
      return (inner.writer = writer);
    }

    // Initialize the outbound DataQueue for streaming writes
    handle.initStreamingSource();
    initStreamingBackpressure(this);

    return (inner.writer = writer);
  }

  /**
   * Sets the outbound body source for this stream. Accepts all body
   * source types (string, TypedArray, Blob, AsyncIterable, Promise, null).
   * Can only be called once. Mutually exclusive with stream.writer.
   * @param {any} body
   */
  setBody(body) {
    assertIsQuicStream(this);
    if (this.destroyed) {
      throw new ERR_INVALID_STATE("Stream is destroyed");
    }
    const inner = this.#inner;
    if (inner.outboundSet) {
      throw new ERR_INVALID_STATE("Stream outbound already configured");
    }
    if (inner.writer !== undefined) {
      throw new ERR_INVALID_STATE("Stream writer already accessed");
    }
    inner.outboundSet = true;
    // If the body is a FileHandle, store it so it is closed
    // automatically when the stream finishes.
    if (FileHandle.isFileHandle(body)) {
      inner.fileHandle = body;
    }
    configureOutbound(this.#handle, this, body);
  }

  /**
   * Associates a FileHandle with this stream so it is closed automatically
   * when the stream finishes. Called internally when a FileHandle is used
   * as a body source.
   * @param {FileHandle} fh
   */
  [kAttachFileHandle](fh) {
    this.#inner.fileHandle = fh;
  }

  /**
   * Tells the peer to stop sending data for this stream. The optional error
   * code will be sent to the peer as part of the request. If the stream is
   * already destroyed, this is a no-op. No acknowledgement of this action
   * will be provided.
   * @param {number|bigint} code
   */
  stopSending(code = 0n) {
    assertIsQuicStream(this);
    if (this.destroyed) return;
    this.#handle.stopSending(BigInt(code));
  }

  /**
   * Tells the peer that this end will not send any more data on this stream.
   * The optional error code will be sent to the peer as part of the
   * request. If the stream is already destroyed, this is a no-op. No
   * acknowledgement of this action will be provided.
   * @param {number|bigint} code
   */
  resetStream(code = 0n) {
    assertIsQuicStream(this);
    if (this.destroyed) return;
    code = BigInt(code);
    this.#handle.resetStream(code);
    // An explicit local reset is an abnormal termination of the stream:
    // surface it through `closed` once the stream finishes, the same way a
    // peer-initiated reset is surfaced (the writer.fail() path settles
    // `closed` through destroy() instead and does not take this branch).
    this.#inner.localResetError ??= makeQuicError(
      "ERR_QUIC_APPLICATION_ERROR",
      "QUIC application error",
      "application",
      code,
      `stream reset with code ${code}`,
    );
  }

  /**
   * The priority of the stream. If the stream is destroyed or if
   * the session does not support priority, `null` will be
   * returned.
   * @type {StreamPriority | null}
   */
  get priority() {
    assertIsQuicStream(this);
    // headersSupported is tri-state: 0 = ALPN not yet settled (pending
    // streams still expose the priority they were created with), 1 = h3,
    // 2 = definitively raw QUIC (no priority extension).
    if (this.destroyed || getQuicSessionState(this.#inner.session).headersSupported === 2) return null;
    const packed = this.#handle.getPriority();
    const urgency = packed >> 1;
    const incremental = !!(packed & 1);
    const level = urgency < 3 ? "high" : urgency > 3 ? "low" : "default";
    return { level, incremental };
  }

  /**
   * Sets the priority of the stream.
   * @param {StreamPriority} [options]
   */
  setPriority(options = kEmptyObject) {
    assertIsQuicStream(this);
    if (this.destroyed) return;
    if (!getQuicSessionState(this.#inner.session).isPrioritySupported) {
      throw new ERR_INVALID_STATE("The session does not support stream priority");
    }
    validateObject(options, "options");
    const { level = "default", incremental = false } = options;
    validateOneOf(level, "options.level", ["default", "low", "high"]);
    validateBoolean(incremental, "options.incremental");
    const urgency = level === "high" ? 0 : level === "low" ? 7 : 3;
    this.#handle.setPriority((urgency << 1) | (incremental ? 1 : 0));
  }

  /**
   * Send a block of headers. The headers are formatted as an array
   * of key, value pairs. The reason we don't use a Headers object
   * here is because this needs to be able to represent headers like
   * :method which the high-level Headers API does not allow.
   *
   * Note that QUIC in general does not support headers. This method
   * is in place to support HTTP3 and is therefore not generally
   * exposed except via a private symbol.
   * @param {object} headers
   * @returns {boolean} true if the headers were scheduled to be sent.
   */
  [kSendHeaders](headers, kind = kHeadersKindInitial, flags = kHeadersFlagsTerminal) {
    validateObject(headers, "headers");
    if (getQuicSessionState(this.#inner.session).headersSupported === 2) {
      throw new ERR_INVALID_STATE("The negotiated QUIC application protocol does not support headers");
    }
    if (this.pending) {
      debug("pending stream enqueuing headers", headers);
    } else {
      debug(`stream ${this.id} sending headers`, headers);
    }
    const headerString = buildNgHeaderString(
      headers,
      assertValidPseudoHeader,
      true, // This could become an option in future
    );
    return this.#handle.sendHeaders(kind, headerString, flags);
  }

  [kFinishClose](error) {
    const inner = this.#inner;
    inner.pendingClose ??= PromiseWithResolvers();
    if (this.destroyed) {
      return inner.pendingClose.promise;
    }
    // A stream the local side explicitly reset (stream.resetStream(code))
    // did not finish cleanly even when the close itself carries no error.
    // An explicit destroy() (destroying === true) settles closed with
    // whatever error destroy() was given, including none.
    if (!inner.destroying) {
      error ??= inner.localResetError;
    }
    if (error !== undefined) {
      inner.pendingClose.reject(error);
    } else {
      inner.pendingClose.resolve();
    }
    debug("stream closed");
    if (onStreamClosedChannel.hasSubscribers) {
      onStreamClosedChannel.publish({
        __proto__: null,
        stream: this,
        session: inner.session,
        error,
        stats: this.stats,
      });
    }
    if (this[kPerfEntry] && hasObserver("quic")) {
      stopPerf(this, kPerfEntry, {
        detail: {
          stats: this.stats,
          direction: this.direction,
        },
      });
    }
    inner.stats?.[kFinishClose]();
    // `stream.early` stays readable after close (the peer's 0-RTT flag is
    // often checked once the exchange completes).
    inner.earlySnapshot = inner.state?.early;
    inner.state?.[kFinishClose]();
    inner.session[kRemoveStream](this);
    inner.writer?.fail(error);
    // Materialize the reader before dropping the handle: data the peer
    // delivered before the close stays buffered natively, and an iterator
    // obtained after the close must still drain it (then hit EOS).
    inner.reader ??= this.#handle?.getReader();
    inner.session = undefined;
    inner.pendingClose.reject = undefined;
    inner.pendingClose.resolve = undefined;
    inner.onblocked = undefined;
    inner.onreset = undefined;
    inner.onheaders = undefined;
    inner.onerror = undefined;
    inner.ontrailers = undefined;
    inner.oninfo = undefined;
    inner.onwanttrailers = undefined;
    inner.headers = undefined;
    inner.pendingTrailers = undefined;
    this.#handle = undefined;
    // Wake anything parked in waitForDrain(): only the native StreamDrain
    // event resolves it, and that stops at close. `#handle` is already
    // cleared, so the resumed writer sees `destroyed` and bails.
    this[kDrain]?.();
    if (inner.fileHandle !== undefined) {
      // Close the FileHandle that was used as a body source. The close
      // may fail if the user already closed it -- that's expected and
      // harmless, so mark the promise as handled.
      markPromiseAsHandled(this.#inner.fileHandle.close());
      inner.fileHandle = undefined;
    }
  }

  [kBlocked]() {
    const inner = this.#inner;
    // The blocked event should only be called if the stream was created with
    // an onblocked callback. The callback should always exist here.
    assert(inner.onblocked, "Unexpected stream blocked event");
    if (onStreamBlockedChannel.hasSubscribers) {
      onStreamBlockedChannel.publish({
        __proto__: null,
        stream: this,
        session: inner.session,
      });
    }
    safeCallbackInvoke(inner.onblocked, this);
  }

  [kDrain]() {
    // No-op by default. Overridden by the writer closure when
    // stream.writer is accessed.
  }

  [kReset](error) {
    const inner = this.#inner;
    // The reset event should only be called if the stream was created with
    // an onreset callback. The callback should always exist here.
    assert(inner.onreset, "Unexpected stream reset event");
    if (onStreamResetChannel.hasSubscribers) {
      onStreamResetChannel.publish({
        __proto__: null,
        stream: this,
        session: inner.session,
        error,
      });
    }
    safeCallbackInvoke(inner.onreset, this, error);
  }

  [kHeaders](headers, kind) {
    const block = parseHeaderPairs(headers);
    const kindName = kHeadersKindName[kind] ?? kind;
    const inner = this.#inner;

    switch (kindName) {
      case "initial":
        assert(inner.onheaders, "Unexpected stream headers event");
        inner.headers ??= block;
        if (onStreamHeadersChannel.hasSubscribers) {
          onStreamHeadersChannel.publish({
            __proto__: null,
            stream: this,
            session: inner.session,
            headers: block,
          });
        }
        safeCallbackInvoke(inner.onheaders, this, block);
        break;
      case "trailing":
        if (onStreamTrailersChannel.hasSubscribers) {
          onStreamTrailersChannel.publish({
            __proto__: null,
            stream: this,
            session: inner.session,
            trailers: block,
          });
        }
        {
          const { ontrailers } = inner;
          if (ontrailers) safeCallbackInvoke(ontrailers, this, block);
        }
        break;
      case "hints":
        if (onStreamInfoChannel.hasSubscribers) {
          onStreamInfoChannel.publish({
            __proto__: null,
            stream: this,
            session: inner.session,
            headers: block,
          });
        }
        {
          const { oninfo } = inner;
          if (typeof oninfo === "function") safeCallbackInvoke(oninfo, this, block);
        }
        break;
    }
  }

  [kTrailers]() {
    if (this.destroyed) return;
    const inner = this.#inner;

    // The HTTP/3 layer is asking us to provide trailers to send.
    // Check for pre-set pendingTrailers first, then the callback.
    if (inner.pendingTrailers) {
      this.sendTrailers(inner.pendingTrailers);
      inner.pendingTrailers = undefined;
    } else {
      const { onwanttrailers } = inner;
      if (typeof onwanttrailers === "function") safeCallbackInvoke(onwanttrailers, this);
    }
  }

  [kInspect](depth, options) {
    if (depth < 0) {
      return "QuicStream { }";
    }

    const opts = {
      __proto__: null,
      ...options,
      depth: options.depth == null ? null : options.depth - 1,
    };

    const { id, direction, pending, stats, session } = this;

    return `QuicStream ${inspect(
      {
        __proto__: null,
        id,
        direction,
        pending,
        stats,
        state: this.#inner.state,
        session,
      },
      opts,
    )}`;
  }
}

class QuicSession {
  /** @type {object|undefined} */
  #handle;

  #inner = {
    __proto__: null,
    /** @type {QuicEndpoint} */
    endpoint: undefined,
    isPendingClose: false,
    selfInitiatedClose: false,
    destroying: false,
    handshakeCompleted: false,
    pendingClose: PromiseWithResolvers(),
    pendingOpen: PromiseWithResolvers(),
    /** @type {QuicSessionState} */
    state: undefined,
    /** @type {QuicSessionStats} */
    stats: undefined,
    streams: new SafeSet(),
    onerror: undefined,
    onstream: undefined,
    ondatagram: undefined,
    ondatagramstatus: undefined,
    onpathvalidation: undefined,
    onsessionticket: undefined,
    onversionnegotiation: undefined,
    onhandshake: undefined,
    onnewtoken: undefined,
    onearlyrejected: undefined,
    onorigin: undefined,
    ongoaway: undefined,
    onkeylog: undefined,
    onqlog: undefined,
    pendingQlog: undefined,
    // Default to 'manual' (no auto-rejection). Client sessions override
    // this via kVerifyPeer in kConnect. Server sessions keep 'manual'
    // because server-side cert validation is handled by rejectUnauthorized
    // at the C++ level.
    verifyPeer: "manual",
    handshakeInfo: undefined,
    /** @type {QuicSessionPath|undefined} */
    path: undefined,
    certificate: undefined,
    peerCertificate: undefined,
    ephemeralKeyInfo: undefined,
    localTransportParams: undefined,
    remoteTransportParams: undefined,
  };

  static {
    isQuicSession = function (val) {
      return val != null && typeof val === "object" && #handle in val;
    };

    assertIsQuicSession = function (val) {
      if (!isQuicSession(val)) {
        throw new ERR_INVALID_THIS("QuicSession");
      }
    };

    getQuicSessionState = function (session) {
      assertIsQuicSession(session);
      return session.#inner.state;
    };

    isQuicSessionDestroying = function (session) {
      assertIsQuicSession(session);
      return session.#inner.destroying;
    };
  }

  /**
   * @param {symbol} privateSymbol
   * @param {object} handle
   * @param {QuicEndpoint} endpoint
   */
  constructor(privateSymbol, handle, endpoint) {
    // Instances of QuicSession can only be created internally.
    assertPrivateSymbol(privateSymbol);

    this.#handle = handle;
    this.#handle[kOwner] = this;

    const inner = this.#inner;
    inner.endpoint = endpoint;
    // Move any qlog entries that arrived before the wrapper existed.
    if (handle._pendingQlog !== undefined) {
      inner.pendingQlog = handle._pendingQlog;
      handle._pendingQlog = undefined;
    }
    inner.stats = new QuicSessionStats(kPrivateConstructor, handle.stats, handle.statsByteOffset);
    inner.state = new QuicSessionState(kPrivateConstructor, handle.state, handle.stateByteOffset);

    if (hasObserver("quic")) {
      startPerf(this, kPerfEntry, { type: "quic", name: "QuicSession" });
    }

    debug("session created");
  }

  get applicationOptions() {
    // We don't cache application options because they may be updated by the
    // C++ layer after session creation depending on the behavior of the
    // application.
    if (this.destroyed) return null;
    return this.#handle.applicationOptions();
  }

  get localTransportParams() {
    if (this.#inner.localTransportParams !== undefined) {
      return this.#inner.localTransportParams;
    }
    // If the handle is already gone, we cannot retrieve the transport params.
    if (this.destroyed) return null;
    const params = this.#handle.localTransportParams();
    if (params.preferredAddressIpv4 !== undefined) {
      params.preferredAddressIpv4 = new InternalSocketAddress(params.preferredAddressIpv4);
    }
    if (params.preferredAddressIpv6 !== undefined) {
      params.preferredAddressIpv6 = new InternalSocketAddress(params.preferredAddressIpv6);
    }
    return (this.#inner.localTransportParams = params);
  }

  get remoteTransportParams() {
    if (this.#inner.remoteTransportParams !== undefined) {
      return this.#inner.remoteTransportParams;
    }
    // If the handle is already gone, we cannot retrieve the transport params.
    if (this.destroyed) return null;
    const params = this.#handle.remoteTransportParams();
    // If params is undefined, the transport parameters have not yet been received.
    // Note the distinction between this and the case where the handle is gone.
    // If the handle is gone, we return null because we know the transport
    // parameters will be unavailable. If the transport parameters have not yet
    // been received, we return undefined to indicate that they may still become
    // available in the future.
    if (params === undefined) return undefined;
    if (params.preferredAddressIpv4 !== undefined) {
      params.preferredAddressIpv4 = new InternalSocketAddress(params.preferredAddressIpv4);
    }
    if (params.preferredAddressIpv6 !== undefined) {
      params.preferredAddressIpv6 = new InternalSocketAddress(params.preferredAddressIpv6);
    }
    return (this.#inner.remoteTransportParams = params);
  }

  /** @type {boolean} */
  get #isClosedOrClosing() {
    return this.#handle === undefined || this.#inner.isPendingClose;
  }

  /** @type {Function|undefined} */
  get onerror() {
    assertIsQuicSession(this);
    return this.#inner.onerror;
  }

  set onerror(fn) {
    assertIsQuicSession(this);
    const inner = this.#inner;
    if (fn === undefined) {
      inner.onerror = undefined;
    } else {
      validateFunction(fn, "onerror");
      inner.onerror = FunctionPrototypeBind(fn, this);
      // When an onerror handler is provided, mark the pending promises
      // as handled so that rejections from destroy(error) don't surface
      // as unhandled rejections. The onerror callback is the
      // application's error handler for this session.
      markPromiseAsHandled(inner.pendingClose.promise);
      markPromiseAsHandled(inner.pendingOpen.promise);
      // Also mark existing streams' closed promises. Stream rejections
      // during session destruction are expected collateral when the
      // session has an error handler.
      for (const stream of inner.streams) {
        markPromiseAsHandled(stream.closed);
      }
    }
  }

  /** @type {OnStreamCallback} */
  get onstream() {
    assertIsQuicSession(this);
    return this.#inner.onstream;
  }

  set onstream(fn) {
    assertIsQuicSession(this);
    const inner = this.#inner;
    if (fn === undefined) {
      inner.onstream = undefined;
    } else {
      validateFunction(fn, "onstream");
      inner.onstream = FunctionPrototypeBind(fn, this);
    }
  }

  /** @type {OnDatagramCallback} */
  get ondatagram() {
    assertIsQuicSession(this);
    return this.#inner.ondatagram;
  }

  set ondatagram(fn) {
    assertIsQuicSession(this);
    const inner = this.#inner;
    if (fn === undefined) {
      inner.ondatagram = undefined;
      inner.state.hasDatagramListener = false;
    } else {
      validateFunction(fn, "ondatagram");
      inner.ondatagram = FunctionPrototypeBind(fn, this);
      inner.state.hasDatagramListener = true;
    }
  }

  /**
   * The ondatagramstatus callback is called when the status of a sent datagram
   * is received. This is best-effort only.
   * @type {OnDatagramStatusCallback}
   */
  get ondatagramstatus() {
    assertIsQuicSession(this);
    return this.#inner.ondatagramstatus;
  }

  set ondatagramstatus(fn) {
    assertIsQuicSession(this);
    const inner = this.#inner;
    if (fn === undefined) {
      inner.ondatagramstatus = undefined;
      inner.state.hasDatagramStatusListener = false;
    } else {
      validateFunction(fn, "ondatagramstatus");
      inner.ondatagramstatus = FunctionPrototypeBind(fn, this);
      inner.state.hasDatagramStatusListener = true;
    }
  }

  /** @type {Function|undefined} */
  get onpathvalidation() {
    assertIsQuicSession(this);
    return this.#inner.onpathvalidation;
  }

  set onpathvalidation(fn) {
    assertIsQuicSession(this);
    const inner = this.#inner;
    if (fn === undefined) {
      inner.onpathvalidation = undefined;
      inner.state.hasPathValidationListener = false;
    } else {
      validateFunction(fn, "onpathvalidation");
      inner.onpathvalidation = FunctionPrototypeBind(fn, this);
      inner.state.hasPathValidationListener = true;
    }
  }

  get onkeylog() {
    assertIsQuicSession(this);
    return this.#inner.onkeylog;
  }

  set onkeylog(fn) {
    assertIsQuicSession(this);
    const inner = this.#inner;
    if (fn === undefined) {
      inner.onkeylog = undefined;
    } else {
      validateFunction(fn, "onkeylog");
      inner.onkeylog = FunctionPrototypeBind(fn, this);
    }
  }

  get onqlog() {
    assertIsQuicSession(this);
    return this.#inner.onqlog;
  }

  set onqlog(fn) {
    assertIsQuicSession(this);
    const inner = this.#inner;
    if (fn === undefined) {
      inner.onqlog = undefined;
    } else {
      validateFunction(fn, "onqlog");
      inner.onqlog = FunctionPrototypeBind(fn, this);
      // Flush any qlog entries that were cached before the callback was set.
      if (inner.pendingQlog !== undefined) {
        const pending = inner.pendingQlog;
        inner.pendingQlog = undefined;
        for (let i = 0; i < pending.length; i += 2) {
          this[kQlog](pending[i], pending[i + 1]);
        }
      }
    }
  }

  /** @type {Function|undefined} */
  get onsessionticket() {
    assertIsQuicSession(this);
    return this.#inner.onsessionticket;
  }

  set onsessionticket(fn) {
    assertIsQuicSession(this);
    const inner = this.#inner;
    if (fn === undefined) {
      inner.onsessionticket = undefined;
      inner.state.hasSessionTicketListener = false;
    } else {
      validateFunction(fn, "onsessionticket");
      inner.onsessionticket = FunctionPrototypeBind(fn, this);
      inner.state.hasSessionTicketListener = true;
    }
  }

  /** @type {Function|undefined} */
  get onversionnegotiation() {
    assertIsQuicSession(this);
    return this.#inner.onversionnegotiation;
  }

  set onversionnegotiation(fn) {
    assertIsQuicSession(this);
    const inner = this.#inner;
    if (fn === undefined) {
      inner.onversionnegotiation = undefined;
    } else {
      validateFunction(fn, "onversionnegotiation");
      inner.onversionnegotiation = FunctionPrototypeBind(fn, this);
    }
  }

  /** @type {Function|undefined} */
  get onhandshake() {
    assertIsQuicSession(this);
    return this.#inner.onhandshake;
  }

  set onhandshake(fn) {
    assertIsQuicSession(this);
    const inner = this.#inner;
    if (fn === undefined) {
      inner.onhandshake = undefined;
    } else {
      validateFunction(fn, "onhandshake");
      inner.onhandshake = FunctionPrototypeBind(fn, this);
    }
  }

  /** @type {Function|undefined} */
  get onnewtoken() {
    assertIsQuicSession(this);
    return this.#inner.onnewtoken;
  }

  set onnewtoken(fn) {
    assertIsQuicSession(this);
    const inner = this.#inner;
    if (fn === undefined) {
      inner.onnewtoken = undefined;
      inner.state.hasNewTokenListener = false;
    } else {
      validateFunction(fn, "onnewtoken");
      inner.onnewtoken = FunctionPrototypeBind(fn, this);
      inner.state.hasNewTokenListener = true;
    }
  }

  /** @type {Function|undefined} */
  get onearlyrejected() {
    assertIsQuicSession(this);
    return this.#inner.onearlyrejected;
  }

  set onearlyrejected(fn) {
    assertIsQuicSession(this);
    const inner = this.#inner;
    if (fn === undefined) {
      inner.onearlyrejected = undefined;
    } else {
      validateFunction(fn, "onearlyrejected");
      inner.onearlyrejected = FunctionPrototypeBind(fn, this);
    }
  }

  /** @type {Function|undefined} */
  get onorigin() {
    assertIsQuicSession(this);
    return this.#inner.onorigin;
  }

  set onorigin(fn) {
    assertIsQuicSession(this);
    const inner = this.#inner;
    if (fn === undefined) {
      inner.onorigin = undefined;
      inner.state.hasOriginListener = false;
    } else {
      validateFunction(fn, "onorigin");
      inner.onorigin = FunctionPrototypeBind(fn, this);
      inner.state.hasOriginListener = true;
    }
  }

  /** @type {Function|undefined} */
  get ongoaway() {
    assertIsQuicSession(this);
    return this.#inner.ongoaway;
  }

  set ongoaway(fn) {
    assertIsQuicSession(this);
    const inner = this.#inner;
    if (fn === undefined) {
      inner.ongoaway = undefined;
    } else {
      validateFunction(fn, "ongoaway");
      inner.ongoaway = FunctionPrototypeBind(fn, this);
    }
  }

  /**
   * The maximum datagram size the peer will accept, or 0 if datagrams
   * are not supported or the handshake has not yet completed.
   * @type {bigint}
   */
  get maxDatagramSize() {
    assertIsQuicSession(this);
    return this.#inner.state.maxDatagramSize;
  }

  /**
   * Maximum number of datagrams that can be queued while inside a
   * native callback scope. When the queue is full, the oldest
   * datagram is dropped and reported as lost. Default is 128.
   * @type {number}
   */
  get maxPendingDatagrams() {
    assertIsQuicSession(this);
    return this.#inner.state.maxPendingDatagrams;
  }

  set maxPendingDatagrams(val) {
    assertIsQuicSession(this);
    validateInteger(val, "maxPendingDatagrams", 0, 0xffff);
    this.#inner.state.maxPendingDatagrams = val;
  }

  /**
   * The statistics collected for this session.
   * @type {QuicSessionStats}
   */
  get stats() {
    assertIsQuicSession(this);
    return this.#inner.stats;
  }

  /**
   * The endpoint this session belongs to. If the session has been destroyed,
   * `null` will be returned.
   * @type {QuicEndpoint|null}
   */
  get endpoint() {
    assertIsQuicSession(this);
    if (this.destroyed) return null;
    return this.#inner.endpoint;
  }

  /**
   * The local and remote socket addresses associated with the session.
   * @type {QuicSessionPath | undefined}
   */
  get path() {
    assertIsQuicSession(this);
    if (this.destroyed) return undefined;
    return (this.#inner.path ??= {
      __proto__: null,
      local: new InternalSocketAddress(this.#handle.getLocalAddress()),
      remote: new InternalSocketAddress(this.#handle.getRemoteAddress()),
    });
  }

  /**
   * The local certificate as an object, or undefined if not available.
   * @type {object|undefined}
   */
  get certificate() {
    assertIsQuicSession(this);
    if (this.destroyed) return undefined;
    return (this.#inner.certificate ??= wrapCertificate(this.#handle.getCertificate()));
  }

  /**
   * The peer's certificate as an object, or undefined if the peer did
   * not present a certificate or the session is destroyed.
   * @type {object|undefined}
   */
  get peerCertificate() {
    assertIsQuicSession(this);
    if (this.destroyed) return undefined;
    return (this.#inner.peerCertificate ??= wrapCertificate(this.#handle.getPeerCertificate()));
  }

  /**
   * The ephemeral key info for the session. Only available on client
   * sessions. Returns undefined for server sessions or if the session
   * is destroyed.
   * @type {object|undefined}
   */
  get ephemeralKeyInfo() {
    assertIsQuicSession(this);
    if (this.destroyed) return undefined;
    return (this.#inner.ephemeralKeyInfo ??= this.#handle.getEphemeralKey());
  }

  /**
   * @param {number} direction
   * @param {OpenStreamOptions} options
   * @returns {QuicStream}
   */
  async #createStream(direction, options = kEmptyObject) {
    const inner = this.#inner;
    if (this.#isClosedOrClosing) {
      throw new ERR_INVALID_STATE("Session is closed. New streams cannot be opened.");
    }
    const dir = direction === kStreamDirectionBidirectional ? "bidi" : "uni";
    if (inner.state.isStreamOpenAllowed) {
      debug(`opening new pending ${dir} stream`);
    } else {
      debug(`opening new ${dir} stream`);
    }

    validateObject(options, "options");
    const {
      body,
      priority = "default",
      incremental = false,
      highWaterMark = kDefaultHighWaterMark,
      headers,
      onheaders,
      ontrailers,
      oninfo,
      onwanttrailers,
    } = options;

    validateOneOf(priority, "options.priority", ["default", "low", "high"]);
    validateBoolean(incremental, "options.incremental");

    // Blob and FileHandle bodies are pumped through the streaming source
    // after the stream is constructed (configureOutbound); the native
    // openStream only takes one-shot buffer bodies.
    const deferredBody = body !== undefined && (isBlob(body) || FileHandle.isFileHandle(body));
    const validatedBody = deferredBody ? undefined : validateBody(body);

    const handle = this.#handle.openStream(direction, validatedBody);
    if (handle === undefined) {
      throw new ERR_QUIC_OPEN_STREAM_FAILED();
    }

    if (inner.state.headersSupported !== 2) {
      // Applied natively even while the stream is pending — the native
      // side caches the value and applies it when the lsquic stream binds.
      const urgency = priority === "high" ? 0 : priority === "low" ? 7 : 3;
      handle.setPriority((urgency << 1) | (incremental ? 1 : 0));
    }

    const stream = new QuicStream(kPrivateConstructor, handle, this, direction, true /* isLocal */);
    inner.streams.add(stream);
    if (typeof this.#inner.onerror === "function") {
      markPromiseAsHandled(stream.closed);
    }

    // If the body was a FileHandle, store it on the stream so it is
    // closed automatically when the stream finishes.
    if (FileHandle.isFileHandle(body)) {
      stream[kAttachFileHandle](body);
    }

    // Set the high water mark for backpressure.
    stream.highWaterMark = highWaterMark;

    // Set stream callbacks before sending headers to avoid missing events.
    if (onheaders) stream.onheaders = onheaders;
    if (ontrailers) stream.ontrailers = ontrailers;
    if (oninfo) stream.oninfo = oninfo;
    if (onwanttrailers) stream.onwanttrailers = onwanttrailers;

    if (headers !== undefined) {
      stream.sendHeaders(headers, { terminal: validatedBody === undefined && !deferredBody });
    }

    // Start pumping a deferred (Blob/FileHandle) body. Runs after
    // sendHeaders so the HEADERS frame precedes body bytes; the pump's
    // first write lands in a later microtask.
    if (deferredBody) {
      stream.setBody(body);
    }

    if (onSessionOpenStreamChannel.hasSubscribers) {
      onSessionOpenStreamChannel.publish({
        __proto__: null,
        stream,
        session: this,
        direction: dir,
      });
    }
    return stream;
  }

  /**
   * Creates a new bidirectional stream on this session. If the session
   * does not allow new streams to be opened, an error will be thrown.
   * @param {OpenStreamOptions} [options]
   * @returns {Promise<QuicStream>}
   */
  async createBidirectionalStream(options = kEmptyObject) {
    assertIsQuicSession(this);
    return await this.#createStream(kStreamDirectionBidirectional, options);
  }

  /**
   * Creates a new unidirectional stream on this session. If the session
   * does not allow new streams to be opened, an error will be thrown.
   * @param {OpenStreamOptions} [options]
   * @returns {Promise<QuicStream>}
   */
  async createUnidirectionalStream(options = kEmptyObject) {
    assertIsQuicSession(this);
    return await this.#createStream(kStreamDirectionUnidirectional, options);
  }

  /**
   * Send a datagram. The id of the sent datagram will be returned. The status
   * of the sent datagram will be reported via the datagram-status event if
   * possible.
   *
   * If a string is given it will be encoded using the specified encoding.
   *
   * If an ArrayBufferView is given, the bytes are copied into an internal
   * buffer; the caller's source buffer is unchanged and may be reused
   * immediately. Callers that want to ensure their source cannot be
   * mutated after the call (for example, when handing the buffer off to
   * another async consumer) can call ArrayBuffer.prototype.transfer()
   * themselves before passing it.
   *
   * If a Promise is given, it will be awaited before sending. If the
   * session closes while awaiting, 0n is returned silently.
   * @param {ArrayBufferView|string|Promise} datagram The datagram payload
   * @param {string} [encoding] The encoding to use if datagram is a string
   * @returns {Promise<bigint>} The datagram ID
   */
  async sendDatagram(datagram, encoding = "utf8") {
    assertIsQuicSession(this);
    if (this.#isClosedOrClosing) {
      throw new ERR_INVALID_STATE("Session is closed");
    }

    const maxDatagramSize = this.#inner.state.maxDatagramSize;

    // The peer max datagram size is either unknown or they have explicitly
    // indicated that they do not support datagrams by setting it to 0. In
    // either case, we do not send the datagram.
    if (maxDatagramSize === 0) return kNilDatagramId;

    if (isPromise(datagram)) {
      datagram = await datagram;
      // Session may have closed while awaiting. Since datagrams are
      // inherently unreliable, silently return rather than throwing.
      if (this.#isClosedOrClosing) return kNilDatagramId;
    }

    if (typeof datagram === "string") {
      datagram = new Uint8Array(Buffer.from(datagram, encoding));
    } else if (!isArrayBufferView(datagram)) {
      throw new ERR_INVALID_ARG_TYPE("datagram", ["ArrayBufferView", "string"], datagram);
    }

    const length = isDataView(datagram)
      ? DataViewPrototypeGetByteLength(datagram)
      : TypedArrayPrototypeGetByteLength(datagram);

    // If the view has zero length (e.g. detached buffer), there's
    // nothing to send.
    if (length === 0) return kNilDatagramId;

    // The peer max datagram size is less than the datagram we want to send,
    // so... don't send it.
    if (length > maxDatagramSize) return kNilDatagramId;

    const id = this.#handle.sendDatagram(datagram);

    if (id !== kNilDatagramId && onSessionSendDatagramChannel.hasSubscribers) {
      onSessionSendDatagramChannel.publish({
        __proto__: null,
        id,
        length,
        session: this,
      });
    }

    debug(`datagram ${id} sent with ${length} bytes`);
    return id;
  }

  /**
   * Initiate a key update.
   */
  updateKey() {
    assertIsQuicSession(this);
    if (this.#isClosedOrClosing) {
      throw new ERR_INVALID_STATE("Session is closed");
    }

    debug("updating session key");

    this.#handle.updateKey();
    if (onSessionUpdateKeyChannel.hasSubscribers) {
      onSessionUpdateKeyChannel.publish({
        __proto__: null,
        session: this,
      });
    }
  }

  /**
   * Gracefully closes the session. Any streams created on the session will be
   * allowed to complete gracefully and any datagrams that have already been
   * queued for sending will be allowed to complete. Once all streams have been
   * completed and all datagrams have been sent, the session will be closed.
   * New streams will not be allowed to be created. The returned promise will
   * be resolved when the session closes, or will be rejected if the session
   * closes abruptly due to an error.
   * @param {object} [options]
   * @param {bigint|number} [options.code] The error code to send in the
   *   CONNECTION_CLOSE frame. Defaults to NO_ERROR (0).
   * @param {string} [options.type] Either `'transport'` (default) or
   *   `'application'`. Determines the error code namespace.
   * @param {string} [options.reason] An optional human-readable reason
   *   string included in the CONNECTION_CLOSE frame (diagnostic only).
   * @returns {Promise<void>}
   */
  close(options = kEmptyObject) {
    assertIsQuicSession(this);
    options = validateCloseOptions(options);
    const inner = this.#inner;
    if (!this.#isClosedOrClosing) {
      inner.isPendingClose = true;
      if (options?.code !== undefined) {
        inner.selfInitiatedClose = true;
      }

      debug("gracefully closing the session");

      this.#handle.gracefulClose(options);
      if (onSessionClosingChannel.hasSubscribers) {
        onSessionClosingChannel.publish({
          __proto__: null,
          session: this,
        });
      }
    }
    return this.closed;
  }

  /** @type {boolean} */
  get closing() {
    return this.#inner.isPendingClose;
  }

  /** @type {Promise<QuicSessionInfo>} */
  get opened() {
    assertIsQuicSession(this);
    return this.#inner.pendingOpen.promise;
  }

  /**
   * A promise that is resolved when the session is closed, or is rejected if
   * the session is closed abruptly due to an error.
   * @type {Promise<void>}
   */
  get closed() {
    assertIsQuicSession(this);
    return this.#inner.pendingClose.promise;
  }

  /** @type {boolean} */
  get destroyed() {
    assertIsQuicSession(this);
    return this.#handle === undefined;
  }

  /**
   * Forcefully closes the session abruptly without waiting for streams to be
   * completed naturally. Any streams that are still open will be immediately
   * destroyed and any queued datagrams will be dropped. If an error is given,
   * the closed promise will be rejected with that error. If no error is given,
   * the closed promise will be resolved.
   * @param {any} error
   * @param {object} [options]
   * @param {bigint|number} [options.code] The error code to send in the
   *   CONNECTION_CLOSE frame. Defaults to NO_ERROR (0).
   * @param {string} [options.type] Either `'transport'` (default) or
   *   `'application'`. Determines the error code namespace.
   * @param {string} [options.reason] An optional human-readable reason
   *   string included in the CONNECTION_CLOSE frame (diagnostic only).
   */
  destroy(error, options) {
    assertIsQuicSession(this);
    const inner = this.#inner;
    // Two distinct guards (see also `QuicStream.destroy`):
    //   * `#destroying` flips synchronously here so any re-entrant call
    //     (e.g. from a user `onerror` callback or from a cascading
    //     `stream.destroy(error)` whose own `onerror` re-enters
    //     `session.destroy()`) hits this guard and returns immediately
    //     without running the teardown twice.
    //   * `destroyed` (i.e. `#handle === undefined`) signals
    //     "fully torn down". Defense-in-depth for paths that may have
    //     finished teardown without setting `#destroying` and for
    //     repeat invocations after this method has fully run.
    if (inner.destroying || this.destroyed) return;

    if (options !== undefined) options = validateCloseOptions(options);
    inner.destroying = true;

    debug("destroying the session");

    if (error !== undefined) {
      if (onSessionErrorChannel.hasSubscribers) {
        onSessionErrorChannel.publish({
          __proto__: null,
          session: this,
          error,
        });
      }
      const { onerror } = inner;
      if (typeof onerror === "function") {
        invokeOnerror(onerror, error);
      }
    }

    // First, forcefully and immediately destroy all open streams, if any.
    for (const stream of inner.streams) {
      stream.destroy(error);
    }
    // The streams should remove themselves when they are destroyed but let's
    // be doubly sure.
    const streamCount = inner.streams.size;
    if (streamCount) {
      process.emitWarning(
        `The session is destroyed with ${streamCount} active streams. ` +
          "This should not happen and indicates a bug in Node.js. Please open an " +
          "issue in the Node.js GitHub repository at https://github.com/nodejs/node " +
          "to report the problem.",
      );
    }
    inner.streams.clear();

    // Remove this session immediately from the endpoint
    inner.endpoint[kRemoveSession](this);
    inner.endpoint = undefined;
    inner.isPendingClose = false;

    // If the handshake never completed, reject the opened promise. The
    // session is being destroyed, so the handshake will never complete
    // and `await session.opened` would otherwise hang forever. The
    // documented contract is that opened rejects when the session is
    // destroyed before opening; see the `session.opened` docs in
    // doc/api/quic.md. `[kHandshake]` clears `#pendingOpen.reject` once
    // the handshake completes successfully, so this branch only runs if
    // we are racing against a still-pending handshake.
    //
    // Mark the rejection as handled before rejecting so that callers who
    // never explicitly `await session.opened` do not get an unhandled
    // rejection warning - common for server-side sessions delivered via
    // `onsession`, which often do not await opened. The rejection is
    // still observable via `await session.opened`.
    if (inner.pendingOpen.reject) {
      markPromiseAsHandled(inner.pendingOpen.promise);
      inner.pendingOpen.reject(error ?? new ERR_INVALID_STATE("Session was destroyed before it opened"));
    }

    if (error) {
      // If the session is still waiting to be closed, and error
      // is specified, reject the closed promise.
      inner.pendingClose.reject?.(error);
    } else {
      inner.pendingClose.resolve?.();
    }

    inner.pendingClose.reject = undefined;
    inner.pendingClose.resolve = undefined;
    inner.pendingOpen.reject = undefined;
    inner.pendingOpen.resolve = undefined;

    inner.state[kFinishClose]();
    inner.stats[kFinishClose]();

    if (this[kPerfEntry] && hasObserver("quic")) {
      stopPerf(this, kPerfEntry, {
        detail: {
          stats: inner.stats,
          handshake: inner.handshakeInfo,
          path: inner.path,
        },
      });
    }

    inner.onerror = undefined;
    inner.onstream = undefined;
    inner.ondatagram = undefined;
    inner.ondatagramstatus = undefined;
    inner.onpathvalidation = undefined;
    inner.onsessionticket = undefined;
    inner.onkeylog = undefined;
    inner.onversionnegotiation = undefined;
    inner.onhandshake = undefined;
    inner.onnewtoken = undefined;
    inner.onorigin = undefined;
    inner.ongoaway = undefined;
    inner.path = undefined;
    inner.certificate = undefined;
    inner.peerCertificate = undefined;
    inner.ephemeralKeyInfo = undefined;

    // Destroy the underlying C++ handle. Pass close error options if
    // provided so the CONNECTION_CLOSE frame carries the correct code.
    // Note: #onqlog is intentionally NOT cleared here because the native side
    // emits the final qlog statement during conn destruction,
    // and the deferred callback must still be reachable. The reference
    // is released when the QuicSession object is garbage collected.
    this.#handle.destroy(options);
    this.#handle = undefined;

    if (onSessionClosedChannel.hasSubscribers) {
      onSessionClosedChannel.publish({
        __proto__: null,
        session: this,
        error,
        stats: inner.stats,
      });
    }
  }

  /**
   * Called when the peer sends a GOAWAY frame (HTTP/3 only). The
   * lastStreamId indicates the highest stream ID the peer may have
   * processed - streams above it were not processed and may be retried.
   * @param {bigint} lastStreamId
   */
  [kGoaway](lastStreamId) {
    const inner = this.#inner;
    inner.isPendingClose = true;
    if (onSessionClosingChannel.hasSubscribers) {
      onSessionClosingChannel.publish({ __proto__: null, session: this });
    }
    if (onSessionGoawayChannel.hasSubscribers) {
      onSessionGoawayChannel.publish({
        __proto__: null,
        session: this,
        lastStreamId,
      });
    }
    const { ongoaway } = inner;
    if (typeof ongoaway === "function") {
      safeCallbackInvoke(ongoaway, this, lastStreamId);
    }
  }

  /**
   * @param {number} errorType
   * @param {number} code
   * @param {string} [reason]
   */
  [kFinishClose](errorType, code, reason, errorName) {
    // If code is zero, then we closed without an error. Yay! We can destroy
    // safely without specifying an error.
    if (code === 0n) {
      debug("finishing closing the session with no error");
      this.destroy();
      return;
    }

    debug("finishing closing the session with an error", errorType, code, reason, errorName);

    // If the local side initiated this close with an error code (via
    // close({ code })), this is an intentional shutdown; not an error.
    // The closed promise should resolve, not reject.
    if (this.#inner.selfInitiatedClose) {
      this.destroy();
      return;
    }

    // Otherwise, errorType indicates the type of error that occurred, code indicates
    // the specific error, and reason is an optional string describing the error.
    // code !== 0n here (the early return above handles code === 0n).
    // The errorType values map to QUIC error types:
    //   0 = NGTCP2_CCERR_TYPE_TRANSPORT
    //   1 = NGTCP2_CCERR_TYPE_APPLICATION
    //   2 = NGTCP2_CCERR_TYPE_VERSION_NEGOTIATION
    //   3 = NGTCP2_CCERR_TYPE_IDLE_CLOSE
    //   4 = NGTCP2_CCERR_TYPE_DROP_CONN
    //   5 = NGTCP2_CCERR_TYPE_RETRY
    // The DROP_CONN/RETRY cases are typically intercepted before reaching
    // here (DROP_CONN tears the connection down without notifying us, RETRY
    // is server-only). The default branch is a safety net so any
    // unexpected value still completes the close path - without it the
    // session would leak with `closed` hanging forever.
    switch (errorType) {
      case 0 /* Transport Error */:
        this.destroy(
          makeQuicError("ERR_QUIC_TRANSPORT_ERROR", "QUIC transport error", "transport", code, reason, errorName),
        );
        break;
      case 1 /* Application Error */:
        this.destroy(
          makeQuicError("ERR_QUIC_APPLICATION_ERROR", "QUIC application error", "application", code, reason, errorName),
        );
        break;
      case 2 /* Version Negotiation Error */:
        this.destroy(new ERR_QUIC_VERSION_NEGOTIATION_ERROR());
        break;
      case 3 /* Idle close */:
        this.destroy();
        break;
      default:
        this.destroy(
          makeQuicError("ERR_QUIC_TRANSPORT_ERROR", "QUIC transport error", "transport", code, reason, errorName),
        );
        break;
    }
  }

  [kKeylog](line) {
    const inner = this.#inner;
    if (this.destroyed || inner.onkeylog === undefined) return;
    safeCallbackInvoke(inner.onkeylog, this, line);
  }

  [kQlog](data, fin) {
    const inner = this.#inner;
    if (inner.onqlog === undefined) return;
    safeCallbackInvoke(inner.onqlog, this, data, fin);
  }

  /**
   * @param {Uint8Array} u8 The datagram payload
   * @param {boolean} early A boolean indicating whether this datagram was received before the handshake completed
   */
  [kDatagram](u8, early) {
    // The datagram event should only be called if the session has
    // an ondatagram callback. The callback should always exist here.
    const inner = this.#inner;
    assert(typeof inner.ondatagram === "function", "Unexpected datagram event");
    if (this.destroyed) return;
    const length = TypedArrayPrototypeGetByteLength(u8);
    if (onSessionReceiveDatagramChannel.hasSubscribers) {
      onSessionReceiveDatagramChannel.publish({
        __proto__: null,
        length,
        early,
        session: this,
      });
    }
    safeCallbackInvoke(inner.ondatagram, this, u8, early);
  }

  /**
   * @param {bigint} id
   * @param {'lost'|'acknowledged'} status
   */
  [kDatagramStatus](id, status) {
    const inner = this.#inner;
    // The datagram status event should only be called if the session has
    // an ondatagramstatus callback. The callback should always exist here.
    assert(typeof inner.ondatagramstatus === "function", "Unexpected datagram status event");
    if (this.destroyed) return;
    if (onSessionReceiveDatagramStatusChannel.hasSubscribers) {
      onSessionReceiveDatagramStatusChannel.publish({
        __proto__: null,
        id,
        status,
        session: this,
      });
    }
    safeCallbackInvoke(inner.ondatagramstatus, this, id, status);
  }

  /**
   * @param {'aborted'|'failure'|'success'} result
   * @param {SocketAddress} newLocalAddress
   * @param {SocketAddress} newRemoteAddress
   * @param {SocketAddress} oldLocalAddress
   * @param {SocketAddress} oldRemoteAddress
   * @param {boolean} preferredAddress
   */
  [kPathValidation](result, newLocalAddress, newRemoteAddress, oldLocalAddress, oldRemoteAddress, preferredAddress) {
    const inner = this.#inner;
    assert(typeof inner.onpathvalidation === "function", "Unexpected path validation event");
    if (this.destroyed) return;
    const newLocal = new InternalSocketAddress(newLocalAddress);
    const newRemote = new InternalSocketAddress(newRemoteAddress);
    const oldLocal = oldLocalAddress !== undefined ? new InternalSocketAddress(oldLocalAddress) : null;
    const oldRemote = oldRemoteAddress !== undefined ? new InternalSocketAddress(oldRemoteAddress) : null;
    if (onSessionPathValidationChannel.hasSubscribers) {
      onSessionPathValidationChannel.publish({
        __proto__: null,
        result,
        newLocalAddress: newLocal,
        newRemoteAddress: newRemote,
        oldLocalAddress: oldLocal,
        oldRemoteAddress: oldRemote,
        preferredAddress,
        session: this,
      });
    }
    safeCallbackInvoke(
      inner.onpathvalidation,
      this,
      result,
      newLocal,
      newRemote,
      oldLocal,
      oldRemote,
      preferredAddress,
    );
  }

  /**
   * @param {object} ticket
   */
  [kSessionTicket](ticket) {
    const inner = this.#inner;
    assert(typeof inner.onsessionticket === "function", "Unexpected session ticket event");
    if (this.destroyed) return;
    if (onSessionTicketChannel.hasSubscribers) {
      onSessionTicketChannel.publish({
        __proto__: null,
        ticket,
        session: this,
      });
    }
    safeCallbackInvoke(inner.onsessionticket, this, ticket);
  }

  /**
   * @param {Buffer} token
   * @param {SocketAddress} address
   */
  [kNewToken](token, address) {
    const inner = this.#inner;
    assert(typeof inner.onnewtoken === "function", "Unexpected new token event");
    if (this.destroyed) return;
    const addr = new InternalSocketAddress(address);
    if (onSessionNewTokenChannel.hasSubscribers) {
      onSessionNewTokenChannel.publish({
        __proto__: null,
        token,
        address: addr,
        session: this,
      });
    }
    safeCallbackInvoke(inner.onnewtoken, this, token, addr);
  }

  [kEarlyDataRejected]() {
    if (this.destroyed) return;
    if (onSessionEarlyRejectedChannel.hasSubscribers) {
      onSessionEarlyRejectedChannel.publish({
        __proto__: null,
        session: this,
      });
    }
    const inner = this.#inner;
    const { onearlyrejected } = inner;
    if (typeof onearlyrejected === "function") {
      safeCallbackInvoke(onearlyrejected, this);
    }
  }

  /**
   * @param {number} version
   * @param {number[]} requestedVersions
   * @param {number[]} supportedVersions
   */
  [kVersionNegotiation](version, requestedVersions, supportedVersions) {
    if (this.destroyed) return;
    if (onSessionVersionNegotiationChannel.hasSubscribers) {
      onSessionVersionNegotiationChannel.publish({
        __proto__: null,
        version,
        requestedVersions,
        supportedVersions,
        session: this,
      });
    }
    const inner = this.#inner;
    const { onversionnegotiation } = inner;
    if (typeof onversionnegotiation === "function") {
      safeCallbackInvoke(onversionnegotiation, this, version, requestedVersions, supportedVersions);
    }
    // Version negotiation is always a fatal event - the session must be
    // destroyed regardless of whether the callback is set.
    this.destroy(new ERR_QUIC_VERSION_NEGOTIATION_ERROR());
  }

  /**
   * Called when the session receives an ORIGIN frame (RFC 9412).
   * @param {string[]} origins
   */
  [kOrigin](origins) {
    if (this.destroyed) return;
    const inner = this.#inner;
    assert(typeof inner.onorigin === "function", "Unexpected origin event");
    if (onSessionOriginChannel.hasSubscribers) {
      onSessionOriginChannel.publish({
        __proto__: null,
        origins,
        session: this,
      });
    }
    safeCallbackInvoke(inner.onorigin, this, origins);
  }

  /**
   * @param {string} servername
   * @param {string} protocol
   * @param {string} cipher
   * @param {string} cipherVersion
   * @param {string} validationErrorReason
   * @param {number} validationErrorCode
   */
  [kHandshake](
    servername,
    protocol,
    cipher,
    cipherVersion,
    validationErrorReason,
    validationErrorCode,
    earlyDataAttempted,
    earlyDataAccepted,
  ) {
    const inner = this.#inner;
    if (this.destroyed || !inner.pendingOpen.resolve) return;

    const addr = this.#handle.getRemoteAddress();

    const info = {
      __proto__: null,
      local: inner.endpoint.address,
      remote: addr !== undefined ? new InternalSocketAddress(addr) : undefined,
      servername,
      protocol,
      cipher,
      cipherVersion,
      validationErrorReason,
      validationErrorCode,
      earlyDataAttempted,
      earlyDataAccepted,
    };

    // Stash timing-relevant handshake info for the perf entry detail.
    inner.handshakeInfo = {
      __proto__: null,
      servername,
      protocol,
      earlyDataAttempted,
      earlyDataAccepted,
    };

    if (onSessionHandshakeChannel.hasSubscribers) {
      onSessionHandshakeChannel.publish({
        __proto__: null,
        session: this,
        ...info,
      });
    }

    const { onhandshake } = inner;
    if (typeof onhandshake === "function") {
      safeCallbackInvoke(onhandshake, this, info);
    }

    // In 'auto' mode, reject the connection if peer certificate validation
    // failed. In 'manual' mode, resolve regardless and let the application
    // decide. In 'strict' mode, the handshake already failed at the C++
    // level (SSL_VERIFY_PEER) so we won't reach here.
    if (inner.verifyPeer === "auto" && validationErrorReason !== undefined) {
      const err = makeQuicError(
        "ERR_QUIC_TRANSPORT_ERROR",
        "QUIC transport error",
        "transport",
        0n,
        `Peer certificate validation failed: ${validationErrorReason}` + ` [${validationErrorCode}]`,
      );
      inner.pendingOpen.reject?.(err);
      inner.pendingOpen.resolve = undefined;
      inner.pendingOpen.reject = undefined;
      inner.handshakeCompleted = true;
      this.destroy();
      return;
    }

    inner.pendingOpen.resolve?.(info);
    inner.pendingOpen.resolve = undefined;
    inner.pendingOpen.reject = undefined;
    inner.handshakeCompleted = true;
  }

  /** @type {boolean} */
  get [kHandshakeCompleted]() {
    return this.#inner.handshakeCompleted;
  }

  get [kVerifyPeer]() {
    return this.#inner.verifyPeer;
  }

  set [kVerifyPeer](value) {
    this.#inner.verifyPeer = value;
  }

  /**
   * @param {object} handle
   * @param {number} direction
   */
  [kNewStream](handle, direction) {
    const inner = this.#inner;
    const stream = new QuicStream(kPrivateConstructor, handle, this, direction, false /* isLocal */);

    // Set the default high water mark for received streams.
    stream.highWaterMark = kDefaultHighWaterMark;

    // A new stream was received. If we don't have an onstream callback, then
    // there's nothing we can do about it. Destroy the stream in this case.
    if (typeof inner.onstream !== "function") {
      process.emitWarning("A new stream was received but no onstream callback was provided");
      stream.destroy();
      return;
    }

    inner.streams.add(stream);
    // If the session has an onerror handler, mark the stream's closed
    // promise as handled. See the onerror setter for explanation.
    if (typeof inner.onerror === "function") {
      markPromiseAsHandled(stream.closed);
    }

    // streamIdleTimeout (listen option): destroy peer-initiated streams
    // that sit idle. One-shot from creation — the option is opt-in and an
    // idle stream by definition sees no activity that would restart the
    // window; the timer is cancelled when the stream closes normally.
    const idleTimeout = this[kStreamIdleTimeout];
    if (idleTimeout > 0) {
      const timer = setTimeout(() => {
        if (!stream.destroyed) {
          stream.destroy(
            makeQuicError("ERR_QUIC_TRANSPORT_ERROR", "QUIC transport error", "transport", 0n, "stream idle timeout"),
          );
        }
      }, idleTimeout);
      if (typeof timer?.unref === "function") timer.unref();
      const clear = () => clearTimeout(timer);
      PromisePrototypeThen(stream.closed, clear, clear);
    }

    // Apply default stream callbacks set at listen time before
    // notifying onstream, so the user sees them already set.
    const scbs = this[kStreamCallbacks];
    if (scbs) {
      const { onheaders, ontrailers, oninfo, onwanttrailers } = scbs;
      if (onheaders) stream.onheaders = onheaders;
      if (ontrailers) stream.ontrailers = ontrailers;
      if (oninfo) stream.oninfo = oninfo;
      if (onwanttrailers) stream.onwanttrailers = onwanttrailers;
    }

    if (onSessionReceivedStreamChannel.hasSubscribers) {
      onSessionReceivedStreamChannel.publish({
        __proto__: null,
        stream,
        session: this,
        direction: direction === kStreamDirectionBidirectional ? "bidi" : "uni",
      });
    }

    safeCallbackInvoke(inner.onstream, this, stream);
  }

  [kRemoveStream](stream) {
    this.#inner.streams.delete(stream);
  }

  [kInspect](depth, options) {
    if (depth < 0) {
      return "QuicSession { }";
    }

    const opts = {
      __proto__: null,
      ...options,
      depth: options.depth == null ? null : options.depth - 1,
    };

    const { isPendingClose: closing, endpoint, path, state, stats, streams } = this.#inner;

    return `QuicSession ${inspect(
      {
        closed: this.closed,
        closing,
        destroyed: this.destroyed,
        endpoint,
        path,
        state,
        stats,
        streams,
      },
      opts,
    )}`;
  }

  async [SymbolAsyncDispose]() {
    await this.close();
  }
}

// The QuicEndpoint represents a local UDP port binding. It can act as both a
// server for receiving peer sessions, or a client for initiating them. The
// local UDP port will be lazily bound only when connect() or listen() are
// called.
class QuicEndpoint {
  #handle;
  #inner = {
    __proto__: null,
    address: undefined,
    busy: false,
    isPendingClose: false,
    listening: false,
    // `true` (HTTP/3) or `false` (raw) once a client connect fixed this
    // endpoint's lsquic client-engine mode; `undefined` until then.
    clientHttp: undefined,
    pendingClose: PromiseWithResolvers(),
    pendingError: undefined,
    sessions: new SafeSet(),
    stat: undefined,
    stats: undefined,
    onsession: undefined,
    sessionCallbacks: undefined,
  };

  static {
    isQuicEndpoint = function (val) {
      return val != null && typeof val === "object" && #handle in val;
    };

    assertIsQuicEndpoint = function (val) {
      if (!isQuicEndpoint(val)) {
        throw new ERR_INVALID_THIS("QuicEndpoint");
      }
    };

    getQuicEndpointState = function (endpoint) {
      assertIsQuicEndpoint(endpoint);
      return endpoint.#inner.state;
    };

    releaseEndpointSocket = function (endpoint) {
      endpoint.#handle?.releaseSocket();
    };

    assertEndpointNotClosedOrClosing = function (endpoint) {
      if (endpoint.#isClosedOrClosing) {
        throw new ERR_INVALID_STATE("Endpoint is closed");
      }
    };

    assertEndpointIsNotBusy = function (endpoint) {
      if (endpoint.#inner.state.isBusy) {
        throw new ERR_INVALID_STATE("Endpoint is busy");
      }
    };
  }

  /**
   * @param {EndpointOptions} options
   * @returns {EndpointOptions}
   */
  #processEndpointOptions(options) {
    validateObject(options, "options");
    let { address } = options;
    const {
      retryTokenExpiration,
      tokenExpiration,
      maxConnectionsPerHost = 100,
      maxConnectionsTotal = 10_000,
      disableStatelessReset,
      addressLRUSize,
      retryRate,
      retryBurst,
      statelessResetRate,
      statelessResetBurst,
      versionNegotiationRate,
      versionNegotiationBurst,
      immediateCloseRate,
      immediateCloseBurst,
      sessionCreationRate,
      sessionCreationBurst,
      blockList,
      blockListPolicy = "deny",
      rxDiagnosticLoss,
      txDiagnosticLoss,
      udpReceiveBufferSize,
      udpSendBufferSize,
      udpTTL,
      idleTimeout,
      validateAddress,
      ipv6Only,
      reusePort,
      cc,
      resetTokenSecret,
      tokenSecret,
    } = options;

    if (blockList !== undefined) {
      if (!BlockList.isBlockList(blockList)) {
        throw new ERR_INVALID_ARG_TYPE("options.blockList", "net.BlockList", blockList);
      }
    }

    validateOneOf(blockListPolicy, "options.blockListPolicy", ["deny", "allow"]);

    // Non-negative integer (number or bigint) options.
    for (const [name, v] of [
      ["retryTokenExpiration", retryTokenExpiration],
      ["tokenExpiration", tokenExpiration],
      ["addressLRUSize", addressLRUSize],
    ]) {
      if (v === undefined) continue;
      if (typeof v === "bigint") {
        if (v < 0n) throw new ERR_OUT_OF_RANGE(`options.${name}`, ">= 0", v);
      } else {
        validateInteger(v, `options.${name}`, 0);
      }
    }

    // Non-negative rate/burst options (fractions and Infinity allowed).
    for (const [name, v] of [
      ["retryRate", retryRate],
      ["retryBurst", retryBurst],
      ["statelessResetRate", statelessResetRate],
      ["statelessResetBurst", statelessResetBurst],
      ["versionNegotiationRate", versionNegotiationRate],
      ["versionNegotiationBurst", versionNegotiationBurst],
      ["immediateCloseRate", immediateCloseRate],
      ["immediateCloseBurst", immediateCloseBurst],
      ["sessionCreationRate", sessionCreationRate],
      ["sessionCreationBurst", sessionCreationBurst],
      ["rxDiagnosticLoss", rxDiagnosticLoss],
      ["txDiagnosticLoss", txDiagnosticLoss],
    ]) {
      if (v === undefined) continue;
      if (typeof v !== "number") {
        throw new ERR_INVALID_ARG_TYPE(`options.${name}`, "number", v);
      }
      if (v < 0 || NumberIsNaN(v)) {
        throw new ERR_OUT_OF_RANGE(`options.${name}`, ">= 0", v);
      }
    }

    if (udpReceiveBufferSize !== undefined) {
      validateInteger(udpReceiveBufferSize, "options.udpReceiveBufferSize", 0);
    }
    if (udpSendBufferSize !== undefined) {
      validateInteger(udpSendBufferSize, "options.udpSendBufferSize", 0);
    }
    if (udpTTL !== undefined) {
      validateInteger(udpTTL, "options.udpTTL", 0, 255);
    }

    // 16-byte secrets (any ArrayBufferView shape).
    for (const [name, v] of [
      ["resetTokenSecret", resetTokenSecret],
      ["tokenSecret", tokenSecret],
    ]) {
      if (v === undefined) continue;
      if (!isArrayBufferView(v)) {
        throw new ERR_INVALID_ARG_TYPE(`options.${name}`, ["ArrayBufferView"], v);
      }
      if (v.byteLength !== 16) {
        throw new ERR_INVALID_ARG_VALUE(`options.${name}`, v, "must be exactly 16 bytes");
      }
    }

    // All of the other options will be validated internally by the C++ code
    if (address !== undefined && !SocketAddress.isSocketAddress(address)) {
      if (typeof address === "string") {
        address = SocketAddress.parse(address);
      } else if (typeof address === "object" && address !== null) {
        address = new SocketAddress(address);
      } else {
        throw new ERR_INVALID_ARG_TYPE("options.address", ["SocketAddress", "string"], address);
      }
    }

    return {
      __proto__: null,
      address: address?.[kSocketAddressHandle],
      retryTokenExpiration,
      tokenExpiration,
      // Connection limits are set on the state buffer, not passed to C++.
      maxConnectionsPerHost,
      maxConnectionsTotal,
      disableStatelessReset,
      addressLRUSize,
      retryRate,
      retryBurst,
      statelessResetRate,
      statelessResetBurst,
      versionNegotiationRate,
      versionNegotiationBurst,
      immediateCloseRate,
      immediateCloseBurst,
      sessionCreationRate,
      sessionCreationBurst,
      // Pass the C++ handle, not the JS BlockList wrapper.
      blockList: blockList?.[kBlockListHandle],
      blockListPolicy,
      rxDiagnosticLoss,
      txDiagnosticLoss,
      udpReceiveBufferSize,
      udpSendBufferSize,
      udpTTL,
      idleTimeout,
      validateAddress,
      ipv6Only,
      reusePort,
      cc,
      resetTokenSecret,
      tokenSecret,
    };
  }

  #newSession(handle) {
    const session = new QuicSession(kPrivateConstructor, handle, this);
    this.#inner.sessions.add(session);
    // Set default pending datagram queue size.
    session.maxPendingDatagrams = kDefaultMaxPendingDatagrams;
    return session;
  }

  /**
   * @param {EndpointOptions} config
   */
  constructor(config = kEmptyObject) {
    const options = this.#processEndpointOptions(config);
    this.#handle = new Endpoint_(options);
    this.#handle[kOwner] = this;
    const inner = this.#inner;
    inner.stats = new QuicEndpointStats(kPrivateConstructor, this.#handle.stats);
    inner.state = new QuicEndpointState(kPrivateConstructor, this.#handle.state);

    // Connection limits are stored in the shared state buffer so they
    // can be read by C++ and mutated from JS after construction.
    // Use the public setters which validate the range.
    const { maxConnectionsPerHost, maxConnectionsTotal } = options;
    if (maxConnectionsPerHost !== undefined) {
      this.maxConnectionsPerHost = maxConnectionsPerHost;
    }
    if (maxConnectionsTotal !== undefined) {
      this.maxConnectionsTotal = maxConnectionsTotal;
    }
    // Seconds a client endpoint stays alive after its last session closes
    // before self-destroying (0 = immediately). Listening endpoints never
    // idle out.
    inner.idleTimeout =
      typeof options.idleTimeout === "bigint" ? Number(options.idleTimeout) : (options.idleTimeout ?? 0);

    endpointRegistry.add(this);

    if (hasObserver("quic")) {
      startPerf(this, kPerfEntry, { type: "quic", name: "QuicEndpoint" });
    }

    if (onEndpointCreatedChannel.hasSubscribers) {
      onEndpointCreatedChannel.publish({
        __proto__: null,
        endpoint: this,
        config,
      });
    }

    debug("endpoint created");
  }

  /**
   * Statistics collected while the endpoint is operational.
   * @type {QuicEndpointStats}
   */
  get stats() {
    assertIsQuicEndpoint(this);
    return this.#inner.stats;
  }

  get #isClosedOrClosing() {
    return this.destroyed || this.#inner.isPendingClose;
  }

  /**
   * When an endpoint is marked as busy, it will not accept new connections.
   * Existing connections will continue to work.
   * @type {boolean}
   */
  get busy() {
    assertIsQuicEndpoint(this);
    return this.#inner.busy;
  }

  /**
   * @type {boolean}
   */
  set busy(val) {
    assertIsQuicEndpoint(this);
    assertEndpointNotClosedOrClosing(this);
    // The val is allowed to be any truthy value
    // Non-op if there is no change
    const inner = this.#inner;
    if (!!val !== inner.busy) {
      debug("toggling endpoint busy status to ", !inner.busy);
      inner.busy = !inner.busy;
      this.#handle.markBusy(inner.busy);
      if (onEndpointBusyChangeChannel.hasSubscribers) {
        onEndpointBusyChangeChannel.publish({
          __proto__: null,
          endpoint: this,
          busy: inner.busy,
        });
      }
    }
  }

  /**
   * Maximum concurrent connections per remote IP address.
   * 0 means unlimited (default).
   * @type {number}
   */
  get maxConnectionsPerHost() {
    assertIsQuicEndpoint(this);
    return this.#inner.state.maxConnectionsPerHost;
  }

  set maxConnectionsPerHost(val) {
    assertIsQuicEndpoint(this);
    validateInteger(val, "maxConnectionsPerHost", 0, 0xffff);
    this.#inner.state.maxConnectionsPerHost = val;
  }

  /**
   * Maximum total concurrent connections.
   * 0 means unlimited (default).
   * @type {number}
   */
  get maxConnectionsTotal() {
    assertIsQuicEndpoint(this);
    return this.#inner.state.maxConnectionsTotal;
  }

  set maxConnectionsTotal(val) {
    assertIsQuicEndpoint(this);
    validateInteger(val, "maxConnectionsTotal", 0, 0xffff);
    this.#inner.state.maxConnectionsTotal = val;
  }

  /**
   * The local address the endpoint is bound to (if any)
   * @type {SocketAddress|undefined}
   */
  get address() {
    assertIsQuicEndpoint(this);
    if (this.#isClosedOrClosing) return undefined;
    if (this.#inner.address === undefined) {
      const addr = this.#handle.address();
      if (addr !== undefined) this.#inner.address = new InternalSocketAddress(addr);
    }
    return this.#inner.address;
  }

  /**
   * Configures the endpoint to listen for incoming connections.
   * @param {OnSessionCallback|SessionOptions} [onsession]
   * @param {SessionOptions} [options]
   */
  [kListen](onsession, options) {
    assertEndpointNotClosedOrClosing(this);
    assertEndpointIsNotBusy(this);
    const inner = this.#inner;
    if (inner.listening) {
      throw new ERR_INVALID_STATE("Endpoint is already listening");
    }
    validateObject(options, "options");
    validateFunction(onsession, "onsession");
    this.#inner.onsession = FunctionPrototypeBind(onsession, this);

    const {
      onerror,
      onstream,
      ondatagram,
      ondatagramstatus,
      onpathvalidation,
      onsessionticket,
      onversionnegotiation,
      onhandshake,
      onnewtoken,
      onearlyrejected,
      onorigin,
      ongoaway,
      onkeylog,
      onqlog,
      // Stream-level callbacks applied to each incoming stream.
      onheaders,
      ontrailers,
      oninfo,
      onwanttrailers,
      ...rest
    } = options;

    // Store session and stream callbacks to apply to each new incoming session.
    inner.sessionCallbacks = {
      __proto__: null,
      onerror,
      onstream,
      ondatagram,
      ondatagramstatus,
      onpathvalidation,
      onsessionticket,
      onversionnegotiation,
      onhandshake,
      onnewtoken,
      onearlyrejected,
      onorigin,
      ongoaway,
      onkeylog,
      onqlog,
      onheaders,
      ontrailers,
      oninfo,
      onwanttrailers,
      // Milliseconds before an idle peer-initiated stream is destroyed
      // (0/undefined disables). Stamped on each session by
      // applySessionCallbacks, applied per-stream in [kNewStream].
      streamIdleTimeout:
        typeof rest.streamIdleTimeout === "bigint" ? Number(rest.streamIdleTimeout) : rest.streamIdleTimeout || 0,
    };

    this.#handle.listen(rest);
    inner.listening = true;
    debug("endpoint listening as a server");
  }

  /**
   * Initiates a session with a remote endpoint.
   * @param {object} address
   * @param {SessionOptions} [options]
   * @returns {QuicSession}
   */
  [kConnect](address, options) {
    assertEndpointNotClosedOrClosing(this);
    assertEndpointIsNotBusy(this);
    validateObject(options, "options");
    const { sessionTicket, ...rest } = options;

    debug("endpoint connecting as a client");
    const handle = this.#handle.connect(address, rest, sessionTicket);
    if (handle === undefined) {
      throw new ERR_QUIC_CONNECTION_FAILED();
    }
    const session = this.#newSession(handle);
    // Set callbacks before any async work to avoid missing events
    // that fire during or immediately after the handshake.
    applyCallbacks(session, options);
    // Store the verifyPeer policy for use in the handshake handler.
    const { verifyPeer } = options;
    if (verifyPeer !== undefined) {
      session[kVerifyPeer] = verifyPeer;
    }
    return session;
  }

  /**
   * Gracefully closes the endpoint. Any existing sessions will be permitted to
   * end gracefully, after which the endpoint will be closed immediately. New
   * sessions will not be accepted or created. The returned promise will be resolved
   * when closing is complete, or will be rejected if the endpoint is closed abruptly
   * due to an error.
   * @returns {Promise<void>} Returns this.closed
   */
  close() {
    assertIsQuicEndpoint(this);
    if (!this.#isClosedOrClosing) {
      debug("gracefully closing the endpoint");
      const inner = this.#inner;
      inner.isPendingClose = true;
      this.#handle.closeGracefully();
      if (onEndpointClosingChannel.hasSubscribers && !inner.suppressCloseChannels) {
        onEndpointClosingChannel.publish({
          __proto__: null,
          endpoint: this,
          hasPendingError: inner.pendingError !== undefined,
        });
      }
    }
    return this.closed;
  }

  /**
   * Returns a promise that is resolved when the endpoint is closed or rejects
   * if the endpoint is closed abruptly due to an error. The closed property
   * is set to the same promise that is returned by the close() method.
   * @type {Promise<void>}
   */
  get closed() {
    assertIsQuicEndpoint(this);
    return this.#inner.pendingClose.promise;
  }

  /**
   * True if the endpoint is pending close.
   * @type {boolean}
   */
  get closing() {
    assertIsQuicEndpoint(this);
    return this.#inner.isPendingClose;
  }

  /** @type {boolean} */
  get listening() {
    assertIsQuicEndpoint(this);
    return this.#inner.listening;
  }

  /** See `kClientHttp`'s declaration. `undefined` until a client connect. */
  get [kClientHttp]() {
    return this.#inner.clientHttp;
  }

  /** Record the client-engine mode this endpoint's first connect() picked. */
  [kNoteClientHttp](wantHttp) {
    this.#inner.clientHttp ??= wantHttp;
  }

  /** @type {boolean} */
  get destroyed() {
    assertIsQuicEndpoint(this);
    return this.#handle === undefined;
  }

  /**
   * Forcefully terminates the endpoint by immediately destroying all sessions
   * after calling close. If an error is given, the closed promise will be
   * rejected with that error. If no error is given, the closed promise will
   * be resolved.
   * @param {any} [error]
   * @returns {Promise<void>} Returns this.closed
   */
  destroy(error) {
    assertIsQuicEndpoint(this);
    debug("destroying the endpoint");
    const inner = this.#inner;
    // Record the error before deciding whether to initiate a close. If
    // `close()` was already called (e.g. the user kicked off a graceful
    // shutdown and then a fatal error was reported afterwards via
    // `destroy(err)`) we still want that error to surface on
    // `endpoint.closed` rather than being silently swallowed when the
    // last in-flight session finishes draining. Only the *first* error
    // is recorded, matching how other Node subsystems handle a
    // double-error race.
    if (error !== undefined) inner.pendingError ??= error;
    // Force all sessions to be abruptly closed *before* signalling the
    // endpoint to close gracefully. The order matters: each session's
    // `destroy(error, options)` asks the C++ side to emit a
    // `CONNECTION_CLOSE` frame via `endpoint.Send(...)`. Once the
    // endpoint has entered its closing state (after `close()`) it
    // can drop those outgoing packets, in which case the peer would
    // never learn of the teardown until its own idle timer fires
    // (pimterry's B8).
    //
    // Important: only pass close options to sessions whose handshake
    // has actually completed. Pre-handshake sessions cannot create a
    // valid CONNECTION_CLOSE packet on the C++ side; the fallback
    // synchronously fires `EmitClose` -> JS `[kFinishClose]` ->
    // `destroy()`, which trips the `#destroying` guard and leaves the
    // C++ side asserting an inconsistent destroyed state.
    const closeOptions = errorToCloseOptions(error);
    // Once a graceful close is already in flight the endpoint no longer
    // puts packets on the wire (Node's Endpoint::Send drops them in the
    // closing state), so a destroy(err) arriving after close() tears the
    // sessions down silently — the peers clean up via their idle timers.
    const alreadyClosing = this.#isClosedOrClosing;
    for (const session of inner.sessions) {
      // Mark each cascaded session's `closed` as handled before
      // destroying it. This prevents unhandled-rejection warnings when
      // the session is collateral damage from an endpoint-level destroy
      // (e.g. a synchronous throw out of a user `onsession` callback
      // routed through safeCallbackInvoke). The rejection is still
      // observable to any caller that explicitly awaits `session.closed`.
      markPromiseAsHandled(session.closed);
      session.destroy(error, !alreadyClosing && session[kHandshakeCompleted] ? closeOptions : undefined);
    }
    if (!this.#isClosedOrClosing) {
      // Trigger a graceful close of the endpoint that'll ensure that the
      // endpoint is closed down after all sessions are closed... All
      // sessions were just forcefully destroyed above, so this should
      // resolve promptly with nothing left to drain.
      this.close();
    }
    return this.closed;
  }

  /**
   * Replace or merge SNI TLS contexts for this endpoint. Each entry
   * in the map is a host name to TLS identity options object. If
   * replace is true, the entire SNI map is replaced. Otherwise, the
   * provided entries are merged into the existing map.
   * @param {object} entries
   * @param {SNIContextOptions} [options]
   */
  setSNIContexts(entries, options = kEmptyObject) {
    assertIsQuicEndpoint(this);
    if (this.#handle === undefined) {
      throw new ERR_INVALID_STATE("Endpoint is destroyed");
    }
    validateObject(entries, "entries");
    const { replace = false } = options;
    validateBoolean(replace, "options.replace");

    // Process each entry through the identity options validator,
    // then build a full TLS options object (shared + identity).
    const processed = { __proto__: null };
    for (const hostname of ObjectKeys(entries)) {
      validateString(hostname, "entries key");
      const identity = processIdentityOptions(entries[hostname], `entries['${hostname}']`);
      if (identity.keys.length === 0) {
        throw new ERR_MISSING_ARGS(`entries['${hostname}'].keys`);
      }
      if (identity.certs === undefined) {
        throw new ERR_MISSING_ARGS(`entries['${hostname}'].certs`);
      }
      processed[hostname] = identity;
    }

    this.#handle.setSNIContexts(processed, replace);
  }

  [kFinishClose](context, status) {
    if (this.#handle === undefined) return;
    debug("endpoint is finishing close", context, status);
    endpointRegistry.delete(this);
    this.#handle = undefined;
    const inner = this.#inner;
    inner.stats[kFinishClose]();
    inner.state[kFinishClose]();
    if (this[kPerfEntry] && hasObserver("quic")) {
      stopPerf(this, kPerfEntry, {
        detail: { stats: this.stats },
      });
    }
    inner.address = undefined;
    inner.busy = false;
    inner.listening = false;
    inner.isPendingClose = false;

    // As QuicSessions are closed they are expected to remove themselves
    // from the sessions collection. Just in case they don't, let's force
    // it by resetting the set so we don't leak memory. Let's emit a warning,
    // tho, if the set is not empty at this point as that would indicate a
    // bug in Node.js that should be fixed.
    const sessionCount = inner.sessions.size;
    if (sessionCount > 0) {
      process.emitWarning(
        `The endpoint is closed with ${sessionCount} active sessions. ` +
          "This should not happen and indicates a bug in Node.js. Please open an " +
          "issue in the Node.js GitHub repository at https://github.com/nodejs/node " +
          "to report the problem.",
      );
    }
    inner.sessions.clear();

    // If destroy was called with an error, then the this.#pendingError will be
    // set. Or, if context indicates an error condition that caused the endpoint
    // to be closed, the status will indicate the error code. In either case,
    // we will reject the pending close promise at this point.
    const maybeCloseError = maybeGetCloseError(context, status, inner.pendingError);
    if (maybeCloseError !== undefined) {
      if (onEndpointErrorChannel.hasSubscribers) {
        onEndpointErrorChannel.publish({
          __proto__: null,
          endpoint: this,
          error: maybeCloseError,
        });
      }
      inner.pendingClose.reject(maybeCloseError);
    } else {
      // Otherwise we are good to resolve the pending close promise!
      inner.pendingClose.resolve();
    }
    if (onEndpointClosedChannel.hasSubscribers && !inner.suppressCloseChannels) {
      onEndpointClosedChannel.publish({
        __proto__: null,
        endpoint: this,
        stats: inner.stats,
      });
    }

    // Note that we are intentionally not clearing the
    // this.#pendingClose.promise here.
    inner.pendingClose.resolve = undefined;
    inner.pendingClose.reject = undefined;
    inner.pendingError = undefined;
  }

  [kNewSession](handle) {
    const inner = this.#inner;
    assert(typeof inner.onsession === "function", "onsession callback not specified");
    const session = this.#newSession(handle);
    // Apply session callbacks stored at listen time before notifying
    // the onsession callback, to avoid missing events that fire
    // during or immediately after the handshake.
    const { sessionCallbacks } = inner;
    if (sessionCallbacks) {
      applyCallbacks(session, sessionCallbacks);
    }
    if (onEndpointServerSessionChannel.hasSubscribers) {
      onEndpointServerSessionChannel.publish({
        __proto__: null,
        endpoint: this,
        session,
        address: session.path?.remote,
      });
    }
    // Route through safeCallbackInvoke so that a synchronous throw or a
    // rejected promise from the user's onsession callback destroys this
    // endpoint with the error rather than surfacing as an unhandled
    // exception or unhandled rejection coming out of the C++ -> JS
    // boundary.
    safeCallbackInvoke(inner.onsession, this, session);
  }

  // Called by the QuicSession when it closes to remove itself from
  // the active sessions tracked by the QuicEndpoint.
  [kRemoveSession](session) {
    const inner = this.#inner;
    inner.sessions.delete(session);
    // A non-listening endpoint destroys itself once its last session
    // closes: immediately by default, or after `idleTimeout` seconds.
    if (inner.sessions.size !== 0 || inner.listening || this.destroyed || inner.isPendingClose) {
      return;
    }
    // With the default idleTimeout (0) the endpoint stays alive but the
    // native side unrefs its UDP handle, so an idle endpoint does not hold
    // the event loop open (Node parity: idle endpoints are unref'd, not
    // destroyed — see test-quic-endpoint-idle-timeout).
    if (!inner.idleTimeout) {
      return;
    }
    // With idleTimeout > 0 the endpoint destroys itself after staying idle
    // that long. The automatic teardown is silent:
    // `quic.endpoint.closing/closed` report user-initiated closes only.
    const timer = setTimeout(() => {
      if (!this.destroyed && !inner.listening && inner.sessions.size === 0) {
        inner.suppressCloseChannels = true;
        this.destroy();
      }
    }, inner.idleTimeout * 1000);
    if (typeof timer?.unref === "function") timer.unref();
  }

  [kInspect](depth, options) {
    if (depth < 0) {
      return "QuicEndpoint { }";
    }

    const opts = {
      __proto__: null,
      ...options,
      depth: options.depth == null ? null : options.depth - 1,
    };

    const { address, busy, isPendingClose: closing, listening, sessions, stats, state } = this.#inner;

    return `QuicEndpoint ${inspect(
      {
        address,
        busy,
        closed: this.closed,
        closing,
        destroyed: this.destroyed,
        listening,
        sessions,
        stats,
        state,
      },
      opts,
    )}`;
  }

  async [SymbolAsyncDispose]() {
    await this.close();
  }
}

/**
 * MUST match `alpn_cstr_is_http` in `src/runtime/node/quic/endpoint.rs`
 * (which cross-references this fn). `alpn` is the RAW, not-yet-validated
 * `options.alpn`: never throw here -- a non-string is treated as the HTTP/3
 * default and rejected with the proper error by `processTlsOptions` later.
 * @param {string|string[]|undefined} alpn
 */
function alpnWantsHttp(alpn) {
  const first = ArrayIsArray(alpn) ? alpn[0] : alpn;
  return typeof first !== "string" || first === "h3" || StringPrototypeStartsWith(first, "h3-");
}

/**
 * Find an existing endpoint from the registry that is suitable for reuse
 * as an implicit client endpoint. Listening (server) endpoints are never
 * reused, and neither is one whose client engine is already fixed in the
 * other HTTP/3-vs-raw mode (see `kClientHttp`).
 */
function findSuitableEndpoint(wantHttp) {
  for (const endpoint of endpointRegistry) {
    if (!endpoint.destroyed && !endpoint.closing && !endpoint.busy) {
      const mode = endpoint[kClientHttp];
      if (mode !== undefined && mode !== wantHttp) {
        continue;
      }
      // Never reuse a listening (server) endpoint as an implicit client
      // endpoint: a wildcard-bound server would otherwise be picked for a
      // connection to itself (e.g. target 127.0.0.1 vs bind 0.0.0.0),
      // looping packets through both of its engines.
      if (endpoint.listening) {
        continue;
      }
      return endpoint;
    }
  }
  return undefined;
}

/**
 * @param {EndpointOptions|QuicEndpoint|undefined} endpoint
 * @param {boolean} reuseEndpoint
 * @param {boolean} forServer
 * @returns {QuicEndpoint}
 */
function processEndpointOption(endpoint, reuseEndpoint = true, forServer = false, wantHttp = true) {
  if (isQuicEndpoint(endpoint)) {
    // We were given an existing endpoint. Use it as-is.
    return endpoint;
  }
  if (endpoint !== undefined) {
    // We were given endpoint options. If reuse is enabled, we could
    // look for a matching endpoint, but endpoint options imply the
    // caller wants specific configuration. Create a new one.
    return new QuicEndpoint(endpoint);
  }
  // No endpoint specified. Try to reuse an existing one if allowed.
  if (reuseEndpoint && !forServer) {
    const existing = findSuitableEndpoint(wantHttp);
    if (existing !== undefined) return existing;
  }
  return new QuicEndpoint();
}

/**
 * Validate and extract identity options (keys, certs) from an SNI entry.
 * CA and CRL are shared TLS options, not per-identity.
 * @param {object} identity
 * @param {string} label
 * @returns {object}
 */
function processIdentityOptions(identity, label) {
  const { keys, certs, verifyPrivateKey = false } = identity;

  if (certs !== undefined) {
    const certInputs = ArrayIsArray(certs) ? certs : [certs];
    for (const cert of certInputs) {
      if (!isArrayBufferView(cert) && !isArrayBuffer(cert)) {
        throw new ERR_INVALID_ARG_TYPE(`${label}.certs`, ["ArrayBufferView", "ArrayBuffer"], cert);
      }
    }
  }

  const keyHandles = [];
  if (keys !== undefined) {
    const keyInputs = ArrayIsArray(keys) ? keys : [keys];
    for (const key of keyInputs) {
      if (isKeyObject(key)) {
        if (getKeyObjectType(key) !== "private") {
          throw new ERR_INVALID_ARG_VALUE(`${label}.keys`, key, "must be a private key");
        }
        ArrayPrototypePush(keyHandles, getKeyObjectHandle(key));
      } else {
        throw new ERR_INVALID_ARG_TYPE(`${label}.keys`, "KeyObject", key);
      }
    }
  }

  validateBoolean(verifyPrivateKey, `${label}.verifyPrivateKey`);

  return {
    __proto__: null,
    keys: keyHandles,
    certs,
    verifyPrivateKey,
  };
}

/**
 * @param {object} tls
 * @param {boolean} forServer
 * @returns {object}
 */
function processTlsOptions(tls, forServer) {
  const {
    servername,
    alpn,
    ciphers = DEFAULT_CIPHERS,
    groups = DEFAULT_GROUPS,
    keylog = false,
    verifyClient = false,
    rejectUnauthorized = true,
    enableEarlyData = true,
    tlsTrace = false,
    sni,
    // Client-only: identity options are specified directly (no sni map)
    keys,
    certs,
    ca,
    crl,
    verifyPrivateKey = false,
  } = tls;

  if (servername !== undefined) {
    validateString(servername, "options.servername");
  }
  if (ciphers !== undefined) {
    validateString(ciphers, "options.ciphers");
  }
  if (groups !== undefined) {
    validateString(groups, "options.groups");
  }
  validateBoolean(keylog, "options.keylog");
  validateBoolean(verifyClient, "options.verifyClient");
  validateBoolean(rejectUnauthorized, "options.rejectUnauthorized");
  validateBoolean(enableEarlyData, "options.enableEarlyData");
  validateBoolean(tlsTrace, "options.tlsTrace");

  // Encode the ALPN option to wire format (length-prefixed protocol names).
  // Server: array of protocol names. Client: single protocol name.
  // If not specified, the C++ default (h3) is used.
  let encodedAlpn;
  if (alpn !== undefined) {
    const protocols = forServer ? (ArrayIsArray(alpn) ? alpn : [alpn]) : [alpn];
    if (!forServer) {
      validateString(alpn, "options.alpn");
    }
    let totalLen = 0;
    for (let i = 0; i < protocols.length; i++) {
      validateString(protocols[i], `options.alpn[${i}]`);
      if (protocols[i].length === 0 || protocols[i].length > 255) {
        throw new ERR_INVALID_ARG_VALUE(`options.alpn[${i}]`, protocols[i], "must be between 1 and 255 characters");
      }
      totalLen += 1 + protocols[i].length;
    }
    // Build wire format: [len1][name1][len2][name2]...
    const buf = Buffer.allocUnsafe(totalLen);
    let offset = 0;
    for (let i = 0; i < protocols.length; i++) {
      buf[offset++] = protocols[i].length;
      buf.write(protocols[i], offset, "ascii");
      offset += protocols[i].length;
    }
    // Pass the Buffer itself: a latin1 string round-trips through
    // to_utf8_bytes() natively, which two-byte-encodes any length prefix
    // >= 0x80 (a 128-255 char protocol name) and desyncs the wire format.
    encodedAlpn = buf;
  }

  if (ca !== undefined) {
    const caInputs = ArrayIsArray(ca) ? ca : [ca];
    for (const caCert of caInputs) {
      if (!isArrayBufferView(caCert) && !isArrayBuffer(caCert)) {
        throw new ERR_INVALID_ARG_TYPE("options.ca", ["ArrayBufferView", "ArrayBuffer"], caCert);
      }
    }
  }

  if (crl !== undefined) {
    const crlInputs = ArrayIsArray(crl) ? crl : [crl];
    for (const crlCert of crlInputs) {
      if (!isArrayBufferView(crlCert) && !isArrayBuffer(crlCert)) {
        throw new ERR_INVALID_ARG_TYPE("options.crl", ["ArrayBufferView", "ArrayBuffer"], crlCert);
      }
    }
  }

  // Shared TLS options (same for all identities on the endpoint).
  const shared = {
    __proto__: null,
    servername,
    alpn: encodedAlpn,
    ciphers,
    groups,
    keylog,
    verifyClient,
    rejectUnauthorized,
    enableEarlyData,
    tlsTrace,
    ca,
    crl,
  };

  // For servers, identity options come from the sni map.
  // The '*' entry is the optional default/fallback identity. If omitted,
  // only connections with a servername matching a specific entry will
  // succeed; all others will be rejected at the TLS level.
  if (forServer) {
    if (sni === undefined || typeof sni !== "object") {
      throw new ERR_MISSING_ARGS("options.sni");
    }

    // Must have at least one identity entry (wildcard or hostname-specific).
    // A server with no identity at all cannot serve any connections.
    const sniKeys = ObjectKeys(sni);
    if (sniKeys.length === 0) {
      throw new ERR_MISSING_ARGS("options.sni");
    }

    // Process the default ('*') identity if present.
    let defaultIdentity = {};
    if (sni["*"] !== undefined) {
      defaultIdentity = processIdentityOptions(sni["*"], "options.sni['*']");
      if (defaultIdentity.keys.length === 0) {
        throw new ERR_MISSING_ARGS("options.sni['*'].keys");
      }
      if (defaultIdentity.certs === undefined) {
        throw new ERR_MISSING_ARGS("options.sni['*'].certs");
      }
    }

    // Build the SNI entries (excluding '*') as full TLS options objects.
    // Each inherits the shared options and overrides the identity fields.
    // Non-wildcard entries that are authoritative (the default) are also
    // advertised to HTTP/3 clients via an ORIGIN frame (RFC 9412).
    const sniEntries = { __proto__: null };
    const origins = [];
    for (const hostname of sniKeys) {
      if (hostname === "*") continue;
      validateString(hostname, "options.sni key");
      const identity = processIdentityOptions(sni[hostname], `options.sni['${hostname}']`);
      if (identity.keys.length === 0) {
        throw new ERR_MISSING_ARGS(`options.sni['${hostname}'].keys`);
      }
      if (identity.certs === undefined) {
        throw new ERR_MISSING_ARGS(`options.sni['${hostname}'].certs`);
      }
      // Extract ORIGIN frame options from the SNI entry.
      const { port, authoritative } = sni[hostname];
      if (authoritative !== false) {
        // The https default port (443) is omitted from the origin string.
        ArrayPrototypePush(origins, `https://${hostname}${port !== undefined && port !== 443 ? `:${port}` : ""}`);
      }
      // Build a full TLS options object: shared + identity + origin options.
      sniEntries[hostname] = {
        __proto__: null,
        ...shared,
        ...identity,
        ...(port !== undefined ? { port } : {}),
        ...(authoritative !== undefined ? { authoritative } : {}),
      };
    }

    return {
      __proto__: null,
      ...shared,
      ...defaultIdentity,
      sni: sniEntries,
      ...(origins.length !== 0 ? { origins } : {}),
    };
  }

  // For clients, identity options are specified directly (no sni map).
  // CA and CRL are in the shared options, not per-identity.
  const clientIdentity = processIdentityOptions(
    {
      keys,
      certs,
      verifyPrivateKey,
    },
    "options",
  );

  return {
    __proto__: null,
    ...shared,
    ...clientIdentity,
  };
}

/**
 * @param {'use'|'ignore'|'default'} policy
 * @returns {number}
 */
/**
 * Validate and normalize close error options for session.close() and
 * session.destroy(). Returns the options object to pass to C++.
 * @param {object} options
 * @returns {object}
 */
function validateCloseOptions(options) {
  validateObject(options, "options");
  const { code, type = "transport", reason } = options;

  if (code !== undefined) {
    if (typeof code !== "bigint" && typeof code !== "number") {
      throw new ERR_INVALID_ARG_TYPE("options.code", ["bigint", "number"], code);
    }
  }
  validateOneOf(type, "options.type", ["transport", "application"]);
  if (reason !== undefined) {
    validateString(reason, "options.reason");
  }

  return { __proto__: null, code, type, reason };
}

function getPreferredAddressPolicy(policy = "default") {
  switch (policy) {
    case "use":
      return kPreferredAddressUse;
    case "ignore":
      return kPreferredAddressIgnore;
    case "default":
      return kPreferredAddressDefault;
  }
  throw new ERR_INVALID_ARG_VALUE("options.preferredAddressPolicy", policy);
}

/**
 * @param {SessionOptions} options
 * @param {ProcessSessionOptions} [config]
 * @returns {SessionOptions}
 */
function processSessionOptions(options, config = kEmptyObject) {
  validateObject(options, "options");
  const {
    endpoint,
    reuseEndpoint = true,
    version,
    minVersion,
    preferredAddressPolicy = "ignore",
    transportParams = kEmptyObject,
    qlog = false,
    sessionTicket,
    token,
    maxPayloadSize,
    unacknowledgedPacketThreshold = 0,
    handshakeTimeout,
    initialRtt,
    keepAlive,
    maxStreamWindow,
    maxWindow,
    cc,
    datagramDropPolicy = "drop-oldest",
    drainingPeriodMultiplier = 3,
    maxDatagramSendAttempts = 5,
    streamIdleTimeout,
    verifyPeer = "auto",
    // HTTP/3 application-specific options. Nested under `application`
    // to separate protocol-specific settings from transport-level ones.
    application = kEmptyObject,
    // Session callbacks that can be set at construction time to avoid
    // race conditions with events that fire during or immediately
    // after the handshake.
    onerror,
    onstream,
    ondatagram,
    ondatagramstatus,
    onpathvalidation,
    onsessionticket,
    onversionnegotiation,
    onhandshake,
    onnewtoken,
    onearlyrejected,
    onorigin,
    ongoaway,
    onkeylog,
    onqlog,
    // Stream-level callbacks.
    onheaders,
    ontrailers,
    oninfo,
    onwanttrailers,
  } = options;

  const { forServer = false } = config;

  if (token !== undefined) {
    if (!isArrayBufferView(token)) {
      throw new ERR_INVALID_ARG_TYPE("options.token", ["ArrayBufferView"], token);
    }
  }

  if (cc !== undefined) {
    validateOneOf(cc, "options.cc", [CC_ALGO_RENO, CC_ALGO_BBR, CC_ALGO_CUBIC]);
  }

  validateOneOf(datagramDropPolicy, "options.datagramDropPolicy", ["drop-oldest", "drop-newest"]);

  validateOneOf(verifyPeer, "options.verifyPeer", ["strict", "auto", "manual"]);

  validateInteger(drainingPeriodMultiplier, "options.drainingPeriodMultiplier", 3, 255);

  validateInteger(maxDatagramSendAttempts, "options.maxDatagramSendAttempts", 1, 255);

  // Validate preferred address in transport params if provided.
  // Validate numeric transport params. Node accepts number | bigint and
  // rejects everything else with ERR_INVALID_ARG_TYPE. Negative values are
  // rejected with ERR_OUT_OF_RANGE.
  for (const name of [
    "initialMaxStreamDataBidiLocal",
    "initialMaxStreamDataBidiRemote",
    "initialMaxStreamDataUni",
    "initialMaxData",
    "initialMaxStreamsBidi",
    "initialMaxStreamsUni",
    "maxIdleTimeout",
    "maxUdpPayloadSize",
    "maxAckDelay",
    "ackDelayExponent",
    "activeConnectionIDLimit",
    "maxDatagramFrameSize",
  ]) {
    const v = transportParams[name];
    if (v === undefined) continue;
    if (
      (typeof v !== "number" && typeof v !== "bigint") ||
      (typeof v === "number" && (v < 0 || !NumberIsInteger(v))) ||
      (typeof v === "bigint" && v < 0n) ||
      // maxDatagramFrameSize is a uint16 (RFC 9221 §3).
      (name === "maxDatagramFrameSize" && BigInt(v) > 65535n)
    ) {
      throw new ERR_INVALID_ARG_VALUE(`options.transportParams.${name}`, v, "must be a non-negative number or bigint");
    }
  }

  const { preferredAddressIpv4, preferredAddressIpv6 } = transportParams;
  if (preferredAddressIpv4 !== undefined) {
    if (!SocketAddress.isSocketAddress(preferredAddressIpv4)) {
      throw new ERR_INVALID_ARG_TYPE(
        "options.transportParams.preferredAddressIpv4",
        "SocketAddress",
        preferredAddressIpv4,
      );
    }
    if (preferredAddressIpv4.family !== "ipv4") {
      throw new ERR_INVALID_ARG_VALUE(
        "options.transportParams.preferredAddressIpv4",
        preferredAddressIpv4,
        "must be an IPv4 address",
      );
    }
  }
  if (preferredAddressIpv6 !== undefined) {
    if (!SocketAddress.isSocketAddress(preferredAddressIpv6)) {
      throw new ERR_INVALID_ARG_TYPE(
        "options.transportParams.preferredAddressIpv6",
        "SocketAddress",
        preferredAddressIpv6,
      );
    }
    if (preferredAddressIpv6.family !== "ipv6") {
      throw new ERR_INVALID_ARG_VALUE(
        "options.transportParams.preferredAddressIpv6",
        preferredAddressIpv6,
        "must be an IPv6 address",
      );
    }
  }

  // `true` is a don't-care for servers (`processEndpointOption` never
  // consults the registry for them).
  const wantHttp = forServer || alpnWantsHttp(options.alpn);
  const actualEndpoint = processEndpointOption(endpoint, reuseEndpoint, forServer, wantHttp);

  // Normalize the application (HTTP/3) options into the null-prototype
  // shape Node stores and returns from `session.applicationOptions`:
  // numeric fields become BigInt and the `DTable` input spelling is
  // normalized to `Dtable`.
  const {
    maxHeaderPairs = 128n,
    maxHeaderLength = 16384n,
    maxFieldSectionSize = 0n,
    qpackMaxDTableCapacity = 0n,
    qpackEncoderMaxDTableCapacity = 0n,
    qpackBlockedStreams = 0n,
    enableConnectProtocol = false,
    enableDatagrams = true,
  } = application;
  if (sessionTicket !== undefined) {
    if (!isArrayBufferView(sessionTicket)) {
      throw new ERR_INVALID_ARG_TYPE("options.sessionTicket", ["ArrayBufferView"], sessionTicket);
    }
    // Structural check of the resumption blob delivered by
    // `onsessionticket` (big-endian): version tag (4) + format version (4,
    // must be 1) + ticket length (4) + ticket + transport-params length
    // (4) + transport params. Anything else cannot resume a session.
    const tb = new DataView(sessionTicket.buffer, sessionTicket.byteOffset, sessionTicket.byteLength);
    let ok = sessionTicket.byteLength >= 16 && DataViewPrototypeGetUint32(tb, 4) === 1;
    if (ok) {
      const ticketSz = DataViewPrototypeGetUint32(tb, 8);
      ok = 12 + ticketSz + 4 <= sessionTicket.byteLength;
      if (ok) {
        const trapaSz = DataViewPrototypeGetUint32(tb, 12 + ticketSz);
        ok = 12 + ticketSz + 4 + trapaSz === sessionTicket.byteLength;
      }
    }
    if (!ok) {
      throw new ERR_INVALID_ARG_VALUE("options.sessionTicket", sessionTicket, "is not a valid session ticket");
    }
  }

  const normalizedApplication = {
    __proto__: null,
    maxHeaderPairs: BigInt(maxHeaderPairs),
    maxHeaderLength: BigInt(maxHeaderLength),
    maxFieldSectionSize: BigInt(maxFieldSectionSize),
    qpackMaxDtableCapacity: BigInt(qpackMaxDTableCapacity),
    qpackEncoderMaxDtableCapacity: BigInt(qpackEncoderMaxDTableCapacity),
    qpackBlockedStreams: BigInt(qpackBlockedStreams),
    enableConnectProtocol: !!enableConnectProtocol,
    enableDatagrams: !!enableDatagrams,
  };

  return {
    __proto__: null,
    endpoint: actualEndpoint,
    version,
    minVersion,
    preferredAddressPolicy: getPreferredAddressPolicy(preferredAddressPolicy),
    transportParams: {
      ...transportParams,
      preferredAddressIpv4: preferredAddressIpv4?.[kSocketAddressHandle],
      preferredAddressIpv6: preferredAddressIpv6?.[kSocketAddressHandle],
    },
    tls: {
      ...processTlsOptions(options, forServer),
      // Forward strict mode to C++ so SSL_VERIFY_PEER is set on the
      // client SSL_CTX. For 'auto' and 'manual' modes, the handshake
      // completes regardless and the result is handled in JS.
      verifyPeerStrict: verifyPeer === "strict",
      // Enable hostname verification for 'strict' and 'auto' modes.
      // SSL_set1_host tells OpenSSL to verify the server certificate's
      // SAN/CN matches the servername. Without this, a valid cert for
      // any domain would be accepted.
      verifyHostname: verifyPeer !== "manual",
    },
    verifyPeer,
    qlog,
    maxPayloadSize,
    unacknowledgedPacketThreshold,
    handshakeTimeout,
    initialRtt,
    keepAlive,
    maxStreamWindow,
    maxWindow,
    sessionTicket,
    token,
    cc,
    datagramDropPolicy,
    drainingPeriodMultiplier,
    maxDatagramSendAttempts,
    streamIdleTimeout,
    application: normalizedApplication,
    onerror,
    onstream,
    ondatagram,
    ondatagramstatus,
    onpathvalidation,
    onsessionticket,
    onversionnegotiation,
    onhandshake,
    onnewtoken,
    onearlyrejected,
    onorigin,
    ongoaway,
    onkeylog,
    onqlog,
    onheaders,
    ontrailers,
    oninfo,
    onwanttrailers,
  };
}

// ============================================================================

/**
 * @param {OnSessionCallback} callback
 * @param {SessionOptions} [options]
 * @returns {Promise<QuicEndpoint>}
 */
async function listen(callback, options = kEmptyObject) {
  validateFunction(callback, "callback");
  const { endpoint, ...sessionOptions } = processSessionOptions(options, { forServer: true });
  endpoint[kListen](callback, sessionOptions);

  if (onEndpointListeningChannel.hasSubscribers) {
    onEndpointListeningChannel.publish({
      __proto__: null,
      endpoint,
      options,
    });
  }

  return endpoint;
}

/**
 * @param {string|SocketAddress} address
 * @param {SessionOptions} [options]
 * @returns {Promise<QuicSession>}
 */
async function connect(address, options = kEmptyObject) {
  if (typeof address === "string") {
    address = SocketAddress.parse(address);
  }

  if (!SocketAddress.isSocketAddress(address)) {
    if (address == null || typeof address !== "object") {
      throw new ERR_INVALID_ARG_TYPE("address", ["SocketAddress", "string"], address);
    }
    address = new SocketAddress(address);
  }

  const { endpoint, ...rest } = processSessionOptions(options);

  if (onEndpointConnectChannel.hasSubscribers) {
    onEndpointConnectChannel.publish({
      __proto__: null,
      endpoint,
      address,
      options,
    });
  }

  const session = endpoint[kConnect](address[kSocketAddressHandle], rest);

  // Only now is the endpoint's client-engine mode really fixed (a connect
  // that throws never builds the engine); record it for `findSuitableEndpoint`.
  endpoint[kNoteClientHttp](alpnWantsHttp(options.alpn));

  if (onEndpointClientSessionChannel.hasSubscribers) {
    onEndpointClientSessionChannel.publish({
      __proto__: null,
      endpoint,
      session,
      address,
      options,
    });
  }

  return session;
}

ObjectDefineProperties(QuicEndpoint, {
  Stats: {
    __proto__: null,
    writable: false,
    configurable: false,
    enumerable: true,
    value: QuicEndpointStats,
  },
});
ObjectDefineProperties(QuicSession, {
  Stats: {
    __proto__: null,
    writable: false,
    configurable: false,
    enumerable: true,
    value: QuicSessionStats,
  },
});
ObjectDefineProperties(QuicStream, {
  Stats: {
    __proto__: null,
    writable: false,
    configurable: false,
    enumerable: true,
    value: QuicStreamStats,
  },
});

// ============================================================================

export default {
  listen,
  connect,
  QuicEndpoint,
  QuicError,
  QuicSession,
  QuicStream,
  CC_ALGO_RENO,
  CC_ALGO_CUBIC,
  CC_ALGO_BBR,
  DEFAULT_CIPHERS,
  DEFAULT_GROUPS,
  // These are exported only for internal testing purposes.
  getQuicStreamState,
  getQuicSessionState,
  getQuicEndpointState,
};
