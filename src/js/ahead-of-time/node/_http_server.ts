// What the compiler reads in place of src/js/node/_http_server.ts, which `bun run` evaluates. The two do the same.
// Written against that file with the SHA-256 7b23b8f1ed10819880e0d9e4b9d91900f337337bf7ef3eecf2fff6ac36c4b692.
// When that file changes, bring the change here and write the new hash: test/internal/second-texts-of-modules.test.ts.

// Hardcoded module "node:_http_server"
const EventEmitter = require("node:events");
const { Stream, Duplex } = require("node:stream");
const StreamPrototype = Stream.prototype;
const plainStream: $Node.Stream = new Stream();
const DuplexPrototype = Stream.Duplex.prototype;
const ReadablePrototype = Stream.Readable.prototype;
const duplexResume = DuplexPrototype.resume;
const duplexRemoveListener = DuplexPrototype.removeListener;
const { flagsOf, getDefaultHighWaterMark, internals: streamInternals } = require("internal/streams/state");
const { queueTick1, queueTick2, ticksAreUnhooked, ring } = require("internal/process/next_tick_queue");
const kFlowing = 1 << 24;
const kHasPaused = 1 << 25;
const kPaused = 1 << 26;
const kSocketFlowMask = kFlowing | kHasPaused | kPaused | (1 << 1) | (1 << 4) | (1 << 10);
const kSocketFlows = kFlowing | kHasPaused;
const kResumeScheduled = 1 << 16;
const { isIP } = require("internal/net/isIP");
const { constructors: netConstructors } = require("internal/net/symbols");
const {
  _checkInvalidHeaderChar: checkInvalidHeaderChar,
  chunkExpression,
  continueExpression,
  validateHeaderName,
  validateHeaderValue,
  HTTPParser,
  calculateLenientFlags,
  parsers,
  freeParser,
  prepareError,
} = require("node:_http_common");
/** The native class `ConnectionsList` of `process.binding("http_parser")`: the parsers of a server's connections. */
interface ConnectionsList {
  all(): $Node.HTTPParser[];
  idle(): $Node.HTTPParser[];
  active(): $Node.HTTPParser[];
  expired(headersTimeout: number, requestTimeout: number): $Node.HTTPParser[];
}
const { ConnectionsList } = process.binding("http_parser") as { ConnectionsList: new () => ConnectionsList };
const AsyncContextFrame = require("internal/async_context_frame");
const {
  validateObject,
  validateLinkHeaderValue,
  validateBoolean,
  validateInteger,
  validateNumber,
  validateFunction,
  validateOneOf,
  validatePort,
} = require("internal/validators");
const {
  ConnResetException,
  ErrnoException,
  ExceptionWithHostPort,
  listenException,
  hasObserver,
  startPerf,
  stopPerf,
  kInternalSendOptions,
  isStoppedModuleGraphRunning,
} = require("internal/shared");
const shared = require("internal/shared");
const kServerResponseStatistics = Symbol("ServerResponseStatistics");

const { isPrimary, loadChild } = require("internal/cluster/isPrimary");
const { addServerAbortSignalOption } = require("internal/net/server_abort_signal");
const http = require("internal/http");
const netSymbols = require("internal/net/symbols");
const kForeignListener: typeof netSymbols.kForeignListener = netSymbols.kForeignListener;
const kHandleClosed: typeof netSymbols.kHandleClosed = netSymbols.kHandleClosed;
const kSNIContexts: typeof netSymbols.kSNIContexts = netSymbols.kSNIContexts;
const { STATUS_CODES, drainMicrotasks, getMaxHTTPHeaderSize, onDataIncomingMessage, RE_CONN_CLOSE } = http;
const enum NodeHTTPResponseAbortEvent {
  none = 0,
  abort = 1,
  timeout = 2,
  readParsed = 3,
}
const enum NodeHTTPResponseFlags {
  socket_closed = 1 << 0,
  request_has_completed = 1 << 1,
  ended = 1 << 2,

  closed_or_completed = socket_closed | request_has_completed,
}
// A symbol taken out of a pattern is a plain `symbol` for the type checker, and what it keys is untyped.
const kInternalSocketData: typeof http.kInternalSocketData = http.kInternalSocketData;
const serverSymbol: typeof http.serverSymbol = http.serverSymbol;
const kHandle: typeof http.kHandle = http.kHandle;
const kLeaveHttp: typeof http.kLeaveHttp = http.kLeaveHttp;
const kRealListen: typeof http.kRealListen = http.kRealListen;
const kUpgradeStream: typeof http.kUpgradeStream = http.kUpgradeStream;
const tlsSymbol: typeof http.tlsSymbol = http.tlsSymbol;
const kPendingCallbacks: typeof http.kPendingCallbacks = http.kPendingCallbacks;
const fakeSocketSymbol: typeof http.fakeSocketSymbol = http.fakeSocketSymbol;
const kDetachedFrom = Symbol("kDetachedFrom");
const kKeepAliveTimeoutSet = Symbol("keepAliveTimeoutSet");
// The key that internal/timers exports as `kTimeout`.
const kTimeout = Symbol.for("::buntimeout::");
const kBytesBuffered = Symbol("kBytesBuffered");
const kAccountingFlushScheduled = Symbol("kAccountingFlushScheduled");
const kSnapshotStatusCode = Symbol("kSnapshotStatusCode");
const kSnapshotStatusMessage = Symbol("kSnapshotStatusMessage");
const kFramingFrozenChunked = Symbol("kFramingFrozenChunked");
const kImplicitHeaderFromEnd = Symbol("kImplicitHeaderFromEnd");
const kPendingFinish = Symbol("kPendingFinish");
const kCloseCallback: typeof http.kCloseCallback = http.kCloseCallback;
const isTlsSymbol: typeof http.isTlsSymbol = http.isTlsSymbol;
const kOutHeaders: typeof http.kOutHeaders = http.kOutHeaders;
const kErrored: typeof http.kErrored = http.kErrored;
const kHighWaterMark: typeof http.kHighWaterMark = http.kHighWaterMark;
const kSocket: typeof http.kSocket = http.kSocket;
const kRejectNonStandardBodyWrites: typeof http.kRejectNonStandardBodyWrites = http.kRejectNonStandardBodyWrites;
const kUniqueHeaders: typeof http.kUniqueHeaders = http.kUniqueHeaders;
const kReqShouldKeepAlive: typeof http.kReqShouldKeepAlive = http.kReqShouldKeepAlive;
const kIncomingMessage: typeof http.kIncomingMessage = http.kIncomingMessage;
const kFailHeldWrites: typeof http.kFailHeldWrites = http.kFailHeldWrites;
const kFinishesWithoutLastWrite: typeof http.kFinishesWithoutLastWrite = http.kFinishesWithoutLastWrite;
const kCapture: typeof shared.kCapture = shared.kCapture;
const kShapeMode: typeof shared.kShapeMode = shared.kShapeMode;
const kClusterOwner: typeof shared.kClusterOwner = shared.kClusterOwner;
const EventEmitterPrototype = EventEmitter.prototype;
const kCorked: typeof http.kCorked = http.kCorked;
const kChunkedBuffer: typeof http.kChunkedBuffer = http.kChunkedBuffer;
const kChunkedLength: typeof http.kChunkedLength = http.kChunkedLength;
const kBytesWritten: typeof http.kBytesWritten = http.kBytesWritten;
const kLenientValidation: typeof http.kLenientValidation = http.kLenientValidation;
const kNeedDrain: typeof http.kNeedDrain = http.kNeedDrain;
type Exchange = $Node.HttpExchange;
const HEADER_DATE = 1 << 0;
const HEADER_CONNECTION = 1 << 1;
const HEADER_KEEP_ALIVE = 1 << 2;
const HEADER_TRANSFER_ENCODING = 1 << 3;
const HEADER_CONTENT_LENGTH = 1 << 4;
const HEADER_TRAILER = 1 << 5;
const HEADER_SPILLED = 1 << 6;
const HEADER_MAP_IS_MISSING = 1 << 7;
const HEADER_UNUSUAL = HEADER_DATE | HEADER_CONNECTION | HEADER_KEEP_ALIVE | HEADER_TRANSFER_ENCODING | HEADER_SPILLED;
const { FakeSocket } = require("internal/http/FakeSocket");
const NumberIsNaN = Number.isNaN;

const { IncomingMessage, readStart } = require("node:_http_incoming");
const takeRequestCloseTick = streamInternals.takeRequestCloseTick!;
const { OutgoingMessage, parseUniqueHeadersOption } = require("node:_http_outgoing");
const endsUnseen = http.requestRoad.endsUnseen!;
const endUnseen = http.requestRoad.endUnseen!;
const beginUnseenDump = http.requestRoad.beginUnseenDump!;
const staysUnseen = http.requestRoad.staysUnseen!;
const continueDump = http.requestRoad.continueDump!;
const queueDump = http.requestRoad.queueDump!;
const mayDumpInPlace = http.requestRoad.mayDumpInPlace!;
const beginDump = http.requestRoad.beginDump!;
const makeExchange = http.responseRoad.makeExchange!;
const storeHeader = http.responseRoad.storeHeader!;
const spillHeaders = http.responseRoad.spillHeaders!;
const spillHeadersReachedThrough = http.responseRoad.spillHeadersReachedThrough!;
const hasHeaderUnderKey = http.responseRoad.hasHeaderUnderKey!;
const flatHeadersOf = http.responseRoad.flatHeadersOf!;
const headerEntriesOf = http.responseRoad.headerEntriesOf!;
const pushRenderedHeader = http.responseRoad.pushRenderedHeader!;
const outgoingSetHeader = http.responseRoad.outgoingSetHeader!;
const OutgoingMessagePrototype = OutgoingMessage.prototype;
const outgoingGetHeader = OutgoingMessagePrototype.getHeader;
const outgoingHasHeader = OutgoingMessagePrototype.hasHeader;
const outgoingSocketSetter: (this: $Node.OutgoingMessage, value: $Node.HttpSocket | null) => void =
  Object.getOwnPropertyDescriptor(OutgoingMessagePrototype, "socket")!.set!;
const kConnections = Symbol("http.server.connections");
const buntls = Symbol.for("::buntls::");
const kConnectionsCheckingInterval = Symbol("http.server.connectionsCheckingInterval");
const kTrackedConnections = Symbol("http.server.trackedConnections");
const kPendingDrainClose = Symbol("http.server.pendingDrainClose");
const kPendingCloseGenerations = Symbol("http.server.pendingCloseGenerations");
const kListenerGeneration = Symbol("http.server.listenerGeneration");
const kClusterHandle = Symbol("http.server.clusterHandle");
// listen() and close() bump it, so a reply from the cluster primary to an earlier listen() is dropped.
const kClusterListeningId = Symbol("http.server.clusterListeningId");
// Under `bun --hot`, maps a reused native server to the http.Server it dispatches to, or to null once another http.Server stopped it.
let nativeServerOwners: WeakMap<WeakKey, $Node.HttpServer | null> | undefined;
// Set on the 'connect'/'upgrade' handoff; closeAll/closeIdleConnections() skip these, as in Node.
const kHandedOff = Symbol("http.server.socketHandedOff");
function closeHandle(handle: $Node.NodeHTTPServerSocket) {
  if (!handle.closed) handle.close();
}
const kHttpAllowHalfOpen = Symbol("http.server.httpAllowHalfOpen");
const kMaxHeadersCount = Symbol("http.server.maxHeadersCount");

// node.http trace events ('http.server.request' b/e). The agent module is
// created when a server listens, and emission is gated per-request on the
// category, so this is near-zero cost when tracing is off.
const kHttpTraceCat = "node,node.http";
let traceEvents: typeof import("internal/trace_event_recorder").default;
// What Node's ServerResponse constructor starts. Node makes no response for an 'upgrade' or a 'connect'.
function observeRequest(req: $Node.IncomingMessage, res: $Node.ServerResponse) {
  if (hasObserver("http")) {
    startPerf(res, kServerResponseStatistics, {
      type: "http",
      name: "HttpRequest",
      detail: { req: { method: req.method, url: req.url, headers: req.headers } },
    });
    res.once("finish", stopServerResponsePerf);
  }
  traceEvents ??= require("internal/trace_event_recorder");
  if (!traceEvents.isCategoryGroupEnabled(kHttpTraceCat)) return;
  traceEvents.emitEvent("b", kHttpTraceCat, "http.server.request");
  res.once("finish", traceServerRequestEnd);
}
function traceServerRequestEnd() {
  traceEvents.emitEvent("e", kHttpTraceCat, "http.server.request");
}

const addServerName = $bindgen("Listener.bind.ts", "addServerName") as (
  listener: $Node.NativeHTTPServer,
  hostname: string,
  context: $Node.NativeSecureContext,
) => void;
const setServerAppFlags = $bindgen("node_http_binding.bind.ts", "setServerAppFlags") as (
  server: $Node.NativeHTTPServer,
  lenientHttpFlags: number,
  httpAllowHalfOpen: boolean,
) => void;
const setServerCustomOptions = $bindgen("node_http_binding.bind.ts", "setServerCustomOptions") as (
  server: $Node.NativeHTTPServer,
  lenientHttpFlags: number,
  httpAllowHalfOpen: boolean,
  maxHeaderSize: number,
  onClientError: (socket: $Node.NodeHTTPServerSocket, errorCode: number, rawPacket: ArrayBuffer) => void,
) => void;
const setServerMaxHeadersCount = $bindgen("node_http_binding.bind.ts", "setServerMaxHeadersCount") as (
  server: $Node.NativeHTTPServer,
  maxHeadersCount: number,
) => void;
const setBunServerSocketHandlers = $bindgen("node_http_binding.bind.ts", "setBunServerSocketHandlers");
const httpConnectionOf = $bindgen("node_http_binding.bind.ts", "httpConnectionOf") as (
  socket: unknown,
) => $Node.NodeHTTPServerSocket | undefined;

const kServerResponse = Symbol("ServerResponse");
const kOptimizeEmptyRequests = Symbol("kOptimizeEmptyRequests");
const kEmptyBuffer = Buffer.alloc(0);
const ObjectKeys = Object.keys;
const ObjectHasOwn = Object.hasOwn;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectSetPrototypeOf = Object.setPrototypeOf;
const ArrayBufferIsView = ArrayBuffer.isView;
const MathMin = Math.min;
const MathFloor = Math.floor;
const timerClockMs = $bindgen("Timer.bind.ts", "timerClockMs") as () => number;

let cluster: typeof import("internal/cluster/child").default | undefined;

function emitCloseServer(self: $Node.HttpServer) {
  // A native close promise belongs to one listener; Node's Server 'close' spans overlapping listeners and handed-off sockets (net.js _emitCloseIfDrained).
  if (!self[kPendingDrainClose]) return;
  const pendingGenerations = self[kPendingCloseGenerations];
  let drainedAtClose = true;
  for (const generation of pendingGenerations) {
    if (!generation.nativeClosed) return;
    drainedAtClose &&= generation.drainedAtClose;
  }
  const relistened = !!self[serverSymbol];
  // Node queues 'close' inside a close() that leaves no connection open. A listen() after it, or a connection to that listener, cannot hold the event back.
  // Without one, the event waits for the 'close' of the sockets that close() swept.
  if (relistened ? !drainedAtClose : self._connections > 0) return;
  self[kPendingDrainClose] = false;
  pendingGenerations.clear();
  if (!relistened) self[kListenerGeneration] = undefined;
  self.emit("close");
}
function emitCloseNotRunning(self: $Node.HttpServer) {
  self.emit("close");
}
function markListenerGenerationClosed(self: $Node.HttpServer, generation: ListenerGeneration) {
  generation.nativeClosed = true;
  emitCloseServerInImmediate(self);
}
function emitCloseNTServer(this: $Node.HttpServer, generation: ListenerGeneration) {
  process.nextTick(markListenerGenerationClosed, this, generation);
}
// 'close' runs in listen()'s async context. Node uses close()'s: https://github.com/oven-sh/bun/pull/33719
function queueCloseNTServer(self: $Node.HttpServer, stopped: Promise<void>, generation: ListenerGeneration) {
  const frame = generation.frame;
  generation.frame = undefined;
  const current = $getInternalField($asyncContext, 0);
  if (frame !== current) $putInternalField($asyncContext, 0, frame);
  try {
    // A server whose Bun.ModuleGraph was disposed emits nothing.
    if (frame === undefined || !isStoppedModuleGraphRunning()) {
      stopped.$then(emitCloseNTServer.bind(self, generation));
    }
  } finally {
    if (frame !== current) $putInternalField($asyncContext, 0, current);
  }
}

function onClose() {}

function settleDispatchAtClose(res: $Node.ServerResponse) {
  const exchange = res.$exchange;
  if (exchange === undefined || exchange.response !== res) {
    ("unlikely");
    if (!res[kCloseCallback]) return;
    res[kCloseCallback]!();
    res[kCloseCallback] = undefined;
    if (exchange === undefined || !exchange.awaitsClose) return;
  } else {
    if (!exchange.awaitsClose) return;
    res[kCloseCallback] = undefined;
  }
  exchange.awaitsClose = false;
  const pendingPromise = exchange.dispatchPromise;
  if (pendingPromise !== null) {
    exchange.dispatchPromise = null;
    $resolvePromiseWithFirstResolvingFunctionCallCheck(pendingPromise, undefined);
  }
}
function emitCloseNT(self: $Node.ServerResponse) {
  if (!self._closed) {
    self.destroyed = true;
    self._closed = true;
    settleDispatchAtClose(self);
    self.emit("close");
  }
}

function setCloseCallback(self: $Node.HttpSocket, callback: (this: $Node.HttpSocket) => void) {
  const current = self[kCloseCallback];
  if (callback === current) {
    return;
  }
  if (current) {
    throw new Error("Close callback already set");
  }
  self[kCloseCallback] = callback;
}

function assignSocketInternal(self: $Node.ServerResponse, socket: $Node.HttpServerSocket) {
  if (socket._httpMessage) {
    throw $ERR_HTTP_SOCKET_ASSIGNED();
  }
  socket._httpMessage = self;
  setCloseCallback(socket, onServerResponseClose);
  self.socket = socket;
  self.emit("socket", socket);
}

function onServerResponseClose(this: $Node.HttpSocket) {
  // EventEmitter.emit makes a copy of the 'close' listeners array before
  // calling the listeners. detachSocket() unregisters onServerResponseClose
  // but if detachSocket() is called, directly or indirectly, by a 'close'
  // listener, onServerResponseClose is still in that copy of the listeners
  // array. That is, in the example below, b still gets called even though
  // it's been removed by a:
  //
  //   const EventEmitter = require('events');
  //   const obj = new EventEmitter();
  //   obj.on('event', a);
  //   obj.on('event', b);
  //   function a() { obj.removeListener('event', b) }
  //   function b() { throw "BAM!" }
  //   obj.emit('event');  // throws
  //
  // Ergo, we need to deal with stale 'close' events and handle the case
  // where the ServerResponse object has already been deconstructed.
  // Fortunately, that requires only a single if check. :-)
  const httpMessage: $Node.ServerResponse | null | undefined = this._httpMessage as any;
  if (httpMessage) {
    emitCloseNT(httpMessage);
  }
}

// Node's write_() checks before _implicitHeader(): the write that renders the headers is counted but not checked. end() is always checked.
function strictContentLength(response: $Node.ServerResponse, hadHeader: boolean, fromEnd: boolean) {
  if (!response.strictContentLength) return;
  return contentLengthToKeepTo(response, hadHeader, fromEnd);
}

function contentLengthToKeepTo(response: $Node.ServerResponse, hadHeader: boolean, fromEnd: boolean) {
  if (!fromEnd && !hadHeader) return;
  let contentLength = response._contentLength ?? response.getHeader("content-length");
  if (
    contentLength != null &&
    response._hasBody &&
    !response.chunkedEncoding &&
    !response.hasHeader("transfer-encoding")
  ) {
    if (typeof contentLength !== "number") {
      contentLength = +contentLength;
      if (NumberIsNaN(contentLength)) {
        return;
      }
    }
    return contentLength;
  }
}

const kParserOnTimeout = HTTPParser.kOnTimeout | 0;

// Node attaches the llhttp HTTPParser to every server connection as
// `socket.parser`. Parsing happens natively here (uWS), so this stand-in only
// mirrors the surface userland observes on it: `incoming`, `free()`, `close()`
// and the kOnTimeout slot, released with freeParser-equivalent bookkeeping when
// the connection closes or is handed over to 'upgrade'/'connect'.
function serverParserShimFree() {}
function serverParserShimClose() {}
function serverParserShimOnTimeout() {}

function createServerParserShim(socket: $Node.HttpServerSocket): $Node.HttpServerParserShim {
  return {
    incoming: null,
    outgoing: null,
    socket,
    _consumed: true,
    free: serverParserShimFree,
    close: serverParserShimClose,
    resume: serverParserShimClose,
    [kParserOnTimeout]: serverParserShimOnTimeout,
  };
}

function releaseServerParserShim(socket: $Node.HttpServerSocket, req?: $Node.IncomingMessage) {
  const parser = socket.parser;
  // A socket that was handed off and came back through emit('connection') has Node's parser, which socketOnClose frees.
  if (parser == null || parser instanceof HTTPParser) return;
  socket.parser = null;
  socket.$isPrepared = false;
  parser.incoming = null;
  parser.socket = null;
  parser[kParserOnTimeout] = null;
  parser.free();
  if (req != null && req.parser != null) req.parser = null;
}

function socketOnTimeout(this: $Node.HttpSocket) {
  // A keep-alive timer that fired is dead: the next response finish arms a new one.
  if (this[kKeepAliveTimeoutSet]) this[kTimeout] = null;
  const req = this.parser?.incoming;
  const reqTimeout = req && !req.complete && req.emit("timeout", this);
  const res = this._httpMessage;
  const resTimeout = res && res.emit("timeout", this);
  const serverTimeout = this.server!.emit("timeout", this);

  if (!reqTimeout && !resTimeout && !serverTimeout) this.destroy();
}

function emitListeningNextTick(self: $Node.HttpServer, hostname: string | undefined, port: number | undefined) {
  // Nothing to announce if close() ran in the same tick as listen(), or the Bun.ModuleGraph
  // whose script listened has been disposed (its listener was closed with it).
  if (!self[serverSymbol] || isStoppedModuleGraphRunning()) return;
  // Node passes no arguments. The extra ones are a Bun extension.
  self.emit("listening", null, hostname, port);
}

function emitListenErrorNextTick(self: $Node.HttpServer, err: unknown) {
  self.emit("error", err);
}

function emitListenError(
  server: $Node.HttpServer,
  err: unknown,
  port: number | string | undefined,
  host: string | undefined,
  socketPath: string | undefined,
  fd: number | undefined,
) {
  if (fd !== undefined) err = listenException(err, null);
  else err = socketPath ? listenException(err, socketPath, -1) : listenException(err, host ?? "::", port as number);
  process.nextTick(emitListenErrorNextTick, server, err);
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1367-L1368
function normalizeServerTls(tls: $Node.HttpServerTLSOptions) {
  tls.requestCert = tls.requestCert === true;
  tls.rejectUnauthorized = tls.rejectUnauthorized !== false;
  return tls;
}

// uWS parses the connections it accepts. Every other Duplex gets Node's connection listener.
function connectionListener(this: $Node.HttpServer, socket: $Node.HttpServerSocket) {
  // A socket that 'connect' or 'upgrade' got is a connection like any other when it's emitted again.
  if (!socket[kHandedOff]) {
    if (socket[kHandle] !== undefined) return;
    const http = httpConnectionOf(socket._handle);
    if (http !== undefined) {
      attachConnection(this, socket, http);
      return;
    }
  }
  const tlsServer = this[tlsSymbol];
  // Its 'connection' listener wraps the socket in a TLSSocket, which comes back as 'secureConnection'.
  if (tlsServer) tlsServer.emit("connection", socket);
  else connectionListenerInternal(this, socket);
}

function secureConnectionListener(this: $Node.HttpServer, socket: $Node.HttpServerSocket) {
  if (socket[kHandle] !== undefined && !socket[kHandedOff]) nativeConnectionListener(this, socket);
  else connectionListenerInternal(this, socket);
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/https.js#L103-L106
function onTLSClientError(this: $Node.HttpServer, err, socket) {
  if (!this.emit("clientError", err, socket)) socket.destroy(err);
  else if (err?.code === "ERR_TLS_HANDSHAKE_TIMEOUT") process.nextTick(destroyUnlessSecure, socket);
}

// handshakeTimeout closes the socket whatever the 'clientError' listener did with it. Node leaves that to the listener.
function destroyUnlessSecure(socket: $Node.HttpServerSocket) {
  if (!socket._secureEstablished) socket.destroy();
}

type Frame = ReturnType<typeof AsyncContextFrame.current>;

/** One `listen()`: a native listener, and what `close()` has to know about it. */
interface ListenerGeneration {
  server: $Node.HttpServer;
  isUnix: boolean;
  tls: $Node.HttpServerTLSOptions | null;
  nativeClosed: boolean;
  drainedAtClose: boolean;
  /** The async context of `listen()`, until `close()`. */
  frame: Frame;
}

/** Holds a turn among the responses that wait: of a request without a response, or of a 'connect' behind responses that are owed. */
interface ResponseTurn {
  destroyed: boolean;
  destroy(): void;
  handedOff?: $Node.NodeHTTPResponse;
}

/** What Node's connection listener keeps for each connection. */
interface ConnectionState {
  onData?: ((chunk: Buffer) => void) | null;
  onEnd?: (() => void) | null;
  onClose?: (() => void) | null;
  onDrain?: (() => void) | null;
  /** In the order of their requests. */
  outgoing: ($Node.ServerResponse | ResponseTurn)[];
  incoming: $Node.IncomingMessage[];
  outgoingData: number;
  onPendingData: ((delta: number) => void) | undefined;
  frame?: Frame;
}

type RequestListener = (request: $Node.IncomingMessage, response: $Node.ServerResponse) => void;

declare global {
  namespace NodeJS {
    interface Timeout {
      readonly _destroyed: boolean;
      /** On the timers' clock. */
      _idleStart: number;
    }
  }

  namespace $Node {
    /** The options of `tls.createSecureContext()` are validated by `internal/tls`. */
    interface HttpServerOptions {
      IncomingMessage?: IncomingMessageConstructor;
      ServerResponse?: ServerResponseConstructor;
      maxHeaderSize?: number;
      insecureHTTPParser?: boolean;
      httpValidation?: "strict" | "relaxed" | "insecure";
      highWaterMark?: number;
      uniqueHeaders?: string[];
      requestTimeout?: number;
      headersTimeout?: number;
      keepAliveTimeout?: number;
      keepAliveTimeoutBuffer?: number;
      connectionsCheckingInterval?: number;
      requireHostHeader?: boolean;
      joinDuplicateHeaders?: boolean;
      shouldUpgradeCallback?: (request: IncomingMessage) => boolean;
      rejectNonStandardBodyWrites?: boolean;
      optimizeEmptyRequests?: boolean;
      allowHalfOpen?: boolean;
      keepAlive?: boolean;
      keepAliveInitialDelay?: number;
      pfx?: unknown;
      cert?: unknown;
      key?: unknown;
      ca?: unknown;
      crl?: unknown;
      passphrase?: string;
      servername?: string;
      secureOptions?: number;
      secureProtocol?: string;
      minVersion?: string;
      maxVersion?: string;
      sessionTimeout?: number;
      ciphers?: string;
      clientCertEngine?: string;
      ticketKeys?: Buffer;
      honorCipherOrder?: boolean;
      sigalgs?: string;
      ecdhCurve?: string;
      requestCert?: boolean;
      rejectUnauthorized?: boolean;
      _pfxExtraCACerts?: unknown[];
    }

    /** `tls` of `Bun.serve()`. */
    interface HttpServerTLSOptions {
      __proto__?: null;
      serverName?: string;
      requestCert?: boolean;
      rejectUnauthorized?: boolean;
      [option: string]: unknown;
    }

    interface HttpServer extends EventEmitter {
      readonly listening: boolean;
      /** The native server while it listens, for those who ask whether there is one. */
      _handle: NativeHTTPServer | null;
      /** `net.Socket` counts the sockets it accepts and closes for this server. */
      _connections: number;
      timeout: number;
      maxRequestsPerSocket: number | null;
      maxHeadersCount: number | null;
      maxConnections?: number;
      noDelay: boolean;
      keepAlive: boolean;
      keepAliveInitialDelay: number;
      highWaterMark: number;
      serverName?: string;
      maxHeaderSize: number | undefined;
      insecureHTTPParser: boolean | undefined;
      httpValidation?: "strict" | "relaxed" | "insecure";
      requestTimeout: number;
      headersTimeout: number;
      keepAliveTimeout: number;
      keepAliveTimeoutBuffer: number;
      connectionsCheckingInterval: number;
      requireHostHeader: boolean;
      joinDuplicateHeaders: boolean | undefined;
      rejectNonStandardBodyWrites: boolean;
      httpAllowHalfOpen: boolean;
      allowHalfOpen: boolean;
      shouldUpgradeCallback: (request: IncomingMessage) => boolean;
      blockList?: BlockList;
      _unref: boolean;
      ref(): this;
      unref(): this;
      close(callback?: (error?: Error) => void): this;
      closeAllConnections(): void;
      closeIdleConnections(): void;
      getConnections(callback: (error: Error | null, count: number) => void): this;
      address(): SocketAddressInfo | string | null;
      listen(...args: unknown[]): this;
      setTimeout(msecs: number, callback?: (socket: HttpSocket) => void): this;
      _emitCloseIfDrained(): void;
      [kServerResponse]: ServerResponseConstructor | undefined;
      [kConnections]?: ConnectionsList;
      [kConnectionsCheckingInterval]: Timeout | undefined;
      [kTrackedConnections]: Set<HttpServerSocket>;
      [kHandedOffSockets]: Set<HttpServerSocket>;
      [kPendingDrainClose]: boolean;
      [kPendingCloseGenerations]: Set<ListenerGeneration>;
      [kListenerGeneration]: ListenerGeneration | undefined;
      [kClusterHandle]: any;
      [kClusterListeningId]: number;
      [kConstructed]?: boolean;
      [kHttpAllowHalfOpen]: boolean;
      [kMaxHeadersCount]: number | null;
      [kOptimizeEmptyRequests]: boolean;
    }

    type HttpServerConstructor = typeof Server;

    interface NativeHTTPServer {
      /** Only `bun --hot` sets one. */
      readonly id: string;
    }

    /** What the server keeps on every connection, its own sockets and the streams that were given to it. */
    interface HttpSocket {
      requestsCount?: number;
      [kHandedOff]?: boolean;
      [kUpgradeStream]?: UpgradeStream;
      [kTimeout]?: Timeout | null;
      [kKeepAliveTimeoutSet]?: boolean;
      [kDetachedWhileClosing]?: ServerResponse;
    }

    /** What the server keeps on a connection. `node:net` makes the object with the layout of `Socket`, which compiled code tests for: a type of its own would fail every test, and a member that `Socket` lacks has no slot. */
    interface Socket {
      // The client declares narrower types for these two on its own sockets, which has to stay a conversion from `Socket`.
      parser?: any;
      _httpMessage?: any;
      _paused?: boolean;
      _SNICallback?: NetServer["_SNICallback"];
      requestsCount?: number;
      $isPrepared?: boolean;
      $ownReadableState?: ReadableState;
      $resumeUnlessFlowing?(asksWhetherReadable: boolean): void;
      [kHandle]?: NodeHTTPServerSocket;
      [kCloseCallback]?: (this: HttpSocket) => void;
      [kHandedOff]?: boolean;
      [kUpgradeStream]?: UpgradeStream;
      [kKeepAliveTimeoutSet]?: boolean;
      [kDetachedWhileClosing]?: ServerResponse;
      [kBoundOnAbort]?: (event: number) => void;
      [kLastResponseWrite]?: number;
      [kStopParsingOnCloseListener]?: boolean;
      [kConnectionState]?: ConnectionState;
      [kUpgradeRequest]?: IncomingMessage;
      [kFinishedAtClose]?: ServerResponse;
      [kHandleClosed]?: (this: HttpServerSocket) => void;
    }

    /** A connection of the native listener: a `net.Socket` or a `tls.TLSSocket`. */
    type HttpServerSocket = Socket;

    interface ServerResponseOptions extends OutgoingMessageOptions {
      [kHandle]?: NodeHTTPResponse | null;
    }

    interface ServerResponse extends OutgoingMessage {
      req: IncomingMessage;
      statusCode: number;
      statusMessage: string | undefined;
      writableCorked: number;
      _sent100: boolean;
      _ended: boolean;
      _expect_continue: boolean;
      [kDetachedFrom]?: HttpServerSocket;
      [kBytesBuffered]?: number;
      [kAccountingFlushScheduled]?: boolean;
      [kSnapshotStatusCode]?: number;
      [kSnapshotStatusMessage]?: string;
      [kFramingFrozenChunked]?: boolean;
      [kImplicitHeaderFromEnd]?: boolean;
      [kPendingFinish]?: HttpWriteCallback | null;
      [kNativeRequest]?: NodeHTTPResponse;
      [kDispatchThrew]?: boolean;
      writeHead(
        statusCode: number,
        statusMessage?: string | HttpHeadersInit | null,
        headers?: HttpHeadersInit | null,
      ): this;
      write(
        chunk?: HttpChunk | null | HttpWriteCallback,
        encoding?: string | null | HttpWriteCallback,
        callback?: HttpWriteCallback | null,
      ): boolean | undefined;
      writeContinue(callback?: () => void): void;
      writeProcessing(callback?: HttpWriteCallback): boolean;
      writeEarlyHints(hints: Record<string, string | string[]>, callback?: HttpWriteCallback): void;
      writeInformation(statusCode: number, headers?: HttpHeadersInit | null, callback?: HttpWriteCallback): boolean;
      assignSocket(socket: HttpSocket): void;
      detachSocket(socket: HttpSocket | null | undefined): void;
      _callPendingCallbacks(): void;
      $exchange: HttpExchange;
      [kServerResponseStatistics]?: object;
    }

    type ServerResponseConstructor = typeof ServerResponse;
  }
}

const kConstructed = Symbol("kConstructed");

// Bun only: http.createServer() with one of these serves TLS. Own enumerable ones count, which are what tls.Server gets.
function hasOwnTLSIdentity(options: $Node.HttpServerOptions) {
  const isOwn = Object.prototype.propertyIsEnumerable;
  return !!(
    (isOwn.$call(options, "pfx") && options.pfx) ||
    (isOwn.$call(options, "cert") && options.cert) ||
    (isOwn.$call(options, "key") && options.key) ||
    (isOwn.$call(options, "ca") && options.ca)
  );
}

function Server(
  this: $Node.HttpServer,
  options?: $Node.HttpServerOptions | RequestListener | null,
  callback?: RequestListener,
): void;
function Server(
  this: $Node.HttpServer,
  options?: $Node.HttpServerOptions | RequestListener | null,
  callback?: RequestListener,
) {
  if (!(this instanceof Server)) return new Server(options, callback);
  EventEmitter.$call(this);
  this.on("listening", setupConnectionsTracking);
  this.on("connection", connectionListener);

  this._handle = null;
  this._unref = false;
  this.timeout = 0;
  this.maxRequestsPerSocket = 0;
  defineMaxHeadersCount(this);
  defineHttpAllowHalfOpen(this);
  this[kInternalSocketData] = undefined;
  this[kTrackedConnections] = new Set();
  this[kHandedOffSockets] = new Set();
  this._connections = 0;
  this[kPendingDrainClose] = false;
  this[kPendingCloseGenerations] = new Set();
  this[kListenerGeneration] = undefined;
  // http.Server.call() on an existing https.Server keeps its TLS configuration, like Node.
  this[tlsSymbol] ??= null;
  this.noDelay = true;
  let isTLS = false;
  if (typeof options === "function") {
    callback = options;
    options = {};
  } else if (options == null) {
    options = {};
  } else {
    validateObject(options, "options");
    isTLS = (this[isTlsSymbol] && !this[tlsSymbol]) || hasOwnTLSIdentity(options);
  }

  storeHTTPOptions.$call(this, options);
  // Node's https.Server gives tls.Server, and so net.Server, a spread of the caller's object. Its http.Server reads net.Server's options by name.
  const transportOptions = this[isTlsSymbol] ? { ...options } : options;
  // Node's http.Server always allows half-open sockets. https.Server takes the option, like tls.Server.
  this.allowHalfOpen = this[isTlsSymbol] ? !!transportOptions.allowHalfOpen : true;
  // This tls.Server never listens. It validates the TLS options and owns the SecureContext, like the one Node's https.Server extends.
  if (isTLS) {
    const { ignoredByHttpsServer } = require("internal/tls");
    const tlsServer = (this[tlsSymbol] = new (require("node:tls").Server)({
      ...transportOptions,
      ...ignoredByHttpsServer,
    }));
    tlsServer.on("secureConnection", socket => this.emit("secureConnection", socket));
    tlsServer.on("tlsClientError", (err, socket) => this.emit("tlsClientError", err, socket));
    this.on("secureConnection", secureConnectionListener);
    this.on("tlsClientError", onTLSClientError);
  }
  // listen() asks for it, so a server whose TLS options threw can't listen in cleartext.
  this[kConstructed] = true;

  // Node passes it to net.Server, which applies it to every accepted socket, and from there to req and res.
  this[kHighWaterMark] = transportOptions.highWaterMark;
  this.highWaterMark = transportOptions.highWaterMark ?? getDefaultHighWaterMark();

  this[kUniqueHeaders] = parseUniqueHeadersOption(options.uniqueHeaders);

  // Like Node's net.Server, which stores the delay in seconds: https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L1850-L1882
  let keepAliveInitialDelay = transportOptions.keepAliveInitialDelay;
  if (keepAliveInitialDelay !== undefined) {
    validateNumber(keepAliveInitialDelay, "options.keepAliveInitialDelay");
    if (keepAliveInitialDelay < 0) keepAliveInitialDelay = 0;
  }
  this.keepAlive = Boolean(transportOptions.keepAlive);
  this.keepAliveInitialDelay = ~~(keepAliveInitialDelay! / 1000);

  if (callback) this.on("request", callback);
  return this;
}
$toClass(Server, "Server", EventEmitter);

// What net.ts's accept path and handshake handler read of a tls.Server. listen({ tls }) has the two certificate options only.
Object.defineProperties(Server.prototype, {
  _requestCert: {
    configurable: true,
    get(this: $Node.HttpServer) {
      const tlsServer = this[tlsSymbol];
      return tlsServer ? tlsServer._requestCert : this[kListenerGeneration]?.tls?.requestCert;
    },
  },
  _rejectUnauthorized: {
    configurable: true,
    get(this: $Node.HttpServer) {
      const tlsServer = this[tlsSymbol];
      return tlsServer ? tlsServer._rejectUnauthorized : this[kListenerGeneration]?.tls?.rejectUnauthorized;
    },
  },
  _handshakeTimeout: {
    configurable: true,
    get(this: $Node.HttpServer) {
      return this[tlsSymbol]?._handshakeTimeout ?? 120_000;
    },
  },
  _ALPNCallback: {
    configurable: true,
    get(this: $Node.HttpServer) {
      return this[tlsSymbol]?._ALPNCallback;
    },
  },
  _SNICallback: {
    configurable: true,
    get(this: $Node.HttpServer) {
      return this[tlsSymbol]?._SNICallback;
    },
  },
});

Object.defineProperty(Server.prototype, "listening", {
  __proto__: null,
  get(this: $Node.HttpServer) {
    return !!this[serverSymbol];
  },
  configurable: true,
  enumerable: true,
});

Server.prototype[kIncomingMessage] = undefined;

Server.prototype[kServerResponse] = undefined;

Server.prototype[kConnectionsCheckingInterval] = undefined;

Server.prototype[kClusterHandle] = undefined;

Server.prototype[kClusterListeningId] = 0;

function rethrowUncaught(err: unknown) {
  throw err;
}

// Like Node.js's setupConnectionsTracking: each 'listening' event replaces
// the connections-checking interval timer (used by the headers/request
// timeout machinery) and destroys the previous one.
function setupConnectionsTracking(this: $Node.HttpServer) {
  if (this[kConnectionsCheckingInterval]) {
    clearInterval(this[kConnectionsCheckingInterval]);
  }
  const delay = this.connectionsCheckingInterval ?? 30_000;
  this[kConnectionsCheckingInterval] = setInterval(checkConnections.bind(this), delay);
  this[kConnectionsCheckingInterval]!.unref();
  // Under `bun --hot`, a newer http.Server can take the native server before this 'listening' fires.
  if (lostListener(this)) releaseListener(this);
}

// Node.js's checkConnections sweep: every connectionsCheckingInterval, expire
// connections whose in-flight request exceeded headersTimeout/requestTimeout.
// The per-connection timing lives on the native socket handle (the parser is
// native), so each tracked connection is asked whether it expired.
function checkConnections(this: $Node.HttpServer) {
  const headersTimeout = this.headersTimeout;
  const requestTimeout = this.requestTimeout;
  const sweep = headersTimeout !== 0 || requestTimeout !== 0;

  // llhttp keeps the times of the connections it parses, uWS those of its own.
  const parsed = this[kConnections];
  if (sweep && parsed !== undefined) {
    const expired = parsed.expired(headersTimeout, requestTimeout);
    for (let i = 0; i < expired.length; i++) {
      const socket = expired[i].socket;
      if (socket) onRequestTimeout(socket);
    }
  }

  const connections = this[kTrackedConnections];
  if (!connections || connections.size === 0) {
    // Under `bun --hot`, a replaced server with no connections left has nothing to check.
    if (lostListener(this)) clearInterval(this[kConnectionsCheckingInterval]);
    return;
  }

  if (!sweep) {
    return;
  }

  for (const socket of connections) {
    const handle = socket[kHandle];
    if (handle?.isRequestTimedOut?.(headersTimeout, requestTimeout)) {
      ("unlikely");
      onRequestTimeout(socket);
    }
  }
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/_http_server.js (onRequestTimeout)
function onRequestTimeout(socket: $Node.HttpSocket) {
  socketOnError.$call(socket, $ERR_HTTP_REQUEST_TIMEOUT("Request timeout"));
}

Server.prototype.ref = function (this: $Node.HttpServer) {
  // Only what unref() let go of: a socket can have an unref() of the program's own.
  if (this._unref) for (const socket of this[kHandedOffSockets]) socket.ref();
  this._unref = false;
  this[serverSymbol]?.ref?.();
  return this;
};

Server.prototype.unref = function (this: $Node.HttpServer) {
  this._unref = true;
  this[serverSymbol]?.unref?.();
  for (const socket of this[kHandedOffSockets]) socket.unref();
  return this;
};

Server.prototype.closeAllConnections = function (this: $Node.HttpServer) {
  const parsed = this[kConnections];
  if (parsed !== undefined) {
    const connections = parsed.all();
    for (let i = 0, l = connections.length; i < l; i++) {
      connections[i].socket!.destroy();
    }
  }
  // Like Node, this skips the listener, sockets handed to 'connect' / 'upgrade' listeners, and TLS connections still in their handshake.
  const tracked = this[kTrackedConnections];
  if (tracked && tracked.size > 0) {
    for (const socket of $Array.from(tracked)) {
      destroyNow(socket);
    }
  }
};

// net.Socket's _destroy() calls this after it queued the socket's own 'close', so the immediate set here runs behind that. The one that stop()'s promise sets can run ahead: an idle connection that its peer or closeIdleConnections() closes emits 'close' after the server, as in Node.
Server.prototype._emitCloseIfDrained = function (this: $Node.HttpServer) {
  // This server has no 'close' listener on them, as in Node, so it forgets the closed ones now and then.
  const handedOff = this[kHandedOffSockets];
  if (handedOff.size > 2 * this._connections + 16) {
    for (const socket of handedOff) if (socket.destroyed) handedOff.delete(socket);
  }
  if (this._connections === 0 && this[kPendingDrainClose])
    queueMicrotask(emitCloseServerInImmediate.bind(undefined, this));
};
function emitCloseServerInImmediate(self: $Node.HttpServer) {
  setImmediate(emitCloseServer, self);
}

Server.prototype.getConnections = function (
  this: $Node.HttpServer,
  callback: (error: Error | null, count: number) => void,
) {
  // Connections are tracked from the moment they are accepted (the native
  // server surfaces accepts through the onConnection callback).
  const count = this._connections;
  if (typeof callback === "function") {
    process.nextTick(callback, null, count);
  }
  return this;
};

function closeIdleParsedConnections(server: $Node.HttpServer) {
  const parsed = server[kConnections];
  if (parsed === undefined) return;
  const connections = parsed.idle();
  for (let i = 0, l = connections.length; i < l; i++) {
    const socket = connections[i].socket!;
    if (socket._httpMessage && !socket._httpMessage.finished) continue;
    socket.destroy();
  }
}

function httpServerPreClose(server: $Node.HttpServer) {
  server.closeIdleConnections();
  clearInterval(server[kConnectionsCheckingInterval]);
}

Server.prototype.closeIdleConnections = function (this: $Node.HttpServer) {
  closeIdleParsedConnections(this);
  const server = this[serverSymbol];
  if (server) {
    server.closeIdleConnections();
    return;
  }
  const tracked = this[kTrackedConnections];
  if (tracked && tracked.size > 0) {
    for (const socket of $Array.from(tracked)) {
      // uWS knows whether a request is arriving on the connection. A missing _httpMessage does not tell.
      socket[kHandle]?.closeIfIdle();
    }
  }
};

Server.prototype.close = function (this: $Node.HttpServer, optionalCallback?: (error?: Error) => void) {
  const server = this[serverSymbol];
  // Node.js's httpServerPreClose clears the connections-checking interval
  // even when the server was never listening.
  clearInterval(this[kConnectionsCheckingInterval]);
  closeIdleParsedConnections(this);
  if (!isPrimary) {
    this[kClusterListeningId]++;
    const clusterHandle = this[kClusterHandle];
    if (clusterHandle) {
      this[kClusterHandle] = undefined;
      clusterHandle[kClusterOwner] = null;
      clusterHandle.close();
    }
  }
  if (!server) {
    // https://github.com/nodejs/node/blob/v26.5.0/lib/net.js#L2596-L2647
    if (typeof optionalCallback === "function") this.once("close", () => optionalCallback($ERR_SERVER_NOT_RUNNING()));
    if (this._connections === 0) process.nextTick(emitCloseNotRunning, this);
    return this;
  }
  if (typeof optionalCallback === "function") this.once("close", optionalCallback);
  const generation = this[kListenerGeneration];
  if (generation) this[kPendingCloseGenerations].add(generation);
  this[serverSymbol] = undefined;
  this._handle = null;
  this[kPendingDrainClose] = true;
  // Like Node, a connection that this sweep closes counts as gone, also a TLS one whose close ends later with the peer's close_notify.
  const swept = server.closeIdleConnections();
  if (generation) generation.drainedAtClose = this._connections === swept;
  if (nativeServerOwners !== undefined) {
    // Under `bun --hot`, stopping a shared native server also takes the listener away from its current http.Server.
    const owner = nativeServerOwners.get(server);
    if (owner != null && owner !== this) nativeServerOwners.set(server, null);
  }
  // stop() queues the task that emits 'close', which holds the loop one more turn, as node's uv_close() does.
  queueCloseNTServer(this, server.stop(), generation!);
  return this;
};

Server.prototype[EventEmitter.captureRejectionSymbol] = function (
  this: $Node.HttpServer,
  err: unknown,
  event: $Node.EventName,
  ...args: unknown[]
) {
  switch (event) {
    case "request": {
      const { 1: res } = args as [request: $Node.IncomingMessage, response: $Node.ServerResponse];
      if (!res.headersSent && !res.writableEnded) {
        // Don't leak headers.
        const names = res.getHeaderNames();
        for (let i = 0; i < names.length; i++) {
          res.removeHeader(names[i]);
        }
        res.statusCode = 500;
        res.end(STATUS_CODES[500]);
      } else {
        res.destroy();
      }
      break;
    }
    default:
      require("node:net").Server.prototype[EventEmitter.captureRejectionSymbol]!.$apply(this, arguments);
  }
};

Server.prototype[Symbol.asyncDispose] = function (this: $Node.HttpServer) {
  const { resolve, reject, promise } = Promise.withResolvers<void>();
  this.close(function (err?: Error, ...args: []) {
    if (err) {
      reject(err);
    } else resolve(...args);
  });
  return promise;
};

Server.prototype.address = function (this: $Node.HttpServer) {
  if (!this[serverSymbol]) return null;
  return this[serverSymbol].address;
};

Server.prototype.listen = function (this: $Node.HttpServer) {
  // Before anything is registered, like net.Server: https://github.com/nodejs/node/blob/v26.5.0/lib/net.js#L2270-L2272
  if (this[serverSymbol]) throw $ERR_SERVER_ALREADY_LISTEN();
  const server = this;
  let port: number | string | null | undefined, host: string | undefined;
  let socketPath: string | undefined;
  let fd: number | undefined;
  let reusePort = false;
  let ipv6Only = false;
  let exclusive = false;
  const tlsServer = this[tlsSymbol];
  // tls.Server's context for its own listener always has the server's verify mode. socket.authorized reads requestCert.
  let tls: $Node.HttpServerTLSOptions | null = tlsServer && {
    __proto__: null,
    secureContext: tlsServer[buntls](null)[0].secureContext,
    requestCert: tlsServer._requestCert === true,
    serverName: tlsServer.servername,
  };

  // This logic must align with:
  // - https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/net.js#L274-L307
  const argc = arguments.length;
  if (argc > 0) {
    const arg0 = arguments[0];
    if ($isObject(arg0)) {
      // (options[...][, cb])
      addServerAbortSignalOption(this, arg0);
      // `fd` wins over the rest: https://github.com/nodejs/node/blob/v26.5.0/lib/net.js#L2314-L2317
      const { fd: fdOption } = arg0;
      if (typeof fdOption === "number" && fdOption >= 0) {
        fd = fdOption;
      } else {
        if ("fd" in arg0 && !("port" in arg0 || "path" in arg0)) {
          throw $ERR_INVALID_ARG_VALUE("options", arg0, 'must have the property "port" or "path"');
        }
        port = arg0.port;
        host = arg0.host;
        socketPath = arg0.path;
        reusePort = arg0.reusePort === true;
        ipv6Only = arg0.ipv6Only === true;
        exclusive = reusePort || !!arg0.exclusive;
        // Like net.Server.listen(), an explicit `port: undefined` or `port: null` binds any free port.
        if ((port === undefined && "port" in arg0) || port === null) port = 0;
      }

      const otherTLS = arg0.tls;
      if ($isObject(otherTLS)) {
        tls = normalizeServerTls({ __proto__: null, ...otherTLS, secureContext: undefined });
      }
    } else if (typeof arg0 === "string" && !(Number(arg0) >= 0)) {
      // (path[...][, cb])
      socketPath = arg0;
    } else {
      // ([port][, host][...][, cb])
      port = arg0;
      if (argc > 1 && typeof arguments[1] === "string") {
        host = arguments[1];
      }
    }
  }

  // Bun defaults to port 3000.
  // Node defaults to port 0.
  if (port == null && !socketPath) {
    port = 0;
  }

  // A bad port throws and a valid one overrides `path`: https://github.com/nodejs/node/blob/v26.5.0/lib/net.js#L2332-L2334
  if (typeof port === "number" || typeof port === "string") {
    validatePort(port, "options.port");
    port = +port | 0;
    socketPath = undefined;
  } else if (socketPath) {
    // Like net.Server.listen(), listening on a `path` ignores `host`.
    host = undefined;
  }

  const lastArg = arguments[argc - 1];
  if ($isCallable(lastArg)) {
    // Before the bind, as in node, so a listen() retried from the 'error' handler still calls it.
    this.once("listening", lastArg);
  }

  try {
    // Windows has no descriptor to listen on. Node reports EINVAL there too.
    if (fd !== undefined && (fd !== (fd | 0) || process.platform === "win32")) {
      throw new ErrnoException(process.binding("uv").UV_EINVAL, "listen");
    }

    // listenInCluster

    if (isPrimary) {
      server[kRealListen](tls, port as number | undefined, host, socketPath, reusePort, ipv6Only, fd);
      return this;
    }

    if (cluster === undefined) cluster = loadChild();

    if (CAN_BE_CLUSTER_WORKER) {
      // SO_REUSEPORT can't share a unix socket or port 0, and a worker's `fd` names a descriptor of the primary.
      if (
        process.connected &&
        process.platform !== "win32" &&
        (fd !== undefined || (!exclusive && (socketPath || port === 0)))
      ) {
        listenInCluster(server, tls, port as number | undefined, host, socketPath, ipv6Only, fd);
        return this;
      }

      server[kClusterListeningId]++;
      server.once("listening", () => {
        // No channel (NODE_UNIQUE_ID inherited by a plain child, or already disconnected): nothing to notify.
        if (!process.connected) return;
        cluster!.worker!.state = "listening";
        const address = server.address();
        const isObjectAddress = address !== null && typeof address === "object";
        const boundHost = host && isObjectAddress ? address : null;
        const message = {
          cmd: "NODE_CLUSTER",
          act: "listening",
          port: socketPath ? -1 : (isObjectAddress && address.port) || port,
          data: null,
          address: socketPath ?? (boundHost && boundHost.address) ?? null,
          addressType: socketPath ? -1 : boundHost && boundHost.family === "IPv6" ? 6 : 4,
        };
        process.send!(message, undefined, kInternalSendOptions);
      });

      server[kRealListen](tls, port as number | undefined, host, socketPath, true, ipv6Only, fd);
      if (!exclusive) cluster!._trackServer(server);
    }
  } catch (err) {
    emitListenError(server, err, port as number | undefined, host, socketPath, fd);
  }

  return this;
};

// net.Server's listenInCluster, always `sharedOnly` like its TLS servers: Bun.serve can't take connections the primary accepted.
function listenInCluster(
  server: $Node.HttpServer,
  tls: $Node.HttpServerTLSOptions | null,
  port: number | undefined,
  host: string | undefined,
  socketPath: string | undefined,
  ipv6Only: boolean,
  fd: number | undefined,
) {
  const listeningId = ++server[kClusterListeningId];
  function query(address: string | null, queryPort: number | null | undefined, addressType: number | null) {
    const flags = ipv6Only ? 1 : 0;
    const serverQuery = { address, port: queryPort, addressType, fd, flags, sharedOnly: true, isHttp: true };
    cluster!._getServer(server, serverQuery, (errno, handle, reply) => {
      if (listeningId !== server[kClusterListeningId] || cluster!.worker!.exitedAfterDisconnect) {
        handle?.close();
        return;
      }
      if (errno) {
        const ex = new ExceptionWithHostPort(errno, "bind", address as string, queryPort as number);
        if (typeof reply?.bunHint === "string") ex.message += `\n  note: ${reply.bunHint}`;
        server.emit("error", ex);
        return;
      }
      server[kClusterHandle] = handle;
      handle[kClusterOwner] = server;
      try {
        server[kRealListen](tls, port, host, socketPath, false, false, handle.sharedFd);
        handle.adopted = true;
      } catch (err) {
        // Once Bun.serve() returned, the listener owns the descriptor and handle.close() must not close it again.
        handle.adopted = !!server[serverSymbol];
        server.close();
        emitListenError(server, err, port, host, socketPath, fd);
      }
    });
  }

  // The (address, port, addressType, fd) tuple keys the primary's handles, so it matches net.Server's.
  if (fd !== undefined) return query(null, null, null);
  if (socketPath) return query(socketPath, -1, -1);
  if (!host) return query(null, port, 4);
  // Bun.serve() takes "[::1]". The primary's bind() wants it bare.
  const address = host[0] === "[" ? host.slice(1, -1) : host;
  const addressType = isIP(address);
  if (addressType !== 0) return query(address, port, addressType);
  // https://github.com/nodejs/node/blob/v26.5.0/lib/net.js#L2434-L2452
  require("node:dns").lookup(address, (err, ip, family) => {
    if (listeningId !== server[kClusterListeningId]) return;
    if (err) server.emit("error", err);
    else query(ip as string, port, family === 6 ? 6 : 4);
  });
}

Server.prototype[kRealListen] = function (
  this: $Node.HttpServer,
  tls: $Node.HttpServerTLSOptions | null,
  port: number | string | undefined,
  host: string | undefined,
  socketPath: string | undefined,
  reusePort: boolean,
  ipv6Only: boolean,
  fd?: number,
) {
  {
    // What the first connection and the first request need, so that neither waits for it.
    loadNet(tls);
    // The constructor adds them for TLS options of its own. listen({ tls }) comes without.
    if (tls && this.listenerCount("secureConnection", secureConnectionListener) === 0) {
      this.prependListener("secureConnection", secureConnectionListener);
      this.prependListener("tlsClientError", onTLSClientError);
    }
    traceEvents ??= require("internal/trace_event_recorder");

    if (!this[kConstructed]) throw $ERR_INVALID_STATE("The server's constructor threw");
    const ResponseClass = this[kServerResponse]!;
    const RequestClass = this[kIncomingMessage]!;
    const canUseInternalAssignSocket = ResponseClass?.prototype.assignSocket === ServerResponse.prototype.assignSocket;
    let server = this;
    const usesOwnClasses =
      ResponseClass === ServerResponse &&
      RequestClass === IncomingMessage &&
      !$isProxyObject(this) &&
      this[kUniqueHeaders] == null &&
      !this[kOptimizeEmptyRequests];

    if (tls) {
      this.serverName = tls.serverName || host || "localhost";
    }
    const dispatchInFull = function onNodeHTTPRequest(
      url: string,
      method: string,
      // Native dispatch bitfield (kDispatch* in NodeHTTP.cpp): presence and token bits for the headers the dispatcher consults, so no header object or array is materialized unless user code reads them.
      dispatchBits: number,
      handle: $Node.NodeHTTPResponse,
      hasBody: boolean,
      socketHandle: $Node.NodeHTTPServerSocket,
      socket: $Node.HttpServerSocket,
      isAncientHTTP: boolean,
      connectHead?: Buffer,
      isPipelinedDispatch?: boolean,
    ) {
      if (isPipelinedDispatch) {
        // Holds this request's turn until its response exists, also when a throw prevents that.
        connectionState(socket).outgoing.push(kNoResponse);
        // For such a throw when no response is in flight whose 'finish' would come back to the queue.
        if (socket._httpMessage == null) process.nextTick(sendNextResponseIfIdle, socket);
      }

      // Like Node.js's resetSocketTimeout (parserOnIncoming): a new request
      // arriving on a kept-alive connection replaces the keep-alive idle
      // timeout with the server's regular per-socket timeout.
      if (socket[kKeepAliveTimeoutSet]) {
        socket[kKeepAliveTimeoutSet] = false;
        const serverTimeout = server.timeout;
        if (serverTimeout) {
          socket.setTimeout(serverTimeout);
        } else {
          // No regular per-socket timeout: leave the existing keep-alive
          // timer armed (instead of clear + re-allocate next finish).
          // onSocketTimeoutTimerExpired ignores it while kKeepAliveTimeoutSet
          // is false; the next response-finish refreshes it in place.
          socket.timeout = 0;
        }
      } else {
        // Request bytes are socket activity for the inactivity timeout.
        socket._unrefTimer();
      }

      const http_req: $Node.IncomingMessage = new RequestClass(kHandle, url, method, handle, hasBody, socket);
      if (isAncientHTTP) {
        http_req.httpVersion = "1.0";
        http_req.httpVersionMajor = 1;
        http_req.httpVersionMinor = 0;
      }
      // Pull the handful of headers the dispatcher consults out of
      // rawHeaders in one pass, instead of reading req.headers (each read
      // of which would force the lazy header-object build even when user
      // code never touches headers). Copy to locals before any callback
      // can re-enter the dispatcher.
      // HTTP/1.0 (ancient) responses never advertise keep-alive on this
      // server; otherwise honor a Connection: close token from the request.
      http_req[kReqShouldKeepAlive] = isAncientHTTP ? false : (dispatchBits & DISPATCH_CONN_CLOSE) === 0;
      if (server.joinDuplicateHeaders) {
        http_req.joinDuplicateHeaders = true;
      }
      let socketParser = socket.parser;
      if (socketParser == null) {
        socketParser = socket.parser = createServerParserShim(socket);
      }
      socketParser.incoming = http_req;
      if (socketParser[kParserOnTimeout] !== serverParserShimOnTimeout) {
        socketParser[kParserOnTimeout] = serverParserShimOnTimeout;
      }

      const isPipelined = !!isPipelinedDispatch;
      // Pipelined or not, like Node.js: nothing behind this request is parsed.
      if (method === "CONNECT") {
        if (server.listenerCount("connect") > 0) {
          // For CONNECT, emit the event and let the handler respond
          // Don't assign the socket to a response for CONNECT
          // The handler should write the raw response
          const head = connectHead ? connectHead : kEmptyBuffer;
          // Node.js's parserOnIncoming: req.upgrade is true for CONNECT regardless of shouldUpgradeCallback.
          http_req.upgrade = true;
          // llhttp completes a CONNECT request at the end of its head, before Node emits 'connect'.
          http_req.complete = true;
          handOffSocket(socket, http_req, isPipelined);
          if (isPipelined) {
            const { outgoing } = connectionState(socket);
            outgoing[outgoing.length - 1] = { handedOff: handle, destroyed: false, destroy() {} };
          }
          try {
            server.emit("connect", http_req, socket, head);
          } catch (err) {
            // Like 'upgrade' below. Native would end the pending response, here the one ahead.
            process.nextTick(rethrowUncaught, err);
          }
          return;
        } else {
          // Node.js will close the socket and will NOT respond with 400 Bad Request
          socketHandle.close();
        }
        return;
      }

      if (isPipelined) {
        // A response is still owed on this connection. This one waits for its turn on Node's path, which can hold what it writes.
        handle.onabort = socket[kBoundOnAbort] ??= onServerRequestEvent.bind(socket);
        if (hasBody) handle.ondata = onDataIncomingMessage.bind(http_req);
        const state = connectionState(socket);
        state.outgoing.pop(); // the turn held above
        drainMicrotasks();
        const waiting = state.outgoing.length;
        let completed = false;
        try {
          parserOnIncoming(server, socket, state, http_req, http_req[kReqShouldKeepAlive]!, dispatchBits);
          completed = true;
        } finally {
          const res = (socket._httpMessage?.req === http_req ? socket._httpMessage : state.outgoing[waiting]) as
            $Node.ServerResponse | undefined;
          if (completed) {
            // As for a request that didn't have to wait, the connection closes behind the 503.
            const limit = server.maxRequestsPerSocket!;
            if (limit > 0 && socket.requestsCount! > limit) res!._last = true;
          } else if (res === undefined) {
            state.outgoing.push(kNoResponse);
            if (socket._httpMessage == null) process.nextTick(sendNextResponseIfIdle, socket);
          } else if (res !== socket._httpMessage) {
            // It threw. Bun answers that with a close, at the response's turn unless it's complete by then.
            res[kDispatchThrew] = true;
          } else if (!res.finished) {
            closeBehindLastWrite(socket);
          }
        }
        if (!hasBody) completeWithoutBody(http_req, socket);
        return;
      }

      let http_res: $Node.ServerResponse;
      if (ResponseClass === ServerResponse && RequestClass === IncomingMessage) {
        http_res = new ResponseClass(
          http_req,
          kHandle,
          handle,
          socket,
          socket.writableHighWaterMark ?? getDefaultHighWaterMark(),
          server.rejectNonStandardBodyWrites ?? false,
          server.keepAliveTimeout,
          method !== "HEAD",
          !http_req[kReqShouldKeepAlive],
        );
        http_res[kSocket] = null;
        if (isAncientHTTP) {
          http_res.useChunkedEncodingByDefault = chunkExpression.test(
            (http_req.headers?.te as string | undefined) ?? "",
          );
          http_res.shouldKeepAlive = false;
        }
      } else {
        http_res = new ResponseClass(http_req, {
          [kHandle]: handle,
          highWaterMark: socket.writableHighWaterMark,
          rejectNonStandardBodyWrites: server.rejectNonStandardBodyWrites,
        });
        http_res._keepAliveTimeout = server.keepAliveTimeout;
        if (http_res.$exchange === undefined) adoptResponse(http_res);
      }
      // Only stamp the symbol when the server actually set `uniqueHeaders`:
      // unconditionally adding it (even as undefined) forced a hidden-class
      // transition on every ServerResponse, which measurably slowed every
      // later property access on it (renderNativeHeaders in particular).
      // parseUniqueHeadersOption yields null when the option is unset, so
      // test != null: stamping null would still shape-transition every
      // response for a value renderNativeHeaders treats as absent anyway.
      const uniqueHeaders = server[kUniqueHeaders];
      if (uniqueHeaders != null) http_res[kUniqueHeaders] = uniqueHeaders;

      // The request itself forbids connection reuse (HTTP/1.0, or the
      // client sent Connection: close): end the server's writable side as
      // soon as the response has been written, like Node.js's resOnFinish.
      // Registered before the 'request' event so the socket is already
      // ended inside user 'finish' listeners. (Not done for the
      // maxRequestsPerSocket limit - pipelined requests past the limit
      // still need to be answered with 503.)
      // One plain on() listener (once() allocates a wrapper, a second listener
      // deoptimizes every 'finish' emit), registered before the 'request' event
      // like Node's resOnFinish so res.on-replacing middleware cannot swallow it.
      if (ResponseClass !== ServerResponse || RequestClass !== IncomingMessage) {
        if (!http_req[kReqShouldKeepAlive]) http_res._last = true;
        http_res.on("finish", emitResponseFinish);
      }

      handle.onabort = socket[kBoundOnAbort] ??= onServerRequestEvent.bind(socket);
      // Like Node's connectionListener -> parserOnBody: body bytes flow into
      // the IncomingMessage as they arrive, and the push callback readStop()s
      // the socket (which emits 'pause' on it) once the buffer fills.
      if (hasBody) {
        handle.ondata = onDataIncomingMessage.bind(http_req);
      }
      drainMicrotasks();

      // Node.js (llhttp) only flags a request as an upgrade when it carries
      // both an Upgrade header and a Connection header with the "upgrade"
      // token; the server then consults shouldUpgradeCallback (default: an
      // 'upgrade' listener is installed) and otherwise dispatches the
      // request normally.
      let is_upgrade = false;
      if ((dispatchBits & DISPATCH_HAS_UPGRADE) !== 0 && (dispatchBits & DISPATCH_CONN_UPGRADE) !== 0) {
        // Like Node.js, shouldUpgradeCallback sees req.upgrade === true.
        http_req.upgrade = true;
        is_upgrade = !!server.shouldUpgradeCallback(http_req);
      }
      // Like Node.js's parserOnIncoming: req.upgrade is true inside the
      // 'upgrade' listener and false for a declined upgrade that falls
      // through to 'request'.
      http_req.upgrade = is_upgrade;
      if (!is_upgrade) {
        // Node.js's connectionListener registers socketOnClose, which frees
        // the parser - even a manually emitted 'close' stops parsing of any
        // pipelined requests still in the buffer.
        if (!socket[kStopParsingOnCloseListener]) {
          socket[kStopParsingOnCloseListener] = true;
          socket.on("close", onSocketCloseStopParsing);
        }
        if (canUseInternalAssignSocket) {
          // ~10% performance improvement in JavaScriptCore due to avoiding .once("close", ...) and removing a listener
          assignSocketInternal(http_res, socket);
        } else {
          http_res.assignSocket(socket);
        }
      }
      http_res.$exchange.awaitsClose = true;
      http_res[kCloseCallback] = onClose;
      if (!is_upgrade) observeRequest(http_req, http_res);

      // Like Node.js: with the optimizeEmptyRequests server option,
      // requests without body headers skip the Readable life cycle (no
      // 'data'/'end'/'close' events) and arrive pre-dumped.
      if (
        server[kOptimizeEmptyRequests] &&
        !is_upgrade &&
        (dispatchBits & (DISPATCH_HAS_CONTENT_LENGTH | DISPATCH_HAS_TRANSFER_ENCODING)) === 0
      ) {
        http_req._dumpAndCloseReadable();
      }

      // Node's parserOnIncoming never counts an accepted upgrade or a missing-Host 400 against maxRequestsPerSocket, and routes HTTP/1.1 only.
      const expectation =
        is_upgrade || isAncientHTTP ? kNoExpectation : expectationFromBits(server, http_res, socket, dispatchBits);

      if (expectation === kOverRequestsLimit) {
        emitRequest(server, socket, http_req, http_res, expectation);
        socket.destroy();
      } else if (is_upgrade) {
        // Like Node 26, a body is parsed and delivered through req. The connection leaves HTTP behind it, so the head is empty.
        if (hasBody) {
          socketHandle.leaveHttpAfterBody();
          handle.ondata = onUpgradeBodyData.bind(http_req);
          handle.notifyWhenReadParsed();
          return;
        }
        http_req.complete = true;
        handOffSocket(socket, http_req, false);
        const upgradeHead = !hasBody && connectHead ? connectHead : kEmptyBuffer;
        let upgradeHandled: boolean;
        try {
          upgradeHandled = server.emit("upgrade", http_req, socket, upgradeHead);
        } catch (err) {
          // A throwing 'upgrade' listener surfaces as an uncaught
          // exception, like Node.js (the emit happens outside any JS try
          // frame there).
          process.nextTick(rethrowUncaught, err);
          upgradeHandled = true;
        }
        if (!upgradeHandled) {
          // shouldUpgradeCallback accepted the upgrade but no 'upgrade'
          // listener is installed: Node.js destroys the socket.
          socket.destroy();
          return;
        }
        return;
      } else {
        emitRequest(server, socket, http_req, http_res, expectation);
      }

      if (!hasBody) completeWithoutBody(http_req, socket);

      if (handle.finished || !http_res.$exchange.awaitsClose) {
        handle = undefined!;
        // Set in time only because end() defers the 'finish' emit to a
        // process.nextTick (see ServerResponse.prototype.end) and nothing
        // between the 'request' emit and here drains the tick queue.
        http_res.$exchange.awaitsClose = false;
        http_res[kCloseCallback] = undefined;
        http_res.$exchange.detachedFrom = http_res[kDetachedFrom] = socket;
        http_res.detachSocket(socket);
        sendNextResponseIfAny(socket);
        return;
      }

      const pendingPromise: Promise<void> = $newPromise();
      http_res.$exchange.dispatchPromise = pendingPromise;
      return pendingPromise;
    };
    this[serverSymbol] = Bun.serve<any>({
      idleTimeout: 0, // nodejs dont have a idleTimeout by default
      tls: tls as any,
      port,
      hostname: host,
      unix: socketPath,
      fd,
      reusePort,
      ipv6Only,
      maxRequestBodySize: Number.MAX_SAFE_INTEGER,

      onNodeHTTPRequest(
        url: string,
        method: string,
        // Native dispatch bitfield (kDispatch* in NodeHTTP.cpp): presence and token bits for the headers the dispatcher consults, so no header object or array is materialized unless user code reads them.
        dispatchBits: number,
        handle: $Node.NodeHTTPResponse,
        hasBody: boolean,
        socketHandle: $Node.NodeHTTPServerSocket,
        isSocketNew: boolean,
        socket: $Node.HttpServerSocket,
        isAncientHTTP: boolean,
        connectHead?: Buffer,
        isPipelinedDispatch?: boolean,
      ) {
        if (
          usesOwnClasses &&
          !isAncientHTTP &&
          !socket._httpMessage &&
          socket._readableState === socket.$ownReadableState &&
          readsHighWaterMarksUnseen(socket) &&
          isPipelinedDispatch !== true &&
          (dispatchBits & DISPATCH_USUAL_MASK) === DISPATCH_HAS_HOST &&
          !server.joinDuplicateHeaders &&
          countsNoRequests(server) &&
          method !== "CONNECT" &&
          !hasObserver("http") &&
          !traceEvents.isCategoryGroupEnabled(kHttpTraceCat) &&
          (socket.$isPrepared || prepareSocket(socket))
        ) {
          return onNodeHTTPRequest(server, url, method, handle, socket, hasBody);
        }
        return dispatchInFull(
          url,
          method,
          dispatchBits,
          handle,
          hasBody,
          socketHandle,
          socket,
          isAncientHTTP,
          connectHead,
          isPipelinedDispatch,
        );
      },
    });

    const handle = this[serverSymbol]!;
    // supertest only closes its server when `_handle` is set.
    this._handle = handle;
    this[kListenerGeneration] = {
      server: this,
      isUnix: !!socketPath || (fd !== undefined && handle.address === null),
      tls,
      nativeClosed: false,
      drainedAtClose: false,
      // The async context of listen(), until close().
      frame: $getInternalField($asyncContext, 0),
    };
    applyServerCustomOptions(this);
    // Only `bun --hot` sets an id. The next listen() on this address reuses this native server.
    if (handle.id !== "") {
      const owners = (nativeServerOwners ??= new (require("internal/primordials").SafeWeakMap)());
      const previous = owners.get(handle);
      owners.set(handle, this);
      if (previous != null) releaseListener(previous);
    }
    const tlsServer = this[tlsSymbol];
    if (tlsServer) {
      for (const { 0: hostname, 1: context } of tlsServer[kSNIContexts]) {
        addServerName(handle, hostname, context.context);
      }
    }

    if (this._unref) handle.unref();

    // A tick, not a timer, as in node: a timer never fires on its own under jest.useFakeTimers().
    process.nextTick(emitListeningNextTick, this, handle.hostname, handle.port);
  }
};

// Whether isOverRequestsLimit() would leave the request uncounted.
function countsNoRequests(server: $Node.HttpServer): boolean {
  const maxRequestsPerSocket = server.maxRequestsPerSocket;
  return typeof maxRequestsPerSocket !== "number" || maxRequestsPerSocket <= 0;
}

function prepareSocket(socket: $Node.HttpServerSocket): boolean {
  if (socket[kHandedOff] || socket[kHandle] === undefined) return false;
  if (socket.parser == null) socket.parser = createServerParserShim(socket);
  if (socket[kBoundOnAbort] == null) socket[kBoundOnAbort] = onServerRequestEvent.bind(socket);
  if (!socket[kStopParsingOnCloseListener]) {
    socket[kStopParsingOnCloseListener] = true;
    socket.on("close", onSocketCloseStopParsing);
  }
  socket.$isPrepared = true;
  return true;
}

// A function that stands in for one of the full road has that one's name, which is what a stack trace shows.
function onNodeHTTPRequest(
  server: $Node.HttpServer,
  url: string,
  method: string,
  handle: $Node.NodeHTTPResponse,
  socket: $Node.HttpServerSocket,
  hasBody: boolean,
): Promise<void> | undefined {
  if (socket[kKeepAliveTimeoutSet]) {
    socket[kKeepAliveTimeoutSet] = false;
    const serverTimeout = server.timeout;
    if (serverTimeout) {
      ("unlikely");
      socket.setTimeout(serverTimeout);
    } else socket.timeout = 0;
  } else {
    socket._unrefTimer();
  }

  const req: $Node.IncomingMessage = new IncomingMessage(
    kHandle,
    url,
    method,
    handle,
    hasBody,
    socket,
    socket._readableState.highWaterMark,
  );
  let parser = socket.parser;
  if (parser == null) parser = socket.parser = createServerParserShim(socket);
  parser.incoming = req;
  if (parser[kParserOnTimeout] !== serverParserShimOnTimeout) parser[kParserOnTimeout] = serverParserShimOnTimeout;

  const res: $Node.ServerResponse = new ServerResponse(
    req,
    kHandle,
    handle,
    socket,
    socket._writableState.highWaterMark,
    server.rejectNonStandardBodyWrites ?? false,
    server.keepAliveTimeout,
    method !== "HEAD",
  );
  handle.onabort = socket[kBoundOnAbort]!;
  if (hasBody) handle.ondata = onDataIncomingMessage.bind(req);
  socket._httpMessage = res;
  socket[kCloseCallback] = onServerResponseClose;
  const exchange = res.$exchange;
  exchange.awaitsClose = true;
  res[fakeSocketSymbol] = socket;
  res[kCloseCallback] = onClose;
  if (!emitsUnseen(res)) {
    ("unlikely");
    res.emit("socket", socket);
  }

  emitRequest(server, socket, req, res, kNoExpectation);

  if (!hasBody) completeWithoutBody(req, socket);

  if (
    (exchange.flags & EXCHANGE_ENDED_CLEAN) !== 0 &&
    !res.destroyed &&
    detachesItself(res) &&
    removesListenersUnseen(socket) &&
    readsItsEndUnseen(socket)
  ) {
    exchange.awaitsClose = false;
    let takesStores = true;
    try {
      res[kCloseCallback] = undefined;
      exchange.detachedFrom = res[kDetachedFrom] = socket;
      if (socket._httpMessage === res) {
        socket[kCloseCallback] = undefined;
        socket._httpMessage = null;
      }
      res[fakeSocketSymbol] = undefined;
      res[kSocket] = null;
    } catch {
      // One of the two takes no stores. The same stores again, from the functions of the full road.
      takesStores = false;
    }
    if (takesStores) {
      if (socket[kConnectionState] !== undefined) sendNextResponseIfAny(socket);
      return undefined;
    }
  } else if (
    exchange.awaitsClose &&
    !(
      (res.finished ||
        res.destroyed ||
        socket[kHandle] === undefined ||
        (exchange.flags & EXCHANGE_HAS_STAND_IN) !== 0) &&
      handle.finished
    )
  ) {
    return (exchange.dispatchPromise = $newPromise());
  }
  exchange.awaitsClose = false;
  res[kCloseCallback] = undefined;
  exchange.detachedFrom = res[kDetachedFrom] = socket;
  res.detachSocket(socket);
  sendNextResponseIfAny(socket);
  return undefined;
}

// Pushes the per-server parser/handler options down to the native listener.
function applyServerCustomOptions(server: $Node.HttpServer) {
  const handle = server[serverSymbol];
  if (!handle) return;
  setServerCustomOptions(
    handle,
    serverLenientFlags(server),
    !!server.httpAllowHalfOpen,
    typeof server.maxHeaderSize !== "undefined" ? server.maxHeaderSize : getMaxHTTPHeaderSize(),
    onServerClientError.bind(server, server[kListenerGeneration]!),
  );
  setServerMaxHeadersCount(handle, nativeMaxHeadersCount(server.maxHeadersCount));
  const SocketClass = server[kListenerGeneration]!.tls ? TLSConnection : NetConnection;
  const { 0: handlers, 1: data } = require("node:net").Server.prototype[kForeignListener].$call(server, SocketClass);
  // The native side keeps the async context it's called in for every handler. What a socket emits runs in nobody's AsyncLocalStorage store, as in Node.
  const frame = AsyncContextFrame.current();
  const socketFrame = AsyncContextFrame.currentGraphFrame();
  AsyncContextFrame.run(
    socketFrame,
    setBunServerSocketHandlers,
    undefined,
    handle,
    frame === socketFrame ? handlers : withServerEventsIn(frame, handlers),
    server[tlsSymbol]?.ALPNProtocols ?? kEmptyBuffer,
    data,
  );
}

// 'connection', 'secureConnection', 'keylog' and the TLS callbacks are the server's: they run in the context of listen().
function withServerEventsIn(frame: Frame, handlers: Record<string, ((...args: unknown[]) => unknown) | undefined>) {
  const table = { ...handlers };
  for (const name of ["open", "handshake", "keylog", "serverName", "alpnCallback"]) {
    const handler = handlers[name];
    if (handler) table[name] = (...args: unknown[]) => AsyncContextFrame.run(frame, handler, undefined, ...args);
  }
  return table;
}

// Returns true if, under `bun --hot`, the native server now dispatches to another http.Server or was stopped by one.
function lostListener(server: $Node.HttpServer) {
  if (nativeServerOwners === undefined) return false;
  const owner = nativeServerOwners.get(server[serverSymbol]!);
  return owner !== undefined && owner !== server;
}

// A replaced server keeps its timeout sweep only while it still has connections.
function releaseListener(server: $Node.HttpServer) {
  if (server[kTrackedConnections].size === 0) clearInterval(server[kConnectionsCheckingInterval]);
}

// Resolution: httpValidation > explicit insecureHTTPParser > --insecure-http-parser. Native
// implements two llhttp lenient bits: bit 0 = LENIENT_HEADERS ("relaxed" gets this only),
// bit 1 = LENIENT_TRANSFER_ENCODING (kLenientAll / "insecure" gets both).
function serverLenientFlags(server: $Node.HttpServer) {
  const lenient = calculateLenientFlags(server.httpValidation, server.insecureHTTPParser);
  if (lenient === HTTPParser.kLenientNone) return 0;
  return lenient === HTTPParser.kLenientAll ? 0b11 : 0b01;
}

function httpAllowHalfOpenGet(this: $Node.HttpServer) {
  return this[kHttpAllowHalfOpen];
}

// Node reads server.httpAllowHalfOpen at the peer's FIN, so an assignment after listen() must reach the native listener: push the flags alone, not the callbacks.
function httpAllowHalfOpenSet(this: $Node.HttpServer, value: boolean) {
  const previous = !!this[kHttpAllowHalfOpen];
  this[kHttpAllowHalfOpen] = value;
  const next = !!value;
  if (previous === next) return;
  const handle = this[serverSymbol];
  if (handle) setServerAppFlags(handle, serverLenientFlags(this), next);
}

// Node.js keeps httpAllowHalfOpen as an own enumerable property of the server.
function defineHttpAllowHalfOpen(server: $Node.HttpServer) {
  server[kHttpAllowHalfOpen] = false;
  Object.defineProperty(server, "httpAllowHalfOpen", {
    configurable: true,
    enumerable: true,
    get: httpAllowHalfOpenGet,
    set: httpAllowHalfOpenSet,
  });
}

// Node's int32 `maxHeadersCount << 1`, as a field count; 0 is no limit: https://github.com/nodejs/node/blob/v26.5.1/lib/_http_server.js#L795-L797
function nativeMaxHeadersCount(maxHeadersCount: number | null) {
  if (typeof maxHeadersCount !== "number") return 0;
  const maxHeaderPairs = maxHeadersCount << 1;
  return maxHeaderPairs > 0 ? maxHeaderPairs >>> 1 : 0;
}

function maxHeadersCountGet(this: $Node.HttpServer) {
  return this[kMaxHeadersCount];
}

// Node reads `server.maxHeadersCount` for every new connection, so a value assigned after listen() goes to the native parser.
function maxHeadersCountSet(this: $Node.HttpServer, value: number | null) {
  this[kMaxHeadersCount] = value;
  const handle = this[serverSymbol];
  if (handle) setServerMaxHeadersCount(handle, nativeMaxHeadersCount(value));
}

// Node.js keeps maxHeadersCount as an own enumerable property of the server.
function defineMaxHeadersCount(server: $Node.HttpServer) {
  server[kMaxHeadersCount] = null;
  Object.defineProperty(server, "maxHeadersCount", {
    configurable: true,
    enumerable: true,
    get: maxHeadersCountGet,
    set: maxHeadersCountSet,
  });
}

// Like Node.js: server.setTimeout only records the per-socket inactivity
// timeout (and an optional 'timeout' listener); it is applied to each
// connection when it is established, via socket.setTimeout.
Server.prototype.setTimeout = function (
  this: $Node.HttpServer,
  msecs: number,
  callback?: (socket: $Node.HttpSocket) => void,
) {
  this.timeout = msecs;
  if (typeof callback === "function") this.on("timeout", callback);
  return this;
};

function onServerRequestEvent(this: $Node.HttpServerSocket, event: NodeHTTPResponseAbortEvent) {
  const socket = this;
  switch (event) {
    case NodeHTTPResponseAbortEvent.abort:
      // The socket's own handle hears the close right behind this, with how it closed.
      break;
    case NodeHTTPResponseAbortEvent.timeout: {
      socket.emit("timeout");
      break;
    }
  }
}
// uWS::HttpParserError
enum HttpParserError {
  HTTP_PARSER_ERROR_NONE = 0,
  HTTP_PARSER_ERROR_INVALID_CHUNKED_ENCODING = 1,
  HTTP_PARSER_ERROR_INVALID_CONTENT_LENGTH = 2,
  HTTP_PARSER_ERROR_INVALID_TRANSFER_ENCODING = 3,
  HTTP_PARSER_ERROR_INVALID_REQUEST = 5,
  HTTP_PARSER_ERROR_REQUEST_HEADER_FIELDS_TOO_LARGE = 6,
  HTTP_PARSER_ERROR_INVALID_HTTP_VERSION = 7,
  HTTP_PARSER_ERROR_INVALID_EOF = 8,
  HTTP_PARSER_ERROR_INVALID_METHOD = 9,
  HTTP_PARSER_ERROR_INVALID_HEADER_TOKEN = 10,
  HTTP_PARSER_ERROR_LF_EXPECTED = 11,
  HTTP_PARSER_ERROR_CHUNK_EXTENSIONS_OVERFLOW = 12,
  HTTP_PARSER_ERROR_PAUSED_H2_UPGRADE = 13,
  HTTP_PARSER_ERROR_CLOSED_CONNECTION = 14,
  HTTP_PARSER_ERROR_TRAILER_FIELDS_TOO_LARGE = 15,
  HTTP_PARSER_ERROR_CHUNK_TERMINATOR_EXPECTED = 16,
  HTTP_PARSER_ERROR_TRAILER_CONTENT_LENGTH = 17,
  HTTP_PARSER_ERROR_INVALID_URL = 18,
  HTTP_PARSER_ERROR_EMPTY_CONTENT_LENGTH = 19,
  HTTP_PARSER_ERROR_CONTENT_LENGTH_OVERFLOW = 20,
  HTTP_PARSER_ERROR_DUPLICATE_CONTENT_LENGTH = 21,
}
// Native callback fired when the HTTP parser rejects incoming bytes. Builds
// the same error object Node's parser produces and routes it through
// socketOnError, exactly like Node's onParserExecuteCommon: the server's
// 'clientError' listener (or the default handler) decides what to write back
// and when to destroy the connection.
function onServerClientError(
  this: $Node.HttpServer,
  listenerGeneration: ListenerGeneration,
  socket: $Node.NodeHTTPServerSocket,
  errorCode: number,
  rawPacket: ArrayBuffer,
) {
  const nodeSocket = socket.duplex!;

  let err;
  switch (errorCode) {
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_CHUNKED_ENCODING:
      err = $HPE_INVALID_CHUNK_SIZE("Parse Error: Invalid character in chunk size");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_CONTENT_LENGTH:
      err = $HPE_INVALID_CONTENT_LENGTH("Parse Error: Invalid character in Content-Length");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_EMPTY_CONTENT_LENGTH:
      err = $HPE_INVALID_CONTENT_LENGTH("Parse Error: Empty Content-Length");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_CONTENT_LENGTH_OVERFLOW:
      err = $HPE_INVALID_CONTENT_LENGTH("Parse Error: Content-Length overflow");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_DUPLICATE_CONTENT_LENGTH:
      err = $HPE_UNEXPECTED_CONTENT_LENGTH("Parse Error: Duplicate Content-Length");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_TRANSFER_ENCODING:
      err = $HPE_INVALID_TRANSFER_ENCODING("Parse Error: Request has invalid `Transfer-Encoding`");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_TRAILER_CONTENT_LENGTH:
      err = $HPE_INVALID_CONTENT_LENGTH("Parse Error: Content-Length can't be present with Transfer-Encoding");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_REQUEST:
      err = $HPE_INVALID_CONSTANT("Parse Error: Expected HTTP/");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_EOF:
      err = $HPE_INVALID_EOF_STATE("Parse Error: Invalid EOF state");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_METHOD:
      err = $HPE_INVALID_METHOD("Parse Error: Invalid method encountered");
      err.bytesParsed = 1; // always 1 for now because is the first byte of the request line
      break;
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_HEADER_TOKEN:
      err = $HPE_INVALID_HEADER_TOKEN("Parse Error: Invalid header token encountered");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_REQUEST_HEADER_FIELDS_TOO_LARGE:
    case HttpParserError.HTTP_PARSER_ERROR_TRAILER_FIELDS_TOO_LARGE:
      err = $HPE_HEADER_OVERFLOW("Parse Error: Header overflow");
      err.bytesParsed = rawPacket.byteLength;
      break;
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_HTTP_VERSION:
      err = $HPE_INVALID_VERSION("Parse Error: Invalid HTTP version");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_LF_EXPECTED:
      err = $HPE_LF_EXPECTED("Parse Error: Missing expected LF after header value");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_CHUNK_EXTENSIONS_OVERFLOW:
      err = $HPE_CHUNK_EXTENSIONS_OVERFLOW("Parse Error: Chunk extensions overflow");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_PAUSED_H2_UPGRADE:
      err = $HPE_PAUSED_H2_UPGRADE("Parse Error: Pause on PRI/Upgrade");
      err.bytesParsed = 24;
      break;
    case HttpParserError.HTTP_PARSER_ERROR_CLOSED_CONNECTION:
      err = $HPE_CLOSED_CONNECTION("Parse Error: Data after `Connection: close`");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_CHUNK_TERMINATOR_EXPECTED:
      err = $HPE_STRICT("Parse Error: Expected LF after chunk data");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_URL:
      err = $HPE_INVALID_URL("Parse Error: Invalid characters in url");
      break;
    default:
      err = $HPE_INTERNAL("Parse Error");
      break;
  }
  // Node builds the message as `Parse Error: ${reason}`.
  err.reason = err.message.slice("Parse Error: ".length);
  err.rawPacket = Buffer.from(rawPacket);
  socketOnError.$call(nodeSocket, err);
}

// Node.js hands the connection over to 'connect'/'upgrade' listeners with the
// connection-listener set removed (onParserExecuteCommon removes its data/end/
// close/drain/error/timeout listeners) and only net.Socket's own 'end' listener
// left in place.
const kHandedOffSockets = Symbol("kHandedOffSockets");
function detachFromHttp(socket: $Node.HttpServerSocket, req: $Node.IncomingMessage) {
  socket[kHandedOff] = true;
  socket.$isPrepared = false;
  socket.removeListener("error", socketOnError);
  socket.removeListener("timeout", socketOnTimeout);
  socket.removeListener("close", nativeSocketOnClose);
  socket.removeListener("close", onSocketCloseStopParsing);
  socket.removeListener("end", nativeSocketOnEnd);
  socket.removeListener("pause", onSocketPause);
  socket.removeListener("resume", nativeSocketOnResume);
  socket.removeListener("data", noopOnData);
  delete (socket as any)._onTimeout;
  // Only that function ignores the keep-alive timer, which stays armed while a request is in flight.
  if (socket.timeout === 0) socket.setTimeout(0);
  delete (socket as any)._final;
  delete (socket as any)._destroy;
  const server = socket.server as unknown as $Node.HttpServer;
  server[kTrackedConnections].delete(socket);
  // In Node each socket holds the process itself. Here unref() on the server has always let go of these sockets too.
  server[kHandedOffSockets].add(socket);
  if (server._unref) socket.unref();
  socket[kHandleClosed] = destroyUnreadSocket;
  // Like Node's onParserExecuteCommon: a flowing socket would drop bytes that arrive before the listener attaches a reader.
  socket.readableFlowing = null;
  // A pause of the HTTP phase ends with it. net.Socket has had a read pending since the accept, so no _read() would lift it.
  socket._handle?.resume();
  // Node frees the parser before it emits 'upgrade' or 'connect'.
  releaseServerParserShim(socket, req);
  // A 'close' listener of a WebSocket logs the peer's address, and net.Socket only keeps one that was read while the socket was open.
  socket._getpeername();
}
// A socket whose connection has closed closes too, also with bytes that nobody reads. Node keeps those for a reader.
function destroyUnreadSocket(this: $Node.HttpServerSocket) {
  if (this.readableLength > 0 && !this.readableFlowing) this.destroy();
}
function handOffSocket(socket: $Node.HttpServerSocket, req: $Node.IncomingMessage, isPipelined: boolean) {
  detachFromHttp(socket, req);
  const http = socket[kHandle]!;
  if (isPipelined) {
    // Responses ahead of this request are still owed. Until its turn the socket reads and writes through uWS.
    http.detachParser();
  } else if (http.leaveHttp(true)) {
    socket[kHandle] = undefined;
  }
}
// ws.handleUpgrade() while uWS still owns the connection: from a 'request' listener, or before the body of the Upgrade request has ended.
Server.prototype[kLeaveHttp] = function (
  this: $Node.HttpServer,
  socket: $Node.HttpServerSocket,
  req: $Node.IncomingMessage | null | undefined,
) {
  const http = socket[kHandle];
  if (http === undefined) return;
  // A framework's own request object stands for the request that is being answered.
  if (req![kHandle] === undefined) req = socket.parser?.incoming ?? socket[kUpgradeStream]?.[kIncomingMessage];
  // A request that waits behind other responses doesn't own the connection.
  if (req == null || http.response !== req[kHandle]) return;
  const res = socket._httpMessage;
  // What a paused request left in native code is its body, not the WebSocket's frames.
  req[kHandle]!.resume();
  if (socket[kHandle] === undefined) return;
  if (!socket[kHandedOff]) detachFromHttp(socket, req);
  if (!http.leaveHttp(false)) return;
  socket[kHandle] = undefined;
  socket[kUpgradeStream] = undefined;
  res?.detachSocket(socket);
  // A reader that waits for the rest of the body gets 'end', like in Node 25 and older.
  if (!req.complete) onDataIncomingMessage.$call(req, undefined, true, NodeHTTPResponseAbortEvent.none as number);
};
// The body of an accepted Upgrade request. Node parses the whole read before it emits 'upgrade': onConnectionClosed() emits it for a body that came with its head.
function onUpgradeBodyData(this: $Node.IncomingMessage, chunk: Buffer | undefined, isLast: boolean, event: number) {
  const socket = this.socket as $Node.HttpServerSocket;
  if (event === NodeHTTPResponseAbortEvent.readParsed) {
    if (!socket[kHandedOff]) emitUpgrade(socket, this, false);
    return;
  }
  if (isLast && !socket[kHandedOff]) socket[kUpgradeRequest] = this;
  onDataIncomingMessage.$call(this, chunk, isLast, event);
}
// On a socket: the Upgrade request whose body ended in the read that brought its head, until 'upgrade' is emitted.
const kUpgradeRequest = Symbol("kUpgradeRequest");
function emitUpgrade(socket: $Node.HttpServerSocket, req: $Node.IncomingMessage, complete: boolean) {
  if (socket.destroyed) return;
  const server = socket.server as unknown as $Node.HttpServer;
  detachFromHttp(socket, req);
  let stream: $Node.Duplex = socket;
  if (!complete) {
    // Node's socketOnEnd stays on the socket until the body has ended.
    socket.on("end", socket.end);
    stream = socket[kUpgradeStream] = new UpgradeStream(socket, req);
    // The stream destroyer (a `for await` that is left early) clears req.socket.
    req.once("close", onUpgradeRequestClose.bind(socket));
  }
  try {
    if (!server.emit("upgrade", req, stream, kEmptyBuffer)) socket.destroy();
  } catch (err) {
    process.nextTick(rethrowUncaught, err);
  }
}
function onUpgradeRequestClose(this: $Node.HttpServerSocket) {
  this[kUpgradeStream]?.requestBodyCompleted();
}
// Per-socket cached bound abort handler (the socket outlives its requests).
const kBoundOnAbort = Symbol("kBoundOnAbort");
// The timers' clock at the last response write or finish. Rescheduling the socket timer each time is slow, so onSocketTimeoutTimerExpired moves the deadline instead.
const kLastResponseWrite = Symbol("lastResponseWrite");
const kStopParsingOnCloseListener = Symbol("kStopParsingOnCloseListener");

// https://github.com/nodejs/node/blob/v26.3.0/lib/_http_server.js (socketOnError)
const badRequestResponse = Buffer.from(`HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n`, "latin1");
const requestTimeoutResponse = Buffer.from(`HTTP/1.1 408 Request Timeout\r\nConnection: close\r\n\r\n`, "latin1");
const requestHeaderFieldsTooLargeResponse = Buffer.from(
  `HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n`,
  "latin1",
);
const requestChunkExtensionsTooLargeResponse = Buffer.from(
  `HTTP/1.1 413 Payload Too Large\r\nConnection: close\r\n\r\n`,
  "latin1",
);

// Default 'error' listener installed on every server connection, like
// Node.js's socketOnError: route the error to the server's 'clientError'
// event and, when nothing handles it, answer with a raw error response (only
// if nothing has been written for the in-flight response yet) and destroy the
// connection.
function socketOnError(this: $Node.HttpSocket, err: Error) {
  // Ignore further errors
  this.removeListener("error", socketOnError);
  // A 'clientError' listener can keep the connection open, and a later parse error calls this again.
  if (this.listenerCount("error", noopOnError) === 0) this.on("error", noopOnError);

  const server = this.server;
  if (!server || !server.emit("clientError", err, this)) {
    // Caution must be taken to avoid corrupting the remote peer.
    // Reply an error segment if there is no in-flight `ServerResponse`,
    // or no data of the in-flight one has been written yet to this socket.
    const message = this._httpMessage;
    // Node checks _headerSent (bytes reached the socket), not headersSent
    // (writeHead called): after res.writeHead() but before write/end/flush,
    // no bytes are on the wire yet so the raw error response is still safe.
    if (this.writable && (!message || !message._headerSent)) {
      let response: Buffer;
      switch (err?.code) {
        case "HPE_HEADER_OVERFLOW":
          response = requestHeaderFieldsTooLargeResponse;
          break;
        case "HPE_CHUNK_EXTENSIONS_OVERFLOW":
          response = requestChunkExtensionsTooLargeResponse;
          break;
        case "ERR_HTTP_REQUEST_TIMEOUT":
          response = requestTimeoutResponse;
          break;
        default:
          response = badRequestResponse;
          break;
      }
      this.write(response);
    }
    this.destroy(err);
  }
}
function noopOnError() {}

// From here to onSocketResume(), Node's connection listener over any Duplex: https://github.com/nodejs/node/blob/v26.5.0/lib/_http_server.js#L763-L1413
function connectionListenerInternal(server: $Node.HttpServer, socket: $Node.HttpSocket) {
  socket.server = server;

  const { timeout } = server;
  if (timeout && typeof socket.setTimeout === "function") socket.setTimeout(timeout);
  socket.on("timeout", socketOnTimeout);

  const parser: $Node.HTTPParser = parsers.alloc();

  const lenientFlags = calculateLenientFlags(server.httpValidation, server.insecureHTTPParser);

  // Node makes the list at 'listening'. A server that never listens tracks its connections too.
  const connections = (server[kConnections] ??= new ConnectionsList());
  parser.initialize(HTTPParser.REQUEST, {}, server.maxHeaderSize || 0, lenientFlags, connections);
  parser.socket = socket;
  socket.parser = parser;

  // Propagate headers limit from server instance to parser
  const { maxHeadersCount } = server;
  if (typeof maxHeadersCount === "number") {
    parser.maxHeaderPairs = maxHeadersCount << 1;
  }

  const state: ConnectionState = {
    onData: null,
    onEnd: null,
    onClose: null,
    onDrain: null,
    outgoing: [],
    incoming: [],
    // About how many bytes the responses in `outgoing` hold. Above the high water mark, the socket and the parser pause.
    outgoingData: 0,
    onPendingData: undefined,
    // Node's parser is an AsyncResource made here, so its callbacks run in this context whatever delivers the bytes.
    frame: AsyncContextFrame.current(),
  };
  state.onData = socketOnData.bind(undefined, server, socket, parser, state);
  state.onEnd = socketOnEnd.bind(undefined, server, socket, parser, state);
  state.onClose = socketOnClose.bind(undefined, socket, state);
  state.onDrain = socketOnDrain.bind(undefined, socket, state);
  socket.on("data", state.onData);
  socket.on("error", socketOnError);
  socket.on("end", state.onEnd);
  socket.on("close", state.onClose);
  socket.on("drain", state.onDrain);
  parser.onIncoming = parserOnIncoming.bind(undefined, server, socket, state);

  socket.on("resume", onSocketResume);
  socket.setEncoding = socketSetEncoding;

  socket._paused = false;
  // Only the event loop feeds a socket that reads a descriptor, so no tick can hand the parser more bytes in the middle of a read.
  parser._consumed = (socket as any)._handle?.fd >= 0;
  // Node's parser reads from the handle, so a pause() by the socket's previous owner doesn't stop it.
  socket.resume();
  process.nextTick(readStartAfterAttach, socket);
}

// Nor does a pause() by a 'connection' listener behind ours: in Node the 'resume' event of that call starts the handle's reads. Bytes that were put back may have reached a listener by now, whose pause() stays: 'request' (incoming is set), 'upgrade' or 'connect' (no parser).
function readStartAfterAttach(socket: $Node.HttpSocket) {
  if (socket.parser?.incoming === null) readStart(socket);
}

function socketSetEncoding(): never {
  throw $ERR_HTTP_SOCKET_ENCODING();
}

function updateOutgoingData(socket: $Node.HttpSocket, state: ConnectionState, delta: number) {
  state.outgoingData += delta;
  socketOnDrain(socket, state);
}

function socketOnDrain(socket: $Node.HttpSocket, state: ConnectionState) {
  const needPause = state.outgoingData > socket.writableHighWaterMark;

  // If we previously paused, then start reading again.
  if (socket._paused && !needPause) {
    socket._paused = false;
    socket.parser?.resume();
    socket.resume();
  }

  const msg = socket._httpMessage;
  // _flushOutput() calls this through updateOutgoingData() with its bytes still in the socket. Then 'drain' waits for the socket's own.
  if (msg && !msg.finished && msg[kNeedDrain] && msg.writableLength === 0) {
    msg[kNeedDrain] = false;
    msg.emit("drain");
  }
}

function socketOnClose(socket: $Node.HttpSocket, state: ConnectionState) {
  freeParser(socket.parser as $Node.HTTPParser | null | undefined, null, socket);
  abortIncoming(state.incoming);
  abortOutgoing(state.outgoing);
}

function abortIncoming(incoming: $Node.IncomingMessage[]) {
  while (incoming.length) {
    const req = incoming.shift()!;
    req.destroy(new ConnResetException("aborted"));
  }
}

function abortOutgoing(outgoing: ConnectionState["outgoing"]) {
  // The responses that waited on one connection share one error.
  let error: Error | undefined;
  while (outgoing.length) {
    const res = outgoing.shift() as $Node.ServerResponse;
    res[kFailHeldWrites]?.((error ??= $ERR_STREAM_DESTROYED("write")));
    res.destroy(new ConnResetException("aborted"));
  }
}

function socketOnEnd(
  server: $Node.HttpServer,
  socket: $Node.HttpSocket,
  parser: $Node.HTTPParser,
  state: ConnectionState,
) {
  const ret = parser.finish();

  if (ret instanceof Error) {
    // socketOnError has additional logic and will call socket.destroy(err).
    socketOnError.$call(socket, ret);
  } else if (!server.httpAllowHalfOpen) {
    socket.end();
  } else {
    const { outgoing } = state;
    const { length } = outgoing;
    if (length) {
      (outgoing[length - 1] as $Node.ServerResponse)._last = true;
    } else {
      const { _httpMessage } = socket;
      if (_httpMessage) _httpMessage._last = true;
      else socket.end();
    }
  }
}

function socketOnData(
  server: $Node.HttpServer,
  socket: $Node.HttpSocket,
  parser: $Node.HTTPParser,
  state: ConnectionState,
  d: Buffer,
) {
  $assert(!socket._paused);
  AsyncContextFrame.run(state.frame, executeParser, undefined, server, socket, parser, state, d);
}

function executeParser(
  server: $Node.HttpServer,
  socket: $Node.HttpSocket,
  parser: $Node.HTTPParser,
  state: ConnectionState,
  d: Buffer,
) {
  const ret = parser.execute(d);
  onParserExecuteCommon(server, socket, parser, state, ret, d);
}

class UpgradeStream extends Duplex {
  declare [kSocket]: $Node.HttpSocket;
  declare [kIncomingMessage]: $Node.IncomingMessage | null;

  constructor(socket: $Node.HttpSocket, req: $Node.IncomingMessage) {
    super({
      allowHalfOpen: socket.allowHalfOpen,
    });

    this[kSocket] = socket;
    this[kIncomingMessage] = req;

    // Proxy error, end & closure events immediately.
    socket.on("error", err => this.destroy(err));

    socket.on("close", () => this.destroy());
    this.on("close", () => socket.destroy());

    socket.on("end", () => {
      this.push(null);

      // Like a socket, which emits 'end' with no 'data' listener if it ends with nothing buffered.
      if (this.readableLength === 0) {
        this.resume();
      }
    });
  }

  requestBodyCompleted(upgradeHead?: Buffer) {
    this[kIncomingMessage] = null;

    if ((upgradeHead?.length ?? 0) > 0) {
      if (!this.push(upgradeHead)) {
        this[kSocket].pause();
      }
    }

    this[kSocket].on("data", data => {
      if (!this.push(data)) {
        this[kSocket].pause();
      }
    });
  }

  _read(_size: number) {
    // Otherwise a listener would have to read the whole request body before it could read this stream.
    this[kIncomingMessage]?.resume();

    this[kSocket].resume();
  }

  _final(callback: $Node.ErrorCallback) {
    const socket = this[kSocket];
    // The listener can have ended `req.socket` itself, and end() on a finished socket calls back with an error.
    if (socket.writableEnded) callback();
    else socket.end(callback);
  }

  _write(chunk: unknown, encoding: string, callback: $Node.ErrorCallback) {
    this[kSocket].write(chunk, encoding, callback);
  }

  _destroy(err: Error | null, callback: $Node.ErrorCallback) {
    this[kSocket].destroy(err);
    callback(err);
  }
}

function onParserExecuteCommon(
  server: $Node.HttpServer,
  socket: $Node.HttpSocket,
  parser: $Node.HTTPParser | null,
  state: ConnectionState,
  ret: number | $Node.HTTPParserError | undefined,
  d: Buffer,
) {
  const req = parser!.incoming;
  if (ret instanceof Error) {
    prepareError(ret, parser!, d);
    socketOnError.$call(socket, ret);
  } else if (req?.upgrade) {
    // Upgrade or CONNECT
    const eventName = req.method === "CONNECT" ? "connect" : "upgrade";

    let upgradeStream: $Node.Duplex;
    if (req.complete) {
      socket.removeListener("data", state.onData!);
      socket.removeListener("end", state.onEnd!);
      // The responses that still wait for their turn learn of the close from it.
      if (state.outgoing.length === 0) socket.removeListener("close", state.onClose!);
      socket.removeListener("drain", state.onDrain!);
      socket.removeListener("error", socketOnError);
      socket.removeListener("timeout", socketOnTimeout);
      socket.removeListener("resume", onSocketResume);

      parser!.finish();
      freeParser(parser, req, socket);
      parser = null;

      upgradeStream = socket;
    } else {
      // Already emitted, with the body still arriving.
      if (socket[kUpgradeStream]) return;

      // The wrapper hides what arrives until the request body has ended.
      d = kEmptyBuffer;
      upgradeStream = new UpgradeStream(socket, req);
      socket[kUpgradeStream] = upgradeStream as UpgradeStream;
    }

    if (server.listenerCount(eventName) > 0) {
      const bodyHead = d.slice(ret, d.length);

      if (req.complete && socket[kUpgradeStream]) {
        // Previously emitted, now completed - just activate the stream
        socket[kUpgradeStream].requestBodyCompleted(bodyHead);
      } else {
        socket.readableFlowing = null;
        server.emit(eventName, req, upgradeStream, bodyHead);
      }
    } else {
      // Got upgrade or CONNECT method, but have no handler.
      socket.destroy();
    }
  } else if (req && req.method === "PRI") {
    socket.destroy();
  }

  if (socket._paused) {
    // onIncoming paused the socket, we should pause the parser as well
    (socket.parser as $Node.HTTPParser | null | undefined)?.pause();
  }
}

function clearIncoming(this: $Node.IncomingMessage | void, req?: $Node.IncomingMessage, socket?: $Node.HttpSocket) {
  req ||= this as $Node.IncomingMessage;
  // stream.pipeline() takes the socket off a request that it destroys.
  const parser = (socket ?? req.socket)?.parser;
  // Reset the .incoming property so that the request object can be gc'ed.
  if (parser && parser.incoming === req) {
    // A destroyed request gets no 'end'. In Node it stays, and its 'timeout' listeners can keep the idle connection open.
    if (req.readableEnded || req.destroyed) {
      parser.incoming = null;
    } else {
      req.on("end", clearIncoming);
    }
  }
}

function resOnFinish(
  req: $Node.IncomingMessage,
  res: $Node.ServerResponse,
  socket: $Node.HttpSocket,
  state: ConnectionState,
  server: $Node.HttpServer,
) {
  // abortIncoming() may have emptied the array.
  $assert(state.incoming.length === 0 || state.incoming[0] === req);

  state.incoming.shift();

  // Nothing read the body, so pull it off the wire.
  if (!req._consuming && !req._readableState.resumeScheduled) req._dump();

  // uWS learns that the response it counted for this request is out. The handle has nothing of its own to write.
  const request = res[kNativeRequest];
  if (request !== undefined && !request.finished) request.end();
  res.detachSocket(socket);
  clearIncoming(req, socket);
  process.nextTick(emitCloseNT, res);

  if (res._last) {
    closeBehindLastWrite(socket);
  } else if (state.outgoing.length === 0) {
    const idleTimeout = keepAliveIdleTimeout(server);
    if (idleTimeout && typeof socket.setTimeout === "function") {
      socket.setTimeout(idleTimeout);
      socket[kKeepAliveTimeoutSet] = true;
    }
  } else {
    sendNextResponse(socket, state);
  }
}

function closeBehindLastWrite(socket: $Node.HttpSocket) {
  if (typeof socket.destroySoon === "function") {
    socket.destroySoon();
  } else {
    socket.end();
  }
}

const kDispatchThrew = Symbol("kDispatchThrew");

function sendNextResponse(socket: $Node.HttpSocket, state: ConnectionState) {
  const m = state.outgoing.shift() as ($Node.ServerResponse & ResponseTurn) | undefined;
  // Nothing can fill a destroyed response's slot, so close (Node assigns it).
  if (m === undefined) return;
  if (m[kDispatchThrew] && !m.finished) m.destroy();
  if (m.destroyed) {
    if (typeof socket.destroySoon === "function") socket.destroySoon();
    else socket.destroy();
  } else if (m.handedOff === undefined) giveSocket(m, socket);
  // The turn of a 'connect' that came behind responses. It got the rest of its read as `head`, and the socket got every later read.
  else if (socket[kHandle]!.startRawResponse(m.handedOff, false) && socket[kHandle]!.leaveHttp(true))
    socket[kHandle] = undefined;
}

// The request of a response that waited for its turn on a connection that uWS parses.
const kNativeRequest = Symbol("kNativeRequest");

function giveSocket(res: $Node.ServerResponse, socket: $Node.HttpSocket) {
  const request = res[kNativeRequest];
  if (request !== undefined && !socket[kHandle]?.startRawResponse(request, !res.shouldKeepAlive))
    return void res.destroy();
  res.assignSocket(socket);
}

// What Node's connection listener keeps for each connection, made for one that uWS parses when its first request arrives early.
const kConnectionState = Symbol("kConnectionState");
function connectionState(socket: $Node.HttpServerSocket) {
  let state = socket[kConnectionState];
  if (state === undefined) {
    state = socket[kConnectionState] = { outgoing: [], incoming: [], outgoingData: 0, onPendingData: undefined };
    socket.on("drain", socketOnDrain.bind(undefined, socket, state));
  }
  return state;
}

// Longer than the timeout the response advertised, so a client that uses all of it sees fewer ECONNRESETs. 0 if there is none.
function keepAliveIdleTimeout(server: $Node.HttpServer) {
  const { keepAliveTimeout, keepAliveTimeoutBuffer } = server;
  if (!(Number.isFinite(keepAliveTimeout) && keepAliveTimeout > 0)) return 0;
  return (
    keepAliveTimeout +
    (Number.isFinite(keepAliveTimeoutBuffer) && keepAliveTimeoutBuffer >= 0 ? keepAliveTimeoutBuffer : 1e3)
  );
}

function hasBodyHeaders(headers: $Node.IncomingHttpHeaders) {
  return "content-length" in headers || "transfer-encoding" in headers;
}

function parserOnIncoming(
  server: $Node.HttpServer,
  socket: $Node.HttpSocket,
  state: ConnectionState,
  req: $Node.IncomingMessage,
  keepAlive: boolean,
  dispatchBits?: number,
) {
  resetSocketTimeout(server, socket);

  if (req.upgrade) {
    req.upgrade = req.method === "CONNECT" || !!server.shouldUpgradeCallback(req);
    if (req.upgrade) {
      return 0;
    }
  }

  state.incoming.push(req);

  // Stop reading while the client doesn't take the responses, or pipelined requests could flood the connection.
  if (!socket._paused) {
    const ws = socket._writableState;
    if (ws.needDrain || state.outgoingData >= socket.writableHighWaterMark) {
      socket._paused = true;
      // onParserExecuteCommon() pauses the parser, once execute() is done with this chunk.
      socket.pause();
    }
  }

  const res: $Node.ServerResponse = new server[kServerResponse]!(req, {
    [kHandle]: null,
    highWaterMark: socket.writableHighWaterMark,
    rejectNonStandardBodyWrites: server.rejectNonStandardBodyWrites,
  });
  if (req[kHandle] !== undefined) res[kNativeRequest] = req[kHandle];
  res._keepAliveTimeout = server.keepAliveTimeout;
  res._maxRequestsPerSocket = server.maxRequestsPerSocket;
  res._onPendingData = state.onPendingData ??= updateOutgoingData.bind(undefined, socket, state);

  res.shouldKeepAlive = keepAlive;
  res[kUniqueHeaders] = server[kUniqueHeaders];
  observeRequest(req, res);

  if (server[kOptimizeEmptyRequests] === true && !hasBodyHeaders(req.headers)) {
    req._dumpAndCloseReadable();
    (req as any)._read();
  }

  if (socket._httpMessage) {
    // There are already pending outgoing res, append.
    state.outgoing.push(res);
    res[fakeSocketSymbol] = null;
  } else {
    giveSocket(res, socket);
  }

  res.on("finish", resOnFinish.bind(undefined, req, res, socket, state, server));

  let expectation = kNoExpectation;
  if (req.httpVersionMajor === 1 && req.httpVersionMinor === 1) {
    // uWS reported what its request has, so req.headers stays unbuilt until the program reads it.
    if (dispatchBits === undefined) {
      const { host, expect } = req.headers;
      dispatchBits = host === undefined ? 0 : DISPATCH_HAS_HOST;
      if (expect !== undefined) {
        dispatchBits |= continueExpression.test(expect as string)
          ? DISPATCH_HAS_EXPECT | DISPATCH_EXPECT_CONTINUE
          : DISPATCH_HAS_EXPECT;
      }
    }
    expectation = expectationFromBits(server, res, socket, dispatchBits);
  }
  emitRequest(server, socket, req, res, expectation);

  return 0; // No special treatment.
}

const kNoExpectation = 0;
const kMissingHost = 1;
const kOverRequestsLimit = 2;
const kExpectContinue = 3;
const kExpectOther = 4;

function expectationFromBits(
  server: $Node.HttpServer,
  res: $Node.ServerResponse,
  socket: $Node.HttpSocket,
  dispatchBits: number,
) {
  if (server.requireHostHeader && (dispatchBits & DISPATCH_HAS_HOST) === 0) return kMissingHost;
  if (isOverRequestsLimit(server, res, socket)) return kOverRequestsLimit;
  if ((dispatchBits & DISPATCH_HAS_EXPECT) === 0) return kNoExpectation;
  return (dispatchBits & DISPATCH_EXPECT_CONTINUE) !== 0 ? kExpectContinue : kExpectOther;
}

// Counts an HTTP/1.1 request against server.maxRequestsPerSocket.
function isOverRequestsLimit(server: $Node.HttpServer, res: $Node.ServerResponse, socket: $Node.HttpSocket) {
  const { maxRequestsPerSocket } = server;
  if (typeof maxRequestsPerSocket !== "number" || maxRequestsPerSocket <= 0) return false;
  const requestsCount = (socket.requestsCount = (socket.requestsCount! | 0) + 1);
  res._maxRequestsPerSocket = maxRequestsPerSocket;
  res.maxRequestsOnConnectionReached = maxRequestsPerSocket <= requestsCount;
  return maxRequestsPerSocket < requestsCount;
}

// How Node's parserOnIncoming answers or announces a request, for both parsers.
function emitRequest(
  server: $Node.HttpServer,
  socket: $Node.HttpSocket,
  req: $Node.IncomingMessage,
  res: $Node.ServerResponse,
  expectation: number,
) {
  switch (expectation) {
    case kNoExpectation:
      server.emit("request", req, res);
      break;
    case kMissingHost: {
      // A header in the dictionary asks the server about leniency, which a server behind a Proxy sees.
      const exchange = res.$exchange;
      if (exchange !== undefined) spillHeaders(exchange);
      res.writeHead(400, ["Connection", "close"]);
      res.end();
      break;
    }
    case kOverRequestsLimit:
      server.emit("dropRequest", req, socket);
      res.writeHead(503);
      res.end();
      break;
    case kExpectContinue:
      res._expect_continue = true;
      if (server.listenerCount("checkContinue") > 0) {
        server.emit("checkContinue", req, res);
      } else {
        res.writeContinue();
        server.emit("request", req, res);
      }
      break;
    default:
      if (server.listenerCount("checkExpectation") > 0) {
        server.emit("checkExpectation", req, res);
      } else {
        res.writeHead(417);
        res.end();
      }
  }
}

// Node's parserOnMessageComplete: a message without a body is complete once the listener returns, and the reads go on unless http paused them. EOF stays lazy (_read).
function completeWithoutBody(req: $Node.IncomingMessage, socket: $Node.HttpServerSocket) {
  req.complete = true;
  if (!socket._paused && socket.readable && socket.isPaused()) socket.resume();
}

function resetSocketTimeout(server: $Node.HttpServer, socket: $Node.HttpSocket) {
  if (!socket[kKeepAliveTimeoutSet]) return;

  socket.setTimeout!(server.timeout || 0);
  socket[kKeepAliveTimeoutSet] = false;
}

function onSocketResume(this: $Node.HttpSocket) {
  // 'resume' is emitted a tick after the call, and parserOnIncoming() may have paused the socket since.
  if (this._paused) this.pause();
}

function onSocketTimeoutTimerExpired(this: $Node.HttpServerSocket) {
  const socket = this;
  // The keep-alive idle timer stays armed across requests. A fire while a request is in flight is stale: re-arm and bail.
  if (socket.timeout === 0 && !socket[kKeepAliveTimeoutSet]) {
    socket[kTimeout]?.refresh();
    return;
  }
  // Like Node, the deadline is one full timeout after the last write, which can be later than this timer was armed for.
  const lastWrite = socket[kLastResponseWrite];
  if (lastWrite !== undefined) {
    socket[kLastResponseWrite] = undefined;
    const timer = socket[kTimeout];
    if (timer != null && lastWrite > timer._idleStart) {
      timer.refresh();
      timer._idleStart = lastWrite;
      return;
    }
  }
  NetSocket!.prototype._onTimeout.$call(socket);
}

let NetSocket: $Node.SocketConstructor | undefined;
let NetConnection: $Node.SocketConstructor | undefined;
let TLSConnection: $Node.SocketConstructor | undefined;
let assignablePeerAddress: PropertyDescriptorMap | undefined;
let connectionPrototype: object | undefined;
let netSocketPrototype: object | undefined;
let netSocketResume: unknown;
let netSocketSetTimeout: unknown;
function loadNet(tls: $Node.HttpServerTLSOptions | null) {
  if (NetSocket === undefined) {
    NetSocket = require("node:net").Socket;
    const OwnSocket = netConstructors.Socket!;
    NetConnection = class Socket extends OwnSocket {
      on(event: $Node.EventName, listener: $Node.Listener) {
        return unconsumeFor(this, event, super.on(event, listener));
      }
      addListener(event: $Node.EventName, listener: $Node.Listener) {
        return unconsumeFor(this, event, super.addListener(event, listener));
      }
      prependListener(event: $Node.EventName, listener: $Node.Listener) {
        return unconsumeFor(this, event, super.prependListener(event, listener));
      }
    } as unknown as $Node.SocketConstructor;
    // Where a program has stored another class in `net.Socket`, no socket has these prototypes and no short road is taken.
    const ownPrototype = OwnSocket.prototype;
    if (NetSocket === OwnSocket) connectionPrototype = NetConnection.prototype;
    else extendStoredClass(NetConnection, NetSocket!);
    netSocketPrototype = ownPrototype;
    netSocketResume = ownPrototype.resume;
    netSocketSetTimeout = ownPrototype.setTimeout;
    assignablePeerAddress = {};
    for (const name of ["remoteAddress", "remotePort", "remoteFamily"]) {
      assignablePeerAddress[name] = {
        configurable: true,
        // Of node:net's own class: one that a program has stored in `net.Socket` may inherit it.
        get: Object.getOwnPropertyDescriptor(ownPrototype, name)!.get,
        set(value) {
          Object.defineProperty(this, name, { value, writable: true, configurable: true, enumerable: true });
        },
      };
    }
  }
  if (tls && TLSConnection === undefined) {
    const Base = require("node:tls").TLSSocket as unknown as $Node.SocketConstructor;
    TLSConnection = class TLSSocket extends Base {
      on(event: $Node.EventName, listener: $Node.Listener) {
        return unconsumeFor(this, event, super.on(event, listener));
      }
      addListener(event: $Node.EventName, listener: $Node.Listener) {
        return unconsumeFor(this, event, super.addListener(event, listener));
      }
      prependListener(event: $Node.EventName, listener: $Node.Listener) {
        return unconsumeFor(this, event, super.prependListener(event, listener));
      }
    } as unknown as $Node.SocketConstructor;
  }
}

function attachConnection(server: $Node.HttpServer, socket: $Node.HttpServerSocket, http: $Node.NodeHTTPServerSocket) {
  socket[kHandle] = http;
  http.duplex = socket;
  http.onclose = onConnectionClosed.bind(http, server[kTrackedConnections]);
  if (socket.encrypted) {
    // The native SNI dispatch asks the object in the handle's `data`, which is this socket.
    socket._SNICallback = server[tlsSymbol]?._SNICallback;
    socket.resetAndDestroy = resetAndDestroyNotTCP;
  } else {
    if (server[kListenerGeneration]?.isUnix) socket.resetAndDestroy = resetAndDestroyNotTCP;
    nativeConnectionListener(server, socket);
  }
}

// https://github.com/nodejs/node/blob/v26.5.0/lib/net.js#L826-L829
function resetAndDestroyNotTCP(): never {
  throw $ERR_INVALID_HANDLE_TYPE();
}

// Node's connectionListenerInternal, for a connection that uWS parses.
function nativeConnectionListener(server: $Node.HttpServer, socket: $Node.HttpServerSocket) {
  server[kTrackedConnections].add(socket);
  // Keep a shorter timeout that a 'connection' listener armed. It may have fired during the handshake, so restart it.
  const serverTimeout = server.timeout;
  if (serverTimeout && !(socket.timeout > 0 && socket.timeout < serverTimeout)) socket.setTimeout(serverTimeout);
  else socket._unrefTimer();
  socket.on("timeout", socketOnTimeout);
  socket.on("error", socketOnError);
  socket.on("close", nativeSocketOnClose);
  socket.on("end", nativeSocketOnEnd);
  // uWS reads for the parser. The listener keeps the socket flowing like Node's, so that 'end' comes at the peer's FIN.
  socket.on("data", noopOnData);
  socket.on("resume", nativeSocketOnResume);
  socket.on("pause", onSocketPause);
  // Behind the listeners of this module: a later one for 'data' or 'readable' takes the reads from the parser.
  socket.parser = createServerParserShim(socket);
  socket.setEncoding = socketSetEncoding;
  socket._onTimeout = onSocketTimeoutTimerExpired;
  socket._final = nativeSocketFinal;
  socket._destroy = nativeSocketDestroy;
  socket._paused = false;
  // Declared here, so that a socket that a program seals still takes every later store.
  socket[kBoundOnAbort] = undefined;
  socket[kCloseCallback] = undefined;
  socket[kConnectionState] = undefined;
  socket[kKeepAliveTimeoutSet] = false;
  socket[kLastResponseWrite] = undefined;
  socket[kFinishedAtClose] = undefined;
  socket[kDetachedWhileClosing] = undefined;
  socket[kHandedOff] = false;
  socket[kHandleClosed] = undefined;
  socket[kStopParsingOnCloseListener] = false;
  socket[kUpgradeRequest] = undefined;
  socket[kUpgradeStream] = undefined;
  // In Node an assignment to one of these throws in strict mode. Here a server's socket has always kept the value.
  Object.defineProperties(socket, assignablePeerAddress!);
  socket.$isPrepared = false;
  socket.$ownReadableState = socket._readableState;
  if (IS_COMPILED_AHEAD_OF_TIME) socket.$resumeUnlessFlowing = resumeUnlessFlowing;
}

// resume(), left out where it would find the socket flowing and change nothing.
function resumeUnlessFlowing(this: $Node.HttpServerSocket, asksWhetherReadable: boolean) {
  if (!readsFlowUnseen(this)) {
    ("unlikely");
    if (!asksWhetherReadable || this.readable) this.resume();
    return;
  }
  if (
    this.resume !== netSocketResume ||
    DuplexPrototype.resume !== duplexResume ||
    !readsItsEndUnseen(this) ||
    this._readableState !== this.$ownReadableState ||
    (flagsOf(this._readableState) & (kFlowing | kHasPaused | kPaused)) !== (kFlowing | kHasPaused)
  ) {
    this.resume();
  }
}

function extendStoredClass(Connection: $Node.SocketConstructor, Stored: $Node.SocketConstructor) {
  // Refuses what no class can extend.
  void class extends Stored {};
  ObjectSetPrototypeOf(Connection, Stored);
  ObjectSetPrototypeOf(Connection.prototype, Stored.prototype);
}

// Node stores functions that do this on each socket: https://github.com/nodejs/node/blob/v26.5.0/lib/_http_server.js#L1432-L1448. On a prototype they shadow no method of an instance.
function unconsumeFor<Result>(socket: $Node.HttpServerSocket, event: $Node.EventName, result: Result): Result {
  if (event === "data" || event === "readable") unconsume(socket);
  return result;
}
function noopOnData() {}
// From here on the socket gets every read before the HTTP parser does, like Node's parser.unconsume().
function unconsume(socket: $Node.HttpServerSocket) {
  const parser = socket.parser;
  if (parser == null || !parser._consumed) return;
  parser._consumed = false;
  socket.removeListener("pause", onSocketPause);
  socket.removeListener("resume", nativeSocketOnResume);
  // Gone once uWS has closed the connection, which is before the socket's 'close'.
  socket[kHandle]?.setRawReads(true);
}

function nativeSocketOnResume(this: $Node.HttpServerSocket) {
  if (this._paused) {
    this.pause();
    return;
  }
  this._handle?.resume();
}
function onSocketPause(this: $Node.HttpServerSocket) {
  this._handle?.pause();
}

// Without net.Socket's tick: what the response writes after socket.end() is dropped, as in Node, where both share the socket's Writable.
function nativeSocketFinal(this: $Node.HttpServerSocket, callback: $Node.ErrorCallback) {
  this._handle?.shutdown();
  callback();
}

// net.Socket queues 'close' from here. Node's comes from the handle, so it doesn't run in the AsyncLocalStorage store of the request whose end closes the connection.
function nativeSocketDestroy(this: $Node.HttpServerSocket, err: Error | null, callback: $Node.ErrorCallback) {
  const scheduleClose = this[kHandle] !== undefined ? closeWithConnection : undefined;
  const frame = AsyncContextFrame.currentGraphFrame();
  AsyncContextFrame.run(frame, NetSocket!.prototype._destroy, this, err, callback, scheduleClose);
}

// Like in Node, 'close' comes when the connection has closed: behind the read in progress, ahead of what a client in this process does about it. An immediate, if that is sooner.
function closeWithConnection(
  emitClose: (socket: $Node.HttpServerSocket, isException: boolean) => void,
  socket: $Node.HttpServerSocket,
  isException: boolean,
) {
  const http = socket[kHandle]!;
  const onclose = http.onclose!;
  let isOwed = true;
  function emit() {
    if (!isOwed) return;
    isOwed = false;
    emitClose(socket, isException);
  }
  http.onclose = function (this: $Node.NodeHTTPServerSocket, left?: $Node.HttpServerSocket) {
    onclose.$call(this, left);
    emit();
  };
  setImmediate(emit);
}

// Node's socketOnEnd. What becomes of the connection after a clean end is uWS's decision, right behind this.
function nativeSocketOnEnd(this: $Node.HttpServerSocket) {
  if (!this[kHandle]?.finishParsing()) return;
  const err: any = $HPE_INVALID_EOF_STATE("Parse Error: Invalid EOF state");
  err.reason = "Invalid EOF state";
  err.rawPacket = kEmptyBuffer;
  socketOnError.$call(this, err);
}

// uWS closed the connection. A response's writes don't pass through the socket's Writable, so they fail here, where Node's destroy() fails them.
function onConnectionClosed(
  this: $Node.NodeHTTPServerSocket,
  tracked: Set<$Node.HttpServerSocket>,
  left?: $Node.HttpServerSocket,
) {
  const http = this;
  const socket = left ?? http.duplex!;
  if (socket[kHandle] !== http) return;
  socket[kHandle] = undefined;
  socket.$isPrepared = false;
  if (left !== undefined) {
    // Not closed: the body of an accepted Upgrade request has ended, and the connection is the socket's from here on.
    socket.removeListener("end", socket.end);
    const req = socket[kUpgradeRequest];
    if (req !== undefined) {
      socket[kUpgradeRequest] = undefined;
      emitUpgrade(socket, req, true);
    }
    return;
  }
  tracked.delete(socket);
  const pending = socket[kDetachedWhileClosing];
  const message = socket._httpMessage ?? (pending?.destroyed ? pending : undefined);
  if (message) {
    failPendingWriteCallbacks(message, socket.errored ?? $ERR_STREAM_DESTROYED("write"));
    // An ended response that was still draining finishes first, like Node.js's failed last write: its request is not aborted.
    if (message[kPendingFinish] !== undefined) {
      flushPendingFinish.$call(message);
      socket[kFinishedAtClose] = message;
    }
  }
  if (socket.destroyed || http.closeError) {
    // The handle's own close, right behind this, reports the error.
  } else if (!http.peerEnded) {
    // This side closed it, so there's no EOF to report.
    socket.destroy();
  } else if (socket.readableEnded) {
    // Node's socketOnEnd. net.Socket leaves a half-open socket whose peer is gone to its owner.
    socket.end();
  } else if (socket.readableFlowing) {
    socket.once("end", socket.end);
  } else {
    // Nobody reads the EOF, and the connection is gone.
    socket.destroy();
  }
  // Handed to 'connect' behind responses that were still owed: its 'close' listener went with the hand-off.
  if (socket[kHandedOff]) nativeSocketOnClose.$call(socket);
}
const kFinishedAtClose = Symbol("kFinishedAtClose");

// Node's socketOnClose: free the parser, abort what is in flight and what is queued.
function nativeSocketOnClose(this: $Node.HttpServerSocket) {
  const socket = this;
  releaseServerParserShim(socket);
  const pending = socket[kDetachedWhileClosing];
  socket[kDetachedWhileClosing] = undefined;
  const message = socket._httpMessage ?? (pending?.destroyed ? pending : undefined);
  const req = message != null && socket[kFinishedAtClose] !== message ? message.req : undefined;
  if (req && !req.destroyed) {
    req[kHandle] = undefined;
    if (req.listenerCount("error") > 0) {
      req.destroy(new ConnResetException("aborted"));
    } else {
      req.destroy();
    }
  }
  if (message && !message._closed) emitCloseNT(message);
  const state = socket[kConnectionState];
  if (state !== undefined) {
    abortIncoming(state.incoming);
    abortOutgoing(state.outgoing);
  }
}
const kDetachedWhileClosing = Symbol("kDetachedWhileClosing");

// The close of a TLS handle waits for ciphertext that write() reported and a stalled peer does not take, but only once.
function destroyNow(socket: $Node.HttpServerSocket) {
  const http = socket[kHandle];
  socket.destroy();
  if (!http || http.closed) return;
  http.close();
  // In the middle of its own request a handle only takes note, and closes behind it, for the first time.
  if (!http.closed) setImmediate(closeHandle, http);
}

// Node validates the `Trailer` header inside _storeHeader, after the body framing has
// been decided, so `this.chunkedEncoding` is already set. Bun frames the body in uWS
// and never sets `response.chunkedEncoding`, so reproduce Node's decision here.
function willBeChunked(response: $Node.ServerResponse) {
  spillHeadersOf(response);
  // kOutHeaders is a null-proto map of lowercased name -> [name, value];
  // index it directly instead of paying hasHeader/getHeader (each of which
  // re-reads the symbol and lowercases its argument) per check.
  const outHeaders = response[kOutHeaders];
  const te = outHeaders !== null ? outHeaders["transfer-encoding"] : undefined;
  if (te !== undefined) {
    return chunkExpression.test(String(te[1]));
  }
  if (outHeaders !== null && outHeaders["content-length"] !== undefined) return false;
  if (response._hasBody === false) return false;
  if (response._removedTE) return false;
  return response.useChunkedEncodingByDefault === true;
}

// Returns true if _storeHeader() will frame the body with neither a length nor chunks, so that it ends where the connection does (RFC 9112 6.3).
function bodyEndsAtClose(response: $Node.ServerResponse) {
  if (response._hasBody === false) return false;
  const outHeaders = response[kOutHeaders];
  if (outHeaders !== null) {
    if (outHeaders["content-length"] !== undefined) return false;
    const te = outHeaders["transfer-encoding"];
    if (te !== undefined) return !chunkExpression.test(String(te[1]));
    if (outHeaders["trailer"] !== undefined) return response._removedTE;
  }
  return response._removedTE && (response._removedContLen || typeof response._contentLength !== "number");
}

// A non-chunked message is terminated by the first empty line after the header
// fields, so it can carry neither a body nor trailers.
function hasInvalidTrailer(response: $Node.ServerResponse, exchange: Exchange | undefined) {
  if (exchange !== undefined && (exchange.headerBits & (HEADER_TRAILER | HEADER_SPILLED)) === 0) {
    return false;
  }
  if (willBeChunked(response)) return false;
  const outHeaders = response[kOutHeaders];
  return outHeaders !== null && outHeaders["trailer"] !== undefined;
}

function validateStatusCode(statusCode: number) {
  const originalStatusCode = statusCode;
  statusCode |= 0;
  if (statusCode < 100 || statusCode > 999) {
    throw $ERR_HTTP_INVALID_STATUS_CODE(require("internal/util/inspect").format("%s", originalStatusCode));
  }
  return statusCode;
}

// What Node's _implicitHeader() checks and derives. write() and end() send the head without a writeHead() call.
function validateImplicitHead(response: $Node.ServerResponse) {
  const statusCode = (response.statusCode = validateStatusCode(response.statusCode));
  const statusMessage = response.statusMessage;
  if (statusMessage !== undefined && checkInvalidHeaderChar(statusMessage)) throw $ERR_INVALID_CHAR("statusMessage");
  updateHasBody(response, statusCode);
}

// Node renders the head inside writeHead(). Copy the caller's array so later changes to it, and appendHeader()'s push, never reach the wire.
function snapshotHeaderValue(value: $Node.HttpHeaderValue): $Node.HttpHeaderValue {
  if (!$isArray(value)) return value;
  const length = value.length;
  const copy: (number | string)[] = $newArrayWithSize(length);
  for (let i = 0; i < length; i++) $putByValDirect(copy, i, value[i]);
  return copy;
}

// `explicit`: the program called writeHead(). write() and end() send a `Trailer` header as it is, whatever the request's method or version.
// `exchange` is there where `response` is entered itself, and not where another object stands in its place.
function _writeHead(
  statusCode: number,
  reason: string | $Node.HttpHeadersInit | null | undefined,
  obj: $Node.HttpHeadersInit | null | undefined,
  response: $Node.ServerResponse,
  explicit: boolean,
  exchange: Exchange | undefined,
) {
  statusCode = validateStatusCode(statusCode);

  let statusMessage: string | undefined;
  if (exchange === undefined) {
    ("unlikely");
    if (typeof reason === "string") {
      response.statusMessage = reason;
    } else {
      if (!response.statusMessage) response.statusMessage = STATUS_CODES[statusCode] || "unknown";
      obj ??= reason;
    }
    if (checkInvalidHeaderChar(response.statusMessage!)) throw $ERR_INVALID_CHAR("statusMessage");
  } else if (typeof reason === "string") {
    ("unlikely");
    // writeHead(statusCode, reasonPhrase[, headers])
    response.statusMessage = statusMessage = reason;
    if (checkInvalidHeaderChar(statusMessage)) throw $ERR_INVALID_CHAR("statusMessage");
  } else {
    // writeHead(statusCode[, headers])
    if (response.statusMessage === undefined || !response.statusMessage) {
      response.statusMessage = STATUS_CODES[statusCode] || "unknown";
    } else if (checkInvalidHeaderChar(response.statusMessage)) throw $ERR_INVALID_CHAR("statusMessage");
    obj ??= reason;
  }

  response.statusCode = statusCode;
  // Before the Trailer checks below, like Node's writeHead: a 204/304/1xx status
  // clears _hasBody, and a body-less message can never carry trailers.
  updateHasBody(response, statusCode);

  {
    // Slow-case: when progressive API and header fields are passed.
    let k;

    if ($isArray(obj)) {
      const length = obj.length;
      // Append all the headers provided in the array:
      if (length && $isArray(obj[0])) {
        for (let i = 0; i < length; i++) {
          const k = obj[i];
          if (k) response.appendHeader(k[0], snapshotHeaderValue(k[1]));
        }
      } else {
        if (length % 2 !== 0) {
          throw $ERR_INVALID_ARG_VALUE("headers", obj);
        }
        // Test non-chunked message does not have trailer header set,
        // message will be terminated by the first empty line after the
        // header fields, regardless of the header fields present in the
        // message, and thus cannot contain a message body or 'trailers'.
        if (hasInvalidTrailer(response, exchange)) {
          throw $ERR_HTTP_TRAILER_INVALID();
        }
        // Headers in obj should override previous headers but still
        // allow explicit duplicates. To do so, we first remove any
        // existing conflicts, then use appendHeader.

        for (let n = 0; n < length; n += 2) {
          k = obj[n + 0];
          response.removeHeader(k);
        }

        for (let n = 0; n < length; n += 2) {
          k = obj[n];
          if (k) response.appendHeader(k, snapshotHeaderValue((obj as string[])[n + 1]));
        }
      }
    } else if (obj) {
      const keys = Object.keys(obj);
      const length = keys.length;
      const setsHeadersItself =
        IS_COMPILED_AHEAD_OF_TIME &&
        exchange !== undefined &&
        !response._header &&
        response.setHeader === outgoingSetHeader;
      // Retain for(;;) loop for performance reasons
      // Refs: https://github.com/nodejs/node/pull/30958
      for (let i = 0; i < length; i++) {
        k = keys[i];
        if (k) {
          if (setsHeadersItself) storeHeader(exchange!, k, snapshotHeaderValue(obj[k]));
          else response.setHeader(k, snapshotHeaderValue(obj[k]));
        }
      }
    }
    if (explicit && hasInvalidTrailer(response, exchange)) {
      ("unlikely");
      // The message is not chunk-framed, so `Trailer` is the offending header; drop it
      // so a caller that swallows the throw cannot put it on the wire.
      response.removeHeader("trailer");
      throw $ERR_HTTP_TRAILER_INVALID();
    }
  }
}

const EXCHANGE_ENDED_CLEAN = 1 << 2;
const EXCHANGE_HAS_STAND_IN = 1 << 3;
const EXCHANGE_HAS_END_CALLBACK = 1 << 5;
const EXCHANGE_HAS_PENDING_CALLBACKS = 1 << 6;
const EXCHANGE_HAS_SNAPSHOT = 1 << 8;
const EXCHANGE_FINISHES_HERE = 1 << 9;
const EXCHANGE_REQUEST_WAITS = 1 << 10;
const REQUEST_UNSEEN = 0;
const REQUEST_CONSUMED = 1;
const REQUEST_OTHER = 2;
const REQUEST_DUMPED_IN_PLACE = 3;
const EXCHANGE_OTHERS_WAIT = 1 << 11;

const noResponseEvents: $Node.HttpResponseEvents = { __proto__: null, finish: undefined };
const noChunks: (string | $Node.HttpChunk | $Node.HttpWriteCallback | null | undefined)[] = [];
const noCallbacks: $Node.HttpWriteCallback[] = [];
const nop = () => {};
const {
  addListener: eventEmitterOn,
  emit: eventEmitterEmit,
  storeEmitWithRejectionCapture,
  removeListener: eventEmitterRemoveListener,
} = shared.originals.eventEmitter!;

function ServerResponse(
  this: $Node.ServerResponse,
  req: $Node.IncomingMessage,
  options?: $Node.ServerResponseOptions | typeof kHandle,
  nativeHandle?: $Node.NodeHTTPResponse,
  nativeSocket?: $Node.HttpServerSocket,
  nativeHighWaterMark?: number,
  nativeRejectsBodyWrites?: boolean,
  nativeKeepAliveTimeout?: number,
  nativeHasBody?: boolean,
  nativeIsLast?: boolean,
): void {
  if (options === kHandle) {
    const events: $Node.HttpResponseEvents = { __proto__: null, finish: emitResponseFinish };
    this._events = events as any;
    this._eventsCount = 0;
    this[kShapeMode] = false;
    this._maxListeners = undefined;
    if ((this[kCapture] = EventEmitterPrototype[kCapture])) {
      ("unlikely");
      storeEmitWithRejectionCapture(this);
    }
    this.outputData = [];
    this.outputSize = 0;
    this.writable = true;
    this.destroyed = false;
    this._last = false;
    this.chunkedEncoding = false;
    this.shouldKeepAlive = true;
    this.maxRequestsOnConnectionReached = false;
    this._defaultKeepAlive = true;
    this.useChunkedEncodingByDefault = true;
    this.sendDate = false;
    this._removedConnection = false;
    this._removedContLen = false;
    this._removedTE = false;
    this.strictContentLength = false;
    this[kBytesWritten] = 0;
    this._contentLength = null;
    this._hasBody = true;
    this._trailer = "";
    this[kNeedDrain] = false;
    this.finished = false;
    this._headerSent = false;
    this[kCorked] = 0;
    this[kChunkedBuffer] = noChunks;
    this[kChunkedLength] = 0;
    this._closed = false;
    this[kSocket] = nativeSocket!;
    this._header = null;
    this[kOutHeaders] = null;
    this._keepAliveTimeout = 0;
    this._onPendingData = nop;
    this[kErrored] = null;
    this[kHighWaterMark] = nativeHighWaterMark!;
    this[kRejectNonStandardBodyWrites] = nativeRejectsBodyWrites;
    this[kLenientValidation] = undefined;
    this.$exchange = makeExchange(this, nativeSocket!, events, req._readableState);
    this.req = req;
    this.sendDate = true;
    this._sent100 = false;
    this[kPendingCallbacks] = noCallbacks;
    if (!nativeHasBody) this._hasBody = false;
    this[kHandle] = nativeHandle;
    this.statusCode = 200;
    this.statusMessage = undefined;
    this._keepAliveTimeout = nativeKeepAliveTimeout;
    if (nativeIsLast) this._last = true;
    if (this.on !== eventEmitterOn) {
      ("unlikely");
      this._events = Object.create(null);
      this.on("finish", emitResponseFinish);
    } else {
      this._eventsCount = 1;
    }
    return;
  }
  if (new.target !== ServerResponse) {
    ("unlikely");
    if (!(this instanceof ServerResponse)) return new ServerResponse(req, options) as any;
    return initializeStoreByStore(this, req, options);
  }
  const exchange = makeExchange(this, null, noResponseEvents, null);
  exchange.flags = EXCHANGE_HAS_PENDING_CALLBACKS;
  this._events = Object.create(null);
  this._eventsCount = 0;
  this[kShapeMode] = false;
  this._maxListeners = undefined;
  if ((this[kCapture] = EventEmitterPrototype[kCapture])) {
    storeEmitWithRejectionCapture(this);
  }
  this.outputData = [];
  this.outputSize = 0;
  this.writable = true;
  this.destroyed = false;
  this._last = false;
  this.chunkedEncoding = false;
  this.shouldKeepAlive = true;
  this.maxRequestsOnConnectionReached = false;
  this._defaultKeepAlive = true;
  this.useChunkedEncodingByDefault = true;
  this.sendDate = false;
  this._removedConnection = false;
  this._removedContLen = false;
  this._removedTE = false;
  this.strictContentLength = false;
  this[kBytesWritten] = 0;
  this._contentLength = null;
  this._hasBody = true;
  this._trailer = "";
  this[kNeedDrain] = false;
  this.finished = false;
  this._headerSent = false;
  this[kCorked] = 0;
  this[kChunkedBuffer] = [];
  this[kChunkedLength] = 0;
  this._closed = false;
  this[kSocket] = null;
  this._header = null;
  this[kOutHeaders] = null;
  this._keepAliveTimeout = 0;
  this._onPendingData = nop;
  this[kErrored] = null;
  this[kHighWaterMark] = options?.highWaterMark ?? getDefaultHighWaterMark();
  this[kRejectNonStandardBodyWrites] = options?.rejectNonStandardBodyWrites ?? false;
  this[kLenientValidation] = undefined;
  this.$exchange = exchange;
  this.req = req;
  this.sendDate = true;
  this._sent100 = false;
  this[kPendingCallbacks] = [];

  if (req.method === "HEAD") this._hasBody = false;

  if (req.httpVersionMajor! < 1 || req.httpVersionMinor! < 1) {
    this.useChunkedEncodingByDefault = chunkExpression.test((req.headers?.te as string | undefined) ?? "");
    this.shouldKeepAlive = false;
  }

  this[kHandle] = handleFor(req, options);
  this.statusCode = 200;
  this.statusMessage = undefined;
}
$toClass(ServerResponse, "ServerResponse", OutgoingMessage);

// The native response of a request that 'upgrade' or 'connect' handed over is done. This one writes to the socket it's assigned, like in Node.
function handleFor(req: $Node.IncomingMessage, options: $Node.ServerResponseOptions | undefined) {
  let handle = options?.[kHandle];
  if (handle === undefined && (handle = req[kHandle]) && handle.flags & NodeHTTPResponseFlags.closed_or_completed) {
    handle = undefined;
  }
  return handle;
}

// A class that extends ServerResponse may have an accessor under any of these names, so each store is made, in this order.
function initializeStoreByStore(
  res: $Node.ServerResponse,
  req: $Node.IncomingMessage,
  options: $Node.ServerResponseOptions | undefined,
): void {
  const exchange = makeExchange(res, null, noResponseEvents, null);
  exchange.flags = EXCHANGE_HAS_PENDING_CALLBACKS;
  OutgoingMessage.$call(res, options);
  res.$exchange = exchange;

  res.req = req;
  res.sendDate = true;
  res._sent100 = false;
  res[kPendingCallbacks] = [];

  if (req.method === "HEAD") res._hasBody = false;

  if (req.httpVersionMajor! < 1 || req.httpVersionMinor! < 1) {
    res.useChunkedEncodingByDefault = chunkExpression.test((req.headers?.te as string | undefined) ?? "");
    res.shouldKeepAlive = false;
  }

  res[kHandle] = handleFor(req, options);

  res.statusCode = 200;
  res.statusMessage = undefined;
}
const ServerResponsePrototype: object = ServerResponse.prototype;

// A response that another constructor made has no exchange. The server gives it one whose response nobody holds, so it takes the
// functions of an object that stands in the place of a response, which keep the state on their receiver.
let responseOfNobody: $Node.ServerResponse | undefined;
function adoptResponse(res: $Node.ServerResponse): void {
  const nobody = (responseOfNobody ??= new ServerResponse(new IncomingMessage(null)));
  const exchange = makeExchange(nobody, null, noResponseEvents, null);
  exchange.flags = EXCHANGE_HAS_PENDING_CALLBACKS | EXCHANGE_HAS_STAND_IN;
  res.$exchange = exchange;
}
Object.defineProperty(ServerResponse, "length", { __proto__: null, value: 2, configurable: true });
// A response whose own statusCode was deleted sends 200, as in Node.js.
ServerResponse.prototype.statusCode = 200;
// A connection that closes under the ended response it carries completes it. Node 26.12 emits no 'finish' and fails the end() callback.
ServerResponse.prototype[kFinishesWithoutLastWrite] = true;

function isUnheard(res: $Node.ServerResponse, exchange: Exchange): boolean {
  const events = exchange.events;
  return res._eventsCount === 1 && (res._events as any) === events && events.finish === emitResponseFinish;
}

function spillHeadersOf(res: $Node.ServerResponse): void {
  const exchange = res.$exchange;
  if (exchange !== undefined) spillHeaders(exchange);
}

function statusCodeToSend(res: $Node.ServerResponse): number {
  const exchange = res.$exchange;
  if (exchange === undefined || exchange.response !== res) return res[kSnapshotStatusCode] ?? res.statusCode;
  return (exchange.flags & EXCHANGE_HAS_SNAPSHOT) !== 0 ? exchange.statusCode : res.statusCode;
}

function statusMessageToSend(res: $Node.ServerResponse): string | undefined {
  const exchange = res.$exchange;
  if (exchange === undefined || exchange.response !== res) return res[kSnapshotStatusMessage] ?? res.statusMessage;
  // Native code writes the status code's own message for an empty one as for none.
  if ((exchange.flags & EXCHANGE_HAS_SNAPSHOT) !== 0) return exchange.statusMessage || undefined;
  return res.statusMessage === undefined ? undefined : res.statusMessage;
}

// ServerResponse stores its outgoing headers the same way Node.js does (the
// kOutHeaders map inherited from OutgoingMessage). Right before the headers
// are handed to the native response handle they are rendered into a flat
// [name, value, name, value, ...] array so that array values / repeated
// header names become separate header lines on the wire, exactly like
// Node.js's _storeHeader().
//
// Node.js's server also adds Date, Connection and Keep-Alive response headers
// by default (unless the user set/removed them, or res.sendDate is false);
// the native handle does not, so they are appended to the rendered array.
// Like Node.js's _storeHeader(), the defaults never touch kOutHeaders, so
// getHeaders()/getHeaderNames()/hasHeader() keep reporting only the headers
// the user actually set, even after the headers have been flushed.
// Reusable backing array for renderNativeHeaders. The native writeHead
// consumes the array synchronously, so it can be reused across requests;
// the busy flag covers re-entrancy (a user toString() on a header value
// dispatching another response) and exception paths by degrading to a
// fresh array, which is exactly the previous behavior.
// Auto-header bits (kAutoHeader* in src/jsc/bindings/NodeHTTP.cpp - keep in
// sync): renderNativeHeaders reports the framework headers (Date, Connection,
// Keep-Alive) through these instead of pushing strings into the flat array;
// the native side writes them from cached byte blobs.
const AUTO_HEADER_DATE = 1 << 0;
const AUTO_HEADER_CONN_KEEP_ALIVE = 1 << 1;
const AUTO_HEADER_CONN_CLOSE = 1 << 2;
const AUTO_HEADER_KEEP_ALIVE_TIMEOUT = 1 << 3;
// Node's _storeHeader writes the chunked Transfer-Encoding after the Connection
// line, so it is rendered natively with the other auto headers rather than being
// pushed into the flat array (which goes out first).
const AUTO_HEADER_TRANSFER_ENCODING_CHUNKED = 1 << 4;
// Bits 5 and 6, no header line: how the body is framed. 0 leaves it to the native side (Content-Length, or end() against write()).
const AUTO_HEADER_BODY_CHUNKED = 1 << 5;
const AUTO_HEADER_BODY_UNTIL_CLOSE = 2 << 5;
const AUTO_HEADER_BODY_NONE = 3 << 5;
// The largest Keep-Alive timeout, in seconds, handed to the native writeHead (it takes a uint32).
const kMaxNativeKeepAliveSecs = 0x7fffffff;
let renderedAutoHeaders = 0;
let renderedKeepAliveSecs = 0;
let lastKeepAliveTimeout = -1;
let lastKeepAliveSecs = 0;

// Every response without a header has one and the same array.
function withRoomFor(flat: unknown[]): unknown[] {
  return flat.length === 0 ? [] : flat;
}

// A request of HTTP/1.1 finds both numbers on its prototype.
function takesChunks(req: $Node.IncomingMessage): boolean {
  return req.httpVersionMajor! >= 1 && req.httpVersionMinor! >= 1;
}

// Walks the headers into `flat`. Answers with the bits of those that frame the response.
function renderHeadersInto(flat: unknown[], res: $Node.ServerResponse, entries: unknown[]): number {
  let bits = 0;
  for (let i = 0; i < entries.length; i += 3) {
    const key = entries[i] as string;
    const value = entries[i + 2] as $Node.HttpHeaderValue;
    if (key === "date") bits |= HEADER_DATE;
    else if (key === "connection") {
      bits |= HEADER_CONNECTION;
      if (RE_CONN_CLOSE.test($isArray(value) ? value.join(", ") : String(value))) {
        res._last = true;
      }
    } else if (key === "keep-alive") bits |= HEADER_KEEP_ALIVE;
    else if (key === "transfer-encoding") bits |= HEADER_TRANSFER_ENCODING;
    else if (key === "content-length") bits |= HEADER_CONTENT_LENGTH;
    pushRenderedHeader(flat, res, key, entries[i + 1] as string, value);
  }
  return bits;
}

function transferEncodingAmong(entries: unknown[]): unknown {
  for (let i = 0; i < entries.length; i += 3) {
    if (entries[i] === "transfer-encoding") return entries[i + 2];
  }
}

// `isItself`: `res` is the response of `exchange`, and no proxy or heir of it.
function renderNativeHeaders(res: $Node.ServerResponse, exchange: Exchange | undefined, isItself: boolean): unknown[] {
  let autoHeaders = 0;
  let keepAliveSecs = 0;
  let bits = isItself ? exchange!.headerBits : HEADER_SPILLED;
  let flat: unknown[];
  let entries: unknown[] | undefined;
  if ((bits & HEADER_UNUSUAL) === 0) {
    // The bits of headers in the compact form say which of them frame the response: nobody walks them.
    flat = flatHeadersOf(exchange!);
  } else {
    flat = [];
    entries = headerEntriesOf(exchange, res);
    bits = entries === undefined ? HEADER_MAP_IS_MISSING : renderHeadersInto(flat, res, entries);
  }
  const hasTransferEncoding = (bits & HEADER_TRANSFER_ENCODING) !== 0;
  const hasContentLength = (bits & HEADER_CONTENT_LENGTH) !== 0;

  if (res.sendDate && (bits & HEADER_DATE) === 0) {
    autoHeaders |= AUTO_HEADER_DATE;
  }

  // The headers that frame the body are looked for in the map of headers.
  if ((bits & HEADER_MAP_IS_MISSING) !== 0)
    throw new TypeError("undefined is not an object (evaluating 'headers[name]')");

  let defectiveNoBodyResponse = false;
  if (hasTransferEncoding) {
    const statusCode = statusCodeToSend(res);
    if (statusCode === 204 || statusCode === 304) {
      defectiveNoBodyResponse = true;
      res._last = true;
    }
  }

  let closeDelimited = false;
  let forceChunked = false;
  const chunkedByDefault = !!res.useChunkedEncodingByDefault;
  const canPersist = chunkedByDefault || hasContentLength;
  if (!hasContentLength && !hasTransferEncoding) {
    if (res._hasBody === false) {
    } else if (!chunkedByDefault) {
      closeDelimited = true;
      res._last = true;
    } else if (res._removedTE) {
      closeDelimited = true;
      res._last = true;
    } else if (res._removedContLen || (isItself ? exchange!.isFrozenChunked : res[kFramingFrozenChunked])) {
      if ($callNoInline(takesChunks, undefined, res.req)) {
        forceChunked = true;
      } else {
        closeDelimited = true;
        res._last = true;
      }
    }
  } else if (hasTransferEncoding && res._hasBody !== false) {
    // Node's matchHeader frames the body by the Transfer-Encoding value.
    if (chunkExpression.test(String(transferEncodingAmong(entries!)))) {
      autoHeaders |= AUTO_HEADER_BODY_CHUNKED;
    } else if (!hasContentLength) {
      // Node sends this body raw on a keep-alive connection, so the client can't tell where it ends. Close instead (RFC 9112 6.3).
      closeDelimited = true;
      res._last = true;
    }
  }

  // Node's writeHead(): the client may never send the body, so a final response with no 100 Continue closes the connection.
  if (res._expect_continue && !res._sent100 && (bits & HEADER_CONNECTION) === 0) res.shouldKeepAlive = false;

  if (res._removedConnection) {
    if (res.shouldKeepAlive === false) {
      res._last = true;
    }
  } else if ((bits & HEADER_CONNECTION) === 0) {
    if (
      !defectiveNoBodyResponse &&
      !closeDelimited &&
      canPersist &&
      !res.maxRequestsOnConnectionReached &&
      res.shouldKeepAlive !== false &&
      requestShouldKeepAlive(res.req)
    ) {
      const keepAliveTimeout = res._keepAliveTimeout;
      const maxRequestsPerSocket = res._maxRequestsPerSocket;
      if (keepAliveTimeout && (bits & HEADER_KEEP_ALIVE) === 0) {
        let timeoutSecs = lastKeepAliveSecs;
        if (keepAliveTimeout !== lastKeepAliveTimeout) {
          timeoutSecs = MathFloor(keepAliveTimeout / 1000);
          if (typeof keepAliveTimeout === "number") {
            lastKeepAliveSecs = timeoutSecs;
            lastKeepAliveTimeout = keepAliveTimeout;
          }
        }
        const hasMax = maxRequestsPerSocket != null && ~~maxRequestsPerSocket > 0;
        if (!hasMax && timeoutSecs >= 0 && timeoutSecs <= kMaxNativeKeepAliveSecs) {
          autoHeaders |= AUTO_HEADER_CONN_KEEP_ALIVE | AUTO_HEADER_KEEP_ALIVE_TIMEOUT;
          keepAliveSecs = timeoutSecs;
        } else {
          flat = withRoomFor(flat);
          flat.push("Connection", "keep-alive");
          flat.push(
            "Keep-Alive",
            hasMax ? `timeout=${timeoutSecs}, max=${maxRequestsPerSocket}` : `timeout=${timeoutSecs}`,
          );
        }
      } else {
        autoHeaders |= AUTO_HEADER_CONN_KEEP_ALIVE;
      }
    } else {
      if (res.shouldKeepAlive === false || !canPersist) {
        res._last = true;
      }
      autoHeaders |= AUTO_HEADER_CONN_CLOSE;
    }
  }

  if (res._hasBody === false) {
    // HEAD, 204, 304, 1xx. The framing headers the user set are still sent, but the response ends at the first empty line (RFC 9112 6.3).
    autoHeaders |= AUTO_HEADER_BODY_NONE;
  } else if (closeDelimited) {
    autoHeaders |= AUTO_HEADER_BODY_UNTIL_CLOSE;
  } else if (forceChunked) {
    autoHeaders |= AUTO_HEADER_TRANSFER_ENCODING_CHUNKED | AUTO_HEADER_BODY_CHUNKED;
  }
  renderedAutoHeaders = autoHeaders;
  renderedKeepAliveSecs = keepAliveSecs;
  return flat;
}

function stopServerResponsePerf(this: $Node.ServerResponse) {
  if (this[kServerResponseStatistics] && hasObserver("http")) {
    stopPerf(this, kServerResponseStatistics, {
      detail: {
        res: {
          statusCode: this.statusCode,
          statusMessage: this.statusMessage,
          headers: typeof this.getHeaders === "function" ? this.getHeaders() : {},
        },
      },
    });
  }
}

// Node.js's resOnFinish as one shared listener: connection handling (close or
// arm keep-alive) runs first because onResponseFinishHandleSocket's guards
// read pre-detach state, then detach the socket and advance the pipeline.
function emitResponseFinish(this: $Node.ServerResponse) {
  const exchange = this.$exchange;
  const isItself = exchange !== undefined && exchange.response === this;
  const req = this.req;
  if (isItself && (exchange.flags & EXCHANGE_FINISHES_HERE) !== 0) {
    if (exchange.requestKind === REQUEST_OTHER && !isResumeScheduled(req._readableState)) {
      exchange.flags &= ~EXCHANGE_FINISHES_HERE;
      req._dump();
    }
    finishConnection(exchange, this, req, exchange.connection!, false);
    return;
  }
  // Node's resOnFinish: dump a body that nobody consumed or resumed.
  if (req && !req._consuming && !isResumeScheduled(req._readableState)) {
    req._dump();
  }
  // The stream destroyer nulls req.socket (pipeline, compose). The response's own socket still is the connection then.
  const detachedFrom = isItself ? exchange.detachedFrom : (this[kDetachedFrom] ?? null);
  const socket: $Node.HttpServerSocket | null | undefined = (detachedFrom ?? this.req?.socket ?? this.socket) as any;
  // Node's clearIncoming: a request that ended before its response did, or that gets no EOF. Any other one is cleared at its EOF.
  const parser = socket?.parser;
  if (parser != null && parser.incoming === req && (req.readableEnded || req.destroyed)) parser.incoming = null;
  onResponseFinishHandleSocket(socket?.server as unknown as $Node.HttpServer | null | undefined, socket, this);
  // The dispatcher detached a response that finished synchronously. Sending the next one again here would skip one.
  if (detachedFrom !== null) return;
  if (socket != null) this.detachSocket(socket);
  sendNextResponseIfAny(socket);
}

function isResumeScheduled(state: $Node.ReadableState | null | undefined) {
  if (state == null) return false;
  const flags = flagsOf(state);
  return typeof flags === "number" ? (flags & kResumeScheduled) !== 0 : state.resumeScheduled;
}

// After a response that the native handle wrote.
function sendNextResponseIfAny(socket: $Node.HttpServerSocket | null | undefined) {
  const state = socket?.[kConnectionState];
  if (state !== undefined && !socket!.writableEnded && !socket!.destroyed) sendNextResponse(socket!, state);
}

function sendNextResponseIfIdle(socket: $Node.HttpServerSocket) {
  if (socket._httpMessage == null) sendNextResponseIfAny(socket);
}

// Holds the turn of a request that has no response. If none comes, nothing can be sent in its place.
const kNoResponse: ResponseTurn = { destroyed: true, destroy() {} };

// The transport half of Node's resOnFinish: end the connection, or arm the keep-alive idle timeout.
function onResponseFinishHandleSocket(
  server: $Node.HttpServer | null | undefined,
  socket: $Node.HttpServerSocket | null | undefined,
  res: $Node.ServerResponse,
) {
  if (res._last) {
    socket?.destroySoon();
    return;
  }
  if (!socket || socket.destroyed) {
    return;
  }
  // Another response is in flight on this connection (pipelining), so it isn't idle.
  const inFlight = socket._httpMessage;
  if (inFlight && inFlight !== res) {
    return;
  }
  // Pipelined responses are queued behind this one, so the connection isn't idle yet.
  if (socket[kConnectionState]?.outgoing.length) {
    return;
  }
  const total = keepAliveIdleTimeout(server!);
  if (total) {
    // A timer armed with this interval stays, which saves a reschedule per response. onSocketTimeoutTimerExpired grants what is left of the idle period.
    socket[kLastResponseWrite] = timerClockMs();
    const timer = socket[kTimeout];
    if (timer != null && !timer._destroyed && timer._idleTimeout === total) {
      socket.timeout = total;
    } else {
      socket.setTimeout(total);
    }
    socket[kKeepAliveTimeoutSet] = true;
  }
}

// Node's socketOnClose frees the parser, which stops the parsing of pipelined requests in the buffer, even when a program emitted 'close'.
function onSocketCloseStopParsing(this: $Node.HttpServerSocket) {
  this[kHandle]?.stopParsing?.();
}

// Native dispatch bitfield: presence/token bits for the request headers the
// dispatcher consults, computed in one native pass over the raw headers
// (kDispatch* in src/jsc/bindings/NodeHTTP.cpp - keep in sync). This is what
// lets the framework never materialize req.headers/req.rawHeaders unless
// user code reads them.
const DISPATCH_CONN_CLOSE = 1 << 0;
const DISPATCH_CONN_UPGRADE = 1 << 1;
const DISPATCH_HAS_UPGRADE = 1 << 2;
const DISPATCH_HAS_HOST = 1 << 3;
const DISPATCH_HAS_EXPECT = 1 << 4;
const DISPATCH_EXPECT_CONTINUE = 1 << 5;
const DISPATCH_HAS_CONTENT_LENGTH = 1 << 6;
const DISPATCH_HAS_TRANSFER_ENCODING = 1 << 7;
const DISPATCH_USUAL_MASK = DISPATCH_CONN_CLOSE | DISPATCH_HAS_UPGRADE | DISPATCH_HAS_HOST | DISPATCH_HAS_EXPECT;

// Whether the response should advertise a persistent connection.
// `connection` is the request's Connection header value (or undefined).
function shouldKeepAliveForConnection(
  req: $Node.IncomingMessage | null | undefined,
  connection: string | string[] | undefined,
) {
  if (!req) return true;
  if (req.httpVersionMajor === 1 && req.httpVersionMinor === 0) {
    // The native server always closes HTTP/1.0 connections after the
    // response, even when the request asked for keep-alive, so the response
    // must advertise Connection: close to stay consistent with the transport.
    // (Node.js answers Connection: close here too whenever it cannot frame
    // the response without closing, which is the common case for HTTP/1.0.)
    return false;
  }
  return !(typeof connection === "string" && RE_CONN_CLOSE.test(connection));
}

// shouldKeepAliveForConnection(), computed once at dispatch: reading req.headers again would materialize the lazy header object.

function requestShouldKeepAlive(req: $Node.IncomingMessage | null | undefined) {
  if (!req) return true;
  const cached = req[kReqShouldKeepAlive];
  if (cached !== undefined) return cached;
  return (req[kReqShouldKeepAlive] = shouldKeepAliveForConnection(req, req.headers.connection));
}

// res.headers / res.headers= are Bun-specific conveniences kept for backwards
// compatibility; they are views over the Node.js-style header storage.
Object.defineProperty(ServerResponse.prototype, "headers", {
  get(this: $Node.ServerResponse) {
    return this.getHeaders();
  },
  set(
    this: $Node.ServerResponse,
    value:
      | [name: string, value: $Node.HttpHeaderValue][]
      | { entries(): Iterable<[name: string, value: $Node.HttpHeaderValue]> }
      | Record<string, $Node.HttpHeaderValue>
      | null
      | undefined,
  ) {
    if (this._header) throw $ERR_HTTP_HEADERS_SENT("set");
    spillHeadersOf(this);
    this[kOutHeaders] = null;
    if (!value) return;
    if ($isArray(value)) {
      // Array of [name, value] pairs, like the WHATWG Headers sequence init.
      for (const { 0: key, 1: val } of value) {
        this.appendHeader(key, snapshotHeaderValue(val));
      }
    } else if (typeof value.entries === "function") {
      for (const { 0: key, 1: val } of value.entries()) {
        this.appendHeader(key, snapshotHeaderValue(val));
      }
    } else {
      const keys = ObjectKeys(value);
      for (let i = 0; i < keys.length; i++) {
        this.setHeader(keys[i], value[keys[i]]);
      }
    }
  },
});

Object.defineProperty(ServerResponse.prototype, "socket", {
  get(this: $Node.ServerResponse) {
    // null while the response is queued behind a pipelined one, like Node.js.
    const socket = this[fakeSocketSymbol];
    return socket !== undefined ? socket : (this[fakeSocketSymbol] = new FakeSocket(this));
  },
  set(this: $Node.ServerResponse, value: $Node.HttpSocket | null) {
    this[fakeSocketSymbol] = value ?? undefined;
    outgoingSocketSetter.$call(this, value);
  },
});

Object.defineProperty(ServerResponse.prototype, "connection", {
  get(this: $Node.ServerResponse) {
    return this.socket;
  },
  set(this: $Node.ServerResponse, value: $Node.HttpSocket | null) {
    this.socket = value;
  },
});

Object.defineProperty(ServerResponse.prototype, "writableCorked", {
  get(this: $Node.ServerResponse) {
    if (!this[kHandle]) return outgoingWritableCorked!.$call(this);
    return this.socket?.writableCorked ?? 0;
  },
  set(_value) {},
});

ServerResponse.prototype.cork = function cork(this: $Node.ServerResponse) {
  if (!this[kHandle]) return OutgoingMessagePrototype.cork.$call(this);
  this.socket?.cork();
};

ServerResponse.prototype.uncork = function uncork(this: $Node.ServerResponse) {
  if (!this[kHandle]) return OutgoingMessagePrototype.uncork.$call(this);
  this.socket?.uncork();
};

ServerResponse.prototype._ended = false;

// The end() callback (or null) while the body end() buffered is still draining.
ServerResponse.prototype[kPendingFinish] = undefined;

ServerResponse.prototype._writeRaw = function (
  this: $Node.ServerResponse,
  chunk: $Node.HttpChunk,
  encoding?: string | null,
  callback?: $Node.HttpWriteCallback | null,
) {
  if (!this[kHandle]) {
    // Standalone path: OutgoingMessage._writeRaw buffers to outputData while
    // no socket is assigned yet (kSocket is null) and flushes the buffer
    // ahead of the chunk once one is - writing through the auto-creating
    // `socket` getter here would drop the bytes into a FakeSocket.
    return OutgoingMessagePrototype._writeRaw.$apply(this, arguments);
  }
  // Write through the response handle's AsyncSocket buffer (same path as
  // writeHead/end) so 1xx lines share ordering with the final response bytes;
  // socket.write() would land in the socket handle's separate stream buffer.
  this[kHandle].writeInformational(chunk, encoding);
  noteResponseWrite(this);
  if (typeof callback === "function") process.nextTick(callback);
  return true;
};

ServerResponse.prototype.writeEarlyHints = function (
  this: $Node.ServerResponse,
  hints: Record<string, string | string[]>,
  cb?: $Node.HttpWriteCallback,
) {
  validateObject(hints, "hints");

  if (hints.link === null || hints.link === undefined) {
    return;
  }

  const link = validateLinkHeaderValue(hints.link);

  if (link.length === 0) {
    return;
  }

  if (checkInvalidHeaderChar(link)) {
    throw $ERR_INVALID_CHAR("header content", "Link");
  }

  const headers = { __proto__: null, Link: link } as unknown as $Node.Dictionary<string | string[]>;
  const keys = ObjectKeys(hints);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key !== "link") {
      headers[key] = hints[key];
    }
  }

  this.writeInformation(103, headers, cb);
};

function processInformationHeader(name: string, value: $Node.HttpHeaderValue) {
  validateHeaderName(name);
  validateHeaderValue(name, value);
  return `${name}: ${value}\r\n`;
}

ServerResponse.prototype.writeInformation = function writeInformation(
  this: $Node.ServerResponse,
  statusCode: number,
  headers?: $Node.HttpHeadersInit | null,
  cb?: $Node.HttpWriteCallback,
) {
  if (this.headersSent) {
    throw $ERR_HTTP_HEADERS_SENT("write");
  }

  validateInteger(statusCode, "statusCode", 100, 199);
  if (statusCode === 101) {
    throw $ERR_HTTP_INVALID_STATUS_CODE(statusCode);
  }

  const statusMessage = STATUS_CODES[statusCode] || "unknown";
  let head = `HTTP/1.1 ${statusCode} ${statusMessage}\r\n`;

  if (headers !== undefined && headers !== null) {
    if ($isArray(headers)) {
      const headersLength = headers.length;
      if (headersLength && $isArray(headers[0])) {
        for (let i = 0; i < headersLength; i++) {
          const entry = headers[i];
          head += processInformationHeader(entry[0], entry[1]);
        }
      } else {
        if (headersLength % 2 !== 0) {
          throw $ERR_INVALID_ARG_VALUE("headers", headers);
        }
        for (let i = 0; i < headersLength; i += 2) {
          head += processInformationHeader((headers as string[])[i], (headers as string[])[i + 1]);
        }
      }
    } else {
      validateObject(headers, "headers");
      const keys = ObjectKeys(headers);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        head += processInformationHeader(key, headers[key]);
      }
    }
  }

  head += "\r\n";

  return this._writeRaw(head, "ascii", cb);
};

ServerResponse.prototype.writeProcessing = function (this: $Node.ServerResponse, cb?: $Node.HttpWriteCallback) {
  return this.writeInformation(102, null, cb);
};

ServerResponse.prototype.writeContinue = function (this: $Node.ServerResponse, cb?: () => void) {
  if (this.headersSent) {
    throw $ERR_HTTP_HEADERS_SENT("write");
  }
  if (!this[kHandle]) {
    // Through writeInformation() like Node.js v26.3.0, so the line waits in outputData until a socket is assigned.
    this.writeInformation(100, null, cb);
    this._sent100 = true;
    return;
  }
  this[kHandle].writeContinue();
  noteResponseWrite(this);
  this._sent100 = true;
  if (typeof cb === "function") process.nextTick(cb);
};

// A response takes what its native handle takes, whatever carries it. OutgoingMessage takes a string or a Uint8Array.
function toOutgoingChunk(res: $Node.ServerResponse, chunk: any) {
  if (typeof chunk === "string" || typeof chunk === "function" || chunk == null) return chunk;
  if (!res._header) updateHasBody(res, res.statusCode);
  if (!res._hasBody) return "";
  if (ArrayBufferIsView(chunk)) {
    return chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  const { isAnyArrayBuffer, isStringObject } = require("node:util/types");
  if (isAnyArrayBuffer(chunk)) return new Uint8Array(chunk);
  return isStringObject(chunk) ? `${chunk}` : chunk;
}

function finishExchangeInSteps(exchange: Exchange, flags: number): void {
  let callback: $Node.HttpWriteCallback | null = null;
  if ((flags & EXCHANGE_HAS_END_CALLBACK) !== 0) {
    callback = exchange.endCallback;
    exchange.endCallback = null;
    exchange.flags &= ~EXCHANGE_HAS_END_CALLBACK;
  }
  return emitResponseFinished(exchange.response, callback);
}

// The ticks of the full road, for a response that takes no stores. They run next, one after the other.
function finishExchangeTickByTick(exchange: Exchange, flags: number): void {
  const { queueTickInFront } = require("internal/process/tick_ring");
  const res = exchange.response;
  queueTickInFront(finishExchangeInSteps, 2, exchange, flags);
  queueTickInFront(markResponseEndedNT, 1, res, undefined);
}

const finishExchange = function emitResponseFinished(exchange: Exchange): void {
  const flags = exchange.flags;
  const res = exchange.response;
  let takesStores = true;
  try {
    res._ended = true;
  } catch {
    takesStores = false;
  }
  if (!takesStores) {
    ("unlikely");
    return finishExchangeTickByTick(exchange, flags);
  }
  const req = res.req;
  const socket = exchange.connection;
  const requestState = exchange.requestState;
  if (
    res._last ||
    socket === null ||
    req == null ||
    requestState == null ||
    req._readableState !== requestState ||
    req._events == null ||
    res._closed ||
    !holdsNothing(res) ||
    !ticksAreUnhooked() ||
    !emitsUnseen(res) ||
    (exchange.detachedFrom === null && !detachesItself(res)) ||
    !removesListenersUnseen(socket) ||
    req.socket !== socket ||
    !isAtRest(socket)
  ) {
    ("unlikely");
    return finishExchangeInSteps(exchange, flags);
  }
  const inFlight = socket._httpMessage;
  const server = socket.server as unknown as $Node.HttpServer;
  if (server == null || (inFlight && inFlight !== res)) {
    ("unlikely");
    return finishExchangeInSteps(exchange, flags);
  }
  const keepAliveTimeout = server.keepAliveTimeout;
  const keepAliveTimeoutBuffer = server.keepAliveTimeoutBuffer;
  if (
    typeof keepAliveTimeout !== "number" ||
    typeof keepAliveTimeoutBuffer !== "number" ||
    !(keepAliveTimeout > 0) ||
    !(keepAliveTimeoutBuffer >= 0) ||
    !(keepAliveTimeout + keepAliveTimeoutBuffer < Infinity)
  ) {
    ("unlikely");
    return finishExchangeInSteps(exchange, flags);
  }
  const idleTimeout = keepAliveTimeout + keepAliveTimeoutBuffer;
  if (!isArmedFor(socket, idleTimeout) && socket.setTimeout !== netSocketSetTimeout) {
    ("unlikely");
    return finishExchangeInSteps(exchange, flags);
  }
  const isSilent = (flags & EXCHANGE_HAS_END_CALLBACK) === 0 && isUnheard(res, exchange);
  if (!isSilent && !finishesFirst(res)) {
    ("unlikely");
    return finishExchangeInSteps(exchange, flags);
  }
  const isConsumed = req._consuming;
  const isAlone = ring.read === ring.write || (isSilent && isConsumed && takeRequestCloseTick(req));
  const kind = isConsumed
    ? REQUEST_CONSUMED
    : isAlone && resumesUnseen(socket) && endsUnseen(req)
      ? REQUEST_UNSEEN
      : mayDumpInPlace(req)
        ? REQUEST_DUMPED_IN_PLACE
        : REQUEST_OTHER;
  exchange.idleTimeout = idleTimeout;
  exchange.requestKind = kind;
  if (!isAlone) {
    ("unlikely");
    return finishExchangeAmongOthers(exchange, res, req, socket, flags, isSilent);
  }
  if (isSilent && (kind === REQUEST_UNSEEN || kind === REQUEST_CONSUMED)) {
    try {
      if (kind === REQUEST_UNSEEN) endUnseen(req);
      finishConnection(exchange, res, req, socket, true);
    } catch {
      takesStores = false;
    }
    if (!takesStores) {
      ("unlikely");
      return finishExchangeInSteps(exchange, flags);
    }
    res.destroyed = true;
    res._closed = true;
    settleDispatchAtClose(res);
    return;
  }
  return finishHeardExchange(exchange, res, req, flags);
};

function finishesFirst(res: $Node.ServerResponse): boolean {
  const events = res._events as any;
  if (events == null) return false;
  const finish = events.finish;
  return (
    finish === emitResponseFinish || (typeof finish === "object" && finish !== null && finish[0] === emitResponseFinish)
  );
}

// Whether the timer of the socket runs with this interval, so that it stays as it is.
function isArmedFor(socket: $Node.HttpServerSocket, idleTimeout: number): boolean {
  const timer = socket[kTimeout];
  return timer != null && !timer._destroyed && timer._idleTimeout === idleTimeout;
}

const finishConnection = function onResponseFinishHandleSocket(
  exchange: Exchange,
  res: $Node.ServerResponse,
  req: $Node.IncomingMessage,
  socket: $Node.HttpServerSocket,
  isSilent: boolean,
): void {
  const kind = exchange.requestKind;
  const parser = socket.parser;
  if (kind === REQUEST_UNSEEN) {
    if (isSilent) {
      if (parser != null && parser.incoming === req) parser.incoming = null;
    } else {
      exchange.flags = (exchange.flags & ~EXCHANGE_FINISHES_HERE) | EXCHANGE_REQUEST_WAITS;
      beginUnseenDump(req);
    }
  } else if (kind === REQUEST_DUMPED_IN_PLACE) {
    const flags = exchange.flags & ~EXCHANGE_FINISHES_HERE;
    beginDump(req);
    if ((flags & EXCHANGE_OTHERS_WAIT) !== 0) {
      exchange.flags = flags;
      queueDump(req, exchange.requestState!);
    } else {
      exchange.flags = flags | EXCHANGE_REQUEST_WAITS;
    }
  } else {
    exchange.flags &= ~EXCHANGE_FINISHES_HERE;
    if (kind === REQUEST_OTHER && !isResumeScheduled(req._readableState)) req._dump();
    if (parser != null && parser.incoming === req && (req.readableEnded || req.destroyed)) parser.incoming = null;
  }
  const idleTimeout = exchange.idleTimeout;
  socket[kLastResponseWrite] = timerClockMs();
  if (isArmedFor(socket, idleTimeout)) socket.timeout = idleTimeout;
  else {
    ("unlikely");
    socket.setTimeout(idleTimeout);
  }
  socket[kKeepAliveTimeoutSet] = true;
  if (exchange.detachedFrom === null) {
    if (socket._httpMessage === res) {
      socket[kCloseCallback] = undefined;
      socket._httpMessage = null;
    }
    res[fakeSocketSymbol] = undefined;
    res[kSocket] = null;
  }
};

function queueRestOfExchange(
  exchange: Exchange,
  res: $Node.ServerResponse,
  req: $Node.IncomingMessage,
  closes: boolean,
) {
  const flags = exchange.flags;
  exchange.flags = flags & ~(EXCHANGE_FINISHES_HERE | EXCHANGE_REQUEST_WAITS);
  if (closes) queueTick1(emitCloseNT, res);
  if ((flags & EXCHANGE_REQUEST_WAITS) !== 0) queueDump(req, exchange.requestState!);
}

const finishExchangeAmongOthers = function emitResponseFinished(
  exchange: Exchange,
  res: $Node.ServerResponse,
  req: $Node.IncomingMessage,
  socket: $Node.HttpServerSocket,
  flags: number,
  isSilent: boolean,
): void {
  queueTick1(emitCloseNT, res);
  exchange.flags |= EXCHANGE_FINISHES_HERE | EXCHANGE_OTHERS_WAIT;
  if (isSilent) {
    finishConnection(exchange, res, req, socket, false);
    return;
  }
  try {
    res.emit("finish");
  } finally {
    exchange.flags &= ~EXCHANGE_FINISHES_HERE;
  }
  if ((flags & EXCHANGE_HAS_END_CALLBACK) !== 0) {
    const callback = exchange.endCallback!;
    exchange.endCallback = null;
    exchange.flags &= ~EXCHANGE_HAS_END_CALLBACK;
    try {
      callback();
    } catch (err) {
      res.emit("error", err);
    }
  }
};

const finishHeardExchange = function emitResponseFinished(
  exchange: Exchange,
  res: $Node.ServerResponse,
  req: $Node.IncomingMessage,
  flags: number,
): void {
  exchange.flags |= EXCHANGE_FINISHES_HERE;
  try {
    res.emit("finish");
    if ((flags & EXCHANGE_HAS_END_CALLBACK) !== 0) {
      const callback = exchange.endCallback!;
      exchange.endCallback = null;
      exchange.flags &= ~EXCHANGE_HAS_END_CALLBACK;
      try {
        callback();
      } catch (err) {
        res.emit("error", err);
      }
    }
  } catch (error) {
    queueRestOfExchange(exchange, res, req, true);
    throw error;
  }
  if (!ticksAreUnhooked()) {
    queueRestOfExchange(exchange, res, req, true);
    return;
  }
  try {
    emitCloseNT(res);
  } catch (error) {
    queueRestOfExchange(exchange, res, req, false);
    throw error;
  }
  if ((exchange.flags & EXCHANGE_REQUEST_WAITS) !== 0) {
    exchange.flags &= ~EXCHANGE_REQUEST_WAITS;
    const state = exchange.requestState!;
    if (!ticksAreUnhooked()) {
      queueDump(req, state);
    } else if (
      exchange.requestKind === REQUEST_UNSEEN &&
      ring.read === ring.write &&
      req._readableState === state &&
      resumesUnseen(exchange.connection!) &&
      isAtRest(exchange.connection!) &&
      staysUnseen(req)
    ) {
      const parser = req.socket?.parser;
      if (parser != null && parser.incoming === req) parser.incoming = null;
      endUnseen(req);
    } else {
      continueDump(req, state);
    }
  }
};

function emitsUnseen(res: $Node.ServerResponse): boolean {
  return res.emit === responseEmit && StreamPrototype.emit === eventEmitterEmit;
}

// Whether emit("close") would find nothing whose callbacks it has to fail first.
function holdsNothing(res: $Node.ServerResponse): boolean {
  return res.outputData.length === 0 && res[kChunkedBuffer].length === 0 && res[kPendingCallbacks].length === 0;
}

function resumesUnseen(socket: $Node.HttpServerSocket): boolean {
  return socket.resume === netSocketResume && DuplexPrototype.resume === duplexResume && readsFlowUnseen(socket);
}

// Whether a read of that name on the socket reaches the accessor of Duplex.prototype: neither the socket nor a prototype in front of it has such a property.
function reachesDuplexPrototype(socket: $Node.HttpServerSocket, name: string): boolean {
  return (
    !ObjectHasOwn(socket, name) && !ObjectHasOwn(connectionPrototype!, name) && !ObjectHasOwn(netSocketPrototype!, name)
  );
}

// The same for an accessor of Readable.prototype.
function reachesReadablePrototype(socket: $Node.HttpServerSocket, name: string): boolean {
  return reachesDuplexPrototype(socket, name) && !ObjectHasOwn(DuplexPrototype, name);
}

function hasThePrototypesOfItsClass(socket: $Node.HttpServerSocket): boolean {
  return (
    ObjectGetPrototypeOf(socket) === connectionPrototype &&
    ObjectGetPrototypeOf(connectionPrototype) === netSocketPrototype &&
    ObjectGetPrototypeOf(netSocketPrototype) === DuplexPrototype &&
    ObjectGetPrototypeOf(DuplexPrototype) === ReadablePrototype
  );
}

function readsFlowUnseen(socket: $Node.HttpServerSocket): boolean {
  if (!(
    IS_COMPILED_AHEAD_OF_TIME &&
    ObjectGetPrototypeOf(socket) === connectionPrototype &&
    $findsDeclaredMember(socket, "readable") &&
    $findsDeclaredMember(socket, "readableLength") &&
    $findsDeclaredMember(socket, "readableHighWaterMark") &&
    $findsDeclaredMember(socket, "readableEnded") &&
    $findsDeclaredMember(socket, "destroyed")
  )) {
    ("unlikely");
    return walksToAccessorsOfFlow(socket);
  }
  return true;
}

function walksToAccessorsOfFlow(socket: $Node.HttpServerSocket): boolean {
  return (
    hasThePrototypesOfItsClass(socket) &&
    reachesReadablePrototype(socket, "readable") &&
    reachesReadablePrototype(socket, "readableLength") &&
    reachesReadablePrototype(socket, "readableHighWaterMark") &&
    reachesReadablePrototype(socket, "readableEnded") &&
    reachesDuplexPrototype(socket, "destroyed")
  );
}

function readsHighWaterMarksUnseen(socket: $Node.HttpServerSocket): boolean {
  if (!(
    IS_COMPILED_AHEAD_OF_TIME &&
    ObjectGetPrototypeOf(socket) === connectionPrototype &&
    $findsDeclaredMember(socket, "readableHighWaterMark") &&
    $findsDeclaredMember(socket, "writableHighWaterMark")
  )) {
    ("unlikely");
    return walksToHighWaterMarks(socket);
  }
  return true;
}

function walksToHighWaterMarks(socket: $Node.HttpServerSocket): boolean {
  return (
    hasThePrototypesOfItsClass(socket) &&
    reachesReadablePrototype(socket, "readableHighWaterMark") &&
    reachesDuplexPrototype(socket, "writableHighWaterMark")
  );
}

function readsItsEndUnseen(socket: $Node.HttpServerSocket): boolean {
  if (!(
    IS_COMPILED_AHEAD_OF_TIME &&
    ObjectGetPrototypeOf(socket) === connectionPrototype &&
    $findsDeclaredMember(socket, "destroyed") &&
    $findsDeclaredMember(socket, "writableEnded")
  )) {
    ("unlikely");
    return walksToAccessorsOfItsEnd(socket);
  }
  return true;
}

function walksToAccessorsOfItsEnd(socket: $Node.HttpServerSocket): boolean {
  return (
    hasThePrototypesOfItsClass(socket) &&
    reachesDuplexPrototype(socket, "destroyed") &&
    reachesDuplexPrototype(socket, "writableEnded")
  );
}

function detachesItself(res: $Node.ServerResponse): boolean {
  return res.detachSocket === responseDetachSocket && reachesSocket(res) && !(res[kCorked] > 0);
}

// Whether `res[name]` reaches the accessor that ServerResponse.prototype has under that name. None of them is configurable.
function inheritsFromResponsePrototype(res: $Node.ServerResponse, name: string): boolean {
  let level: object | null = ObjectGetPrototypeOf(res);
  if (level !== ServerResponsePrototype) {
    ("unlikely");
    do {
      if (level === null || ObjectHasOwn(level, name)) return false;
      level = ObjectGetPrototypeOf(level);
    } while (level !== ServerResponsePrototype);
  }
  return true;
}

function reachesSocket(res: $Node.ServerResponse): boolean {
  return !ObjectHasOwn(res, "socket") && inheritsFromResponsePrototype(res, "socket");
}

function callsPendingCallbacksUnseen(res: $Node.ServerResponse): boolean {
  return res._callPendingCallbacks === responseCallPendingCallbacks;
}

function removesListenersUnseen(socket: $Node.HttpSocket): boolean {
  return (
    socket.removeListener === duplexRemoveListener && StreamPrototype.removeListener === eventEmitterRemoveListener
  );
}

function readsDestroyedUnseen(socket: $Node.HttpServerSocket): boolean {
  const state = socket.$ownReadableState;
  return state !== undefined && socket._readableState === state && readsItsEndUnseen(socket);
}

function isAtRest(socket: $Node.HttpServerSocket): boolean {
  const state = socket.$ownReadableState;
  return (
    socket[kHandle] !== undefined &&
    !socket._paused &&
    socket.parser != null &&
    socket[kConnectionState] === undefined &&
    !socket[kHandedOff] &&
    state !== undefined &&
    socket._readableState === state &&
    (flagsOf(state) & kSocketFlowMask) === kSocketFlows &&
    readsItsEndUnseen(socket)
  );
}

// Like Node, 'prefinish' fires but 'finish' never does, and the close of the socket aborts the request.
function endWithoutSocket(res: $Node.ServerResponse, countsAsSent: boolean): $Node.ServerResponse {
  if (countsAsSent) {
    res._header = " ";
    res._headerSent = true;
  }
  res.finished = true;
  queueTick1(markResponseEndedNT, res);
  res.emit("prefinish");
  return res;
}

// Like Node's end(), fully uncork the socket. A leftover cork would buffer a later 'connect' or 'upgrade' listener's writes forever.
function uncorkSocketOf(res: $Node.ServerResponse): void {
  const socket = res[kSocket];
  const socketWritableState = socket?._writableState;
  if (socketWritableState?.corked) {
    ("unlikely");
    socketWritableState.corked = 1;
    socket!.uncork();
  }
}

ServerResponse.prototype.end = function (
  this: $Node.ServerResponse,
  chunk?: $Node.HttpChunk | null | $Node.HttpWriteCallback,
  encoding?: string | null | $Node.HttpWriteCallback,
  callback?: $Node.HttpWriteCallback | null,
) {
  const exchange = this.$exchange;
  if (exchange === undefined || exchange.response !== this) {
    ("unlikely");
    return endInFull(this, exchange, chunk, encoding, callback);
  }
  const handle = this[kHandle];
  if (!handle || this.finished || this.destroyed) {
    ("unlikely");
    return endInFull(this, exchange, chunk, encoding, callback);
  }

  if ($isCallable(chunk)) {
    callback = chunk;
    chunk = undefined;
    encoding = undefined;
  } else if ($isCallable(encoding)) {
    callback = encoding;
    encoding = undefined;
  } else if (!$isCallable(callback)) {
    callback = undefined;
  }

  if (!this._header) validateImplicitHead(this);
  if (chunk && !this._hasBody) {
    ("unlikely");
    if (this[kRejectNonStandardBodyWrites]) {
      throw $ERR_HTTP_BODY_NOT_ALLOWED();
    } else {
      chunk = undefined;
    }
  }

  const trailer = this._trailer;
  if (trailer) {
    ("unlikely");
    if (this._hasBody && willBeChunked(this)) this.socket?.[kHandle]?.setResponseTrailers(trailer);
  }

  callWriteHeadIfObservable(this, true);
  let flags = exchange.flags;

  if ((handle.flags & NodeHTTPResponseFlags.closed_or_completed) !== 0) {
    ("unlikely");
    return endWithoutSocket(this, true);
  }
  let draining = false;
  // A replaced writeHead() can have sent the head itself, with write().
  if (!this._headerSent) {
    const renderedHeaders = renderNativeHeaders(this, exchange, true) as string[];
    const hasSnapshot = (flags & EXCHANGE_HAS_SNAPSHOT) !== 0;
    const statusCode = hasSnapshot ? exchange.statusCode : this.statusCode;
    const statusMessage = hasSnapshot
      ? exchange.statusMessage || undefined
      : this.statusMessage === undefined
        ? undefined
        : this.statusMessage;
    const strict = this.strictContentLength ? contentLengthToKeepTo(this, true, true) : undefined;
    const autoHeaders = renderedAutoHeaders;
    const keepAliveSecs = renderedKeepAliveSecs;
    let contentLength =
      handle.writeWholeResponse(
        statusCode,
        statusMessage,
        renderedHeaders,
        chunk,
        encoding,
        strict,
        autoHeaders,
        keepAliveSecs,
      ) ??
      handle.writeHeadAndEnd(
        statusCode,
        statusMessage,
        renderedHeaders,
        chunk,
        encoding,
        strict,
        autoHeaders,
        keepAliveSecs,
      );
    this._headerSent = true;
    if (contentLength < 0) {
      ("unlikely");
      draining = true;
      contentLength = -contentLength - 1;
    }
    this._contentLength = contentLength;
  } else {
    const handleFlags = handle.flags;
    if (!!(handleFlags & NodeHTTPResponseFlags.closed_or_completed)) {
      ("unlikely");
      return endWithoutSocket(this, true);
    }
    if (
      !(!chunk && handleFlags & NodeHTTPResponseFlags.ended) &&
      !(handleFlags & NodeHTTPResponseFlags.socket_closed)
    ) {
      draining = handle.end(chunk, encoding, undefined, strictContentLength(this, true, true))! < 0;
    }
  }
  this._header = " ";
  noteResponseWrite(this);
  uncorkSocketOf(this);
  this.finished = true;

  if (
    !draining &&
    (flags & EXCHANGE_HAS_PENDING_CALLBACKS) === 0 &&
    ticksAreUnhooked() &&
    callsPendingCallbacksUnseen(this)
  ) {
    if (!isUnheard(this, exchange) || !emitsUnseen(this)) {
      this.emit("prefinish");
      if (!callsPendingCallbacksUnseen(this)) this._callPendingCallbacks();
      flags = exchange.flags;
    }
    if (callback !== undefined) {
      ("unlikely");
      exchange.endCallback = callback!;
      flags |= EXCHANGE_HAS_END_CALLBACK;
    }
    exchange.flags = flags | EXCHANGE_ENDED_CLEAN;
    queueTick1(finishExchange, exchange);
    return this;
  }

  return finishInSteps(this, exchange, handle, draining, callback);
};

function finishInSteps(
  res: $Node.ServerResponse,
  exchange: Exchange | undefined,
  handle: $Node.NodeHTTPResponse,
  draining: boolean,
  callback: $Node.HttpWriteCallback | null | undefined,
): $Node.ServerResponse {
  queueTick1(markResponseEndedNT, res);
  res.emit("prefinish");

  if (draining) {
    // Native calls back once the body is out; a dying connection finishes from emit("close").
    storeRarely(res, kPendingFinish, callback ?? null);
    if (exchange !== undefined) exchange.pendingFinish = exchange.response[kPendingFinish];
    handle.onwritable = flushPendingFinish.bind(res);
  } else {
    queueResponseFinished(res, callback);
  }

  return res;
}

function markResponseEndedNT(res: $Node.ServerResponse) {
  res._ended = true;
}

// 'finish' waits a tick: the dispatcher sets kDetachedFrom after a sync handler returns, and 'finish' reads it.
function queueResponseFinished(res: $Node.ServerResponse, callback: $Node.HttpWriteCallback | null | undefined) {
  res._callPendingCallbacks();
  queueTick2(emitResponseFinished, res, callback);
}

// 'close' is queued before the 'finish' listeners run, like Node.js's resOnFinish does.
function emitResponseFinished(res: $Node.ServerResponse, callback: $Node.HttpWriteCallback | null | undefined) {
  queueTick1(emitCloseNT, res);
  res.emit("finish");
  if (callback) {
    try {
      callback();
    } catch (err) {
      res.emit("error", err);
    }
  }
}

function flushPendingFinish(this: $Node.ServerResponse) {
  const callback = this[kPendingFinish];
  if (callback === undefined) return;
  storeRarely(this, kPendingFinish, undefined);
  followResponse(this.$exchange);
  noteResponseWrite(this);
  queueResponseFinished(this, callback);
}

ServerResponse.prototype.write = function (
  this: $Node.ServerResponse,
  chunk?: $Node.HttpChunk | null | $Node.HttpWriteCallback,
  encoding?: string | null | $Node.HttpWriteCallback,
  callback?: $Node.HttpWriteCallback | null,
) {
  const exchange = this.$exchange;
  if (exchange === undefined || exchange.response !== this) {
    ("unlikely");
    return writeInFull(this, exchange, chunk, encoding, callback);
  }
  const handle = this[kHandle];
  if (!handle || this.finished || this.destroyed) {
    ("unlikely");
    return writeInFull(this, exchange, chunk, encoding, callback);
  }

  if ($isCallable(chunk)) {
    callback = chunk;
    chunk = undefined;
    encoding = undefined;
  } else if ($isCallable(encoding)) {
    callback = encoding;
    encoding = undefined;
  } else if (!$isCallable(callback)) {
    callback = undefined;
  }

  const hadHeader = !!this._header;
  callWriteHeadIfObservable(this);

  if (!this._header) validateImplicitHead(this);

  const handleFlags = handle.flags;
  if (!!(handleFlags & NodeHTTPResponseFlags.closed_or_completed)) {
    // Socket already gone, and 'close' is still to come.
    if (callback) {
      addPendingCallback(this, callback);
      failPendingWriteCallbacks(this, this[kSocket]?.errored);
    }
    return false;
  }

  if (!this._hasBody) {
    ("unlikely");
    if ((chunk || chunk === "") && this[kRejectNonStandardBodyWrites]) throw $ERR_HTTP_BODY_NOT_ALLOWED();
    // Node's write_(): the chunk is dropped, and the head waits for end() or flushHeaders().
    this._implicitHeader();
    if (callback) process.nextTick(callback);
    return true;
  }

  const result = writeToHandle(this, exchange, handle, chunk, encoding, strictContentLength(this, hadHeader, false));

  if (result < 0) {
    ("unlikely");
    // Bound only for a write that the transport didn't take whole.
    handle.onwritable = exchange.onWritable ??= allowWritesToContinue.bind(this);
    // The write was buffered due to backpressure. Its callback waits until the write goes through.
    if (callback) addPendingCallback(this, callback);
    return false;
  }

  noteResponseWrite(this);
  this._callPendingCallbacks();
  if (callback && !hasSentForCallback(this, handle, callback)) return false;

  // Like in Node, bytes handed off in this turn count against the high water mark even if the transport took them: at the mark write() returns false and 'drain' follows.
  let written = 0;
  if (chunk) {
    written = typeof chunk === "string" ? Buffer.byteLength(chunk, encoding) : chunk.length;
    if (
      written > 0 &&
      (this.getHeader === outgoingGetHeader
        ? !hasHeaderUnderKey(exchange, this, "content-length", HEADER_CONTENT_LENGTH)
        : this.getHeader("content-length") === undefined)
    ) {
      // Chunked framing overhead: <hex length>\r\n<chunk>\r\n
      written += ((31 - Math.clz32(written)) >> 2) + 5;
    }
  }
  if (written > 0) {
    this[kBytesBuffered] = exchange.bytesBuffered += written;
    scheduleWriteAccountingFlush(this);
  }

  // An empty chunk reports the count too: Node returns state.length < highWaterMark for every write.
  const buffered = exchange.bytesBuffered;
  return buffered === 0 || buffered < this.writableHighWaterMark;
};

function bytesBufferedOf(res: $Node.ServerResponse): number {
  const exchange = res.$exchange;
  return exchange !== undefined && exchange.response === res ? exchange.bytesBuffered : (res[kBytesBuffered] ?? 0);
}

// A write callback reports that its bytes reached the socket: they are uncorked before the callback can destroy the response.
function hasSentForCallback(
  res: $Node.ServerResponse,
  handle: $Node.NodeHTTPResponse,
  callback: $Node.HttpWriteCallback,
): boolean {
  handle.flushHeaders();
  if (handle.bufferedAmount > 0) {
    addPendingCallback(res, callback);
    handle.onwritable = allowWritesToContinue.bind(res);
    return false;
  }
  process.nextTick(callback);
  return true;
}

function addPendingCallback(res: $Node.ServerResponse, callback: $Node.HttpWriteCallback): void {
  const exchange = res.$exchange;
  if (exchange !== undefined && exchange.response === res && (exchange.flags & EXCHANGE_HAS_PENDING_CALLBACKS) === 0) {
    exchange.flags |= EXCHANGE_HAS_PENDING_CALLBACKS;
    res[kPendingCallbacks] = [callback];
    return;
  }
  const callbacks = res[kPendingCallbacks];
  if (callbacks === noCallbacks) res[kPendingCallbacks] = [callback];
  else callbacks.push(callback);
}

function flushWriteAccountingNT(res: $Node.ServerResponse) {
  const exchange = res.$exchange;
  res[kAccountingFlushScheduled] = false;
  const needsDrain = (res[kBytesBuffered] ?? 0) >= res.writableHighWaterMark;
  res[kBytesBuffered] = 0;
  if (exchange !== undefined && exchange.response === res) {
    exchange.isFlushScheduled = false;
    exchange.bytesBuffered = 0;
  } else {
    followResponse(exchange);
  }
  if (!needsDrain || res.destroyed || res.finished) return;
  const handle = res[kHandle];
  if ((handle?.bufferedAmount ?? 0) > 0) {
    // The handle may still reference the caller's buffer for an unsent tail, so 'drain' waits for its drain callback.
    handle!.onwritable ??= allowWritesToContinue.bind(res);
    return;
  }
  res.emit("drain");
}
function scheduleWriteAccountingFlush(res: $Node.ServerResponse) {
  const exchange = res.$exchange;
  if (exchange !== undefined && exchange.response === res) {
    if (exchange.isFlushScheduled) return;
    exchange.isFlushScheduled = res[kAccountingFlushScheduled] = true;
  } else {
    if (res[kAccountingFlushScheduled]) return;
    res[kAccountingFlushScheduled] = true;
    followResponse(exchange);
  }
  queueTick1(flushWriteAccountingNT, res);
}

const responseCallPendingCallbacks = (ServerResponse.prototype._callPendingCallbacks = function (
  this: $Node.ServerResponse,
) {
  const exchange = this.$exchange;
  if (exchange !== undefined && exchange.response === this && (exchange.flags & EXCHANGE_HAS_PENDING_CALLBACKS) === 0)
    return;
  const originalLength = this[kPendingCallbacks].length;

  for (let i = 0; i < originalLength; ++i) {
    process.nextTick(this[kPendingCallbacks][i]);
  }

  if (this[kPendingCallbacks].length == originalLength) {
    // If the array wasn't somehow appended to, just set it to an empty array
    this[kPendingCallbacks] = [];
  } else {
    // Otherwise, splice it.
    this[kPendingCallbacks].splice(0, originalLength);
  }
});

const responseDetachSocket = (ServerResponse.prototype.detachSocket = function (
  this: $Node.ServerResponse,
  socket: $Node.HttpSocket | null | undefined,
) {
  // socket can be null when the stream destroyer detached the request's
  // socket (req.socket = null) before the response finished.
  if (socket && socket._httpMessage === this) {
    const hasCloseCallback = !!socket[kCloseCallback];
    if (hasCloseCallback) socket[kCloseCallback] = undefined;
    if (!IS_COMPILED_AHEAD_OF_TIME || !hasCloseCallback || !removesListenersUnseen(socket)) {
      socket.removeListener("close", onServerResponseClose);
    }
    socket._httpMessage = null;
    if (this.destroyed && socket.destroyed) socket[kDetachedWhileClosing] = this;
  }

  this.socket = null;
});

const OriginalImplicitHeadFn = (ServerResponse.prototype._implicitHeader = function (this: $Node.ServerResponse) {
  if (this._header) return;
  if (this.writeHead === OriginalWriteHeadFn) writeHead(this, this.statusCode, undefined, undefined, false);
  else this.writeHead(this.statusCode);
});

// A response without a native handle (new ServerResponse(req) and assignSocket()) writes through OutgoingMessage, which keeps its own accounting.
const {
  writableCorked: { get: outgoingWritableCorked },
  writableNeedDrain: { get: outgoingWritableNeedDrain },
  writableFinished: { get: outgoingWritableFinished },
  writableLength: { get: outgoingWritableLength },
} = Object.getOwnPropertyDescriptors(OutgoingMessagePrototype);

Object.defineProperty(ServerResponse.prototype, "writableNeedDrain", {
  get(this: $Node.ServerResponse) {
    // True between a write() that returned false and the next 'drain'. An armed native drain callback means a later write flushed the bytes.
    const handle = this[kHandle];
    if (!handle) return outgoingWritableNeedDrain!.$call(this);
    if (this.destroyed || this.finished) return false;
    return (
      handle.bufferedAmount !== 0 ||
      handle.onwritable !== undefined ||
      bytesBufferedOf(this) >= this.writableHighWaterMark
    );
  },
});

Object.defineProperty(ServerResponse.prototype, "writableFinished", {
  get(this: $Node.ServerResponse) {
    const handle = this[kHandle];
    if (!handle) return outgoingWritableFinished!.$call(this);
    // Like Node, nothing is left to write once the socket is gone.
    return !!(this.finished && (handle.finished || handle.flags & NodeHTTPResponseFlags.closed_or_completed));
  },
});

Object.defineProperty(ServerResponse.prototype, "writableLength", {
  get(this: $Node.ServerResponse) {
    const handle = this[kHandle];
    if (!handle) return outgoingWritableLength!.$call(this);
    if (this.writableFinished) return 0;
    // Bytes handed off this event-loop turn (including chunked framing, like
    // Node.js's outputData accounting) plus whatever the native handle still
    // has buffered.
    return bytesBufferedOf(this) + handle.bufferedAmount;
  },
});

ServerResponse.prototype._send = function (
  this: $Node.ServerResponse,
  data: $Node.HttpChunk,
  encoding?: string | null | $Node.HttpWriteCallback,
  callback?: $Node.HttpWriteCallback | null,
  _byteLength?: number,
) {
  const exchange = this.$exchange;
  if (exchange === undefined || exchange.response !== this) spillStateReachedThrough(this);
  const handle = this[kHandle];
  if (!handle) {
    return OutgoingMessagePrototype._send.$apply(this, arguments);
  }

  if (typeof encoding === "function") {
    callback = encoding;
    encoding = null;
  }
  const hadHeader = !!this._header;
  if (!hadHeader) validateImplicitHead(this);
  const result = writeToHandle(this, exchange, handle, data, encoding, strictContentLength(this, hadHeader, false));
  if (result < 0 && callback) handle.onwritable = callback;
};

// The first write takes the head with it, in one native call that throws before it sends anything.
function writeToHandle(
  res: $Node.ServerResponse,
  exchange: Exchange | undefined,
  handle: $Node.NodeHTTPResponse,
  chunk: $Node.HttpChunk | null | undefined,
  encoding: string | null | undefined,
  strict: number | undefined,
): number {
  if (res._headerSent) return handle.write(chunk, encoding, undefined, strict);
  const renderedHeaders = renderNativeHeaders(res, exchange, exchange !== undefined && exchange.response === res);
  const result = handle.writeHeadAndWrite(
    statusCodeToSend(res),
    statusMessageToSend(res),
    renderedHeaders as string[],
    chunk,
    encoding,
    undefined,
    strict,
    renderedAutoHeaders,
    renderedKeepAliveSecs,
  );
  res._header = " ";
  res._headerSent = true;
  return result;
}

const OriginalWriteHeadFn = (ServerResponse.prototype.writeHead = function (
  this: $Node.ServerResponse,
  statusCode: number,
  statusMessage?: string | $Node.HttpHeadersInit | null,
  headers?: $Node.HttpHeadersInit | null,
) {
  return writeHead(this, statusCode, statusMessage, headers, true);
});

function writeHead(
  self: $Node.ServerResponse,
  statusCode: number,
  statusMessage: string | $Node.HttpHeadersInit | null | undefined,
  headers: $Node.HttpHeadersInit | null | undefined,
  explicit: boolean,
) {
  const exchange = self.$exchange;
  if (exchange === undefined || exchange.response !== self || self.hasHeader !== outgoingHasHeader) {
    ("unlikely");
    return writeHeadInFull(self, statusCode, statusMessage, headers, explicit);
  }
  if (self._header) {
    throw $ERR_HTTP_HEADERS_SENT("writeHead");
  }
  _writeHead(statusCode, statusMessage, headers, self, explicit, exchange);

  // Node.js renders the header block immediately in writeHead(), so mutating
  // res.statusCode/statusMessage afterwards has no effect on the wire.
  // Headers are flushed lazily here, so snapshot the status line now.
  exchange.statusCode = self[kSnapshotStatusCode] = self.statusCode;
  exchange.statusMessage = self[kSnapshotStatusMessage] = self.statusMessage!;
  exchange.flags |= EXCHANGE_HAS_SNAPSHOT;

  // Node's writeHead() freezes body framing: _storeHeader runs with _contentLength null and
  // a later end(chunk) cannot add Content-Length once _header exists. Headers render lazily
  // here, so record the frozen choice for renderNativeHeaders.
  if (
    !exchange.isImplicitFromEnd &&
    !hasHeaderUnderKey(exchange, self, "content-length", HEADER_CONTENT_LENGTH) &&
    !hasHeaderUnderKey(exchange, self, "transfer-encoding", HEADER_TRANSFER_ENCODING)
  ) {
    exchange.isFrozenChunked = self[kFramingFrozenChunked] = true;
  }

  if (self[kHandle]) {
    // The handle renders the head when it sends it.
    self._header = " ";
  } else {
    ("unlikely");
    storeHeadWithoutHandle(self, exchange);
  }

  return self;
}

function storeHeadWithoutHandle(res: $Node.ServerResponse, exchange: Exchange | undefined): void {
  if (exchange !== undefined) spillHeaders(exchange);
  if (res._expect_continue && !res._sent100) res.shouldKeepAlive = false;
  // Node says keep-alive here, and after a Transfer-Encoding without "chunked" it keeps the connection too.
  const endsAtClose = bodyEndsAtClose(res);
  if (endsAtClose) res.shouldKeepAlive = false;
  res._storeHeader(`HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n`, res[kOutHeaders], true);
  if (endsAtClose) res._last = true;
}

ServerResponse.prototype.assignSocket = function (this: $Node.ServerResponse, socket: $Node.HttpSocket) {
  if (socket._httpMessage) {
    throw $ERR_HTTP_SOCKET_ASSIGNED();
  }
  socket._httpMessage = this;
  socket.on("close", onServerResponseClose);
  this.socket = socket;
  this.emit("socket", socket);
  // Like Node.js: drain anything written before the socket was assigned.
  this._flush();
};

ServerResponse.prototype.destroy = function (this: $Node.ServerResponse, err?: Error | null) {
  if (this.destroyed) return this;
  const handle = this[kHandle];
  this.destroyed = true;
  // Like Node.js's OutgoingMessage#destroy: remember the error (even when it
  // is undefined) so `res.errored` reports it, and forward it to the socket.
  this[kErrored] = err;
  if (handle) {
    handle.abort();
  }
  const socket = this[kSocket];
  if (socket) {
    socket.destroy(err);
  } else {
    process.nextTick(emitCloseNT, this);
  }
  return this;
};

const responseEmit = (ServerResponse.prototype.emit = function (this: $Node.ServerResponse, event: $Node.EventName) {
  if (event === "close") {
    const exchange = this.$exchange;
    const callback =
      exchange !== undefined && exchange.response === this ? exchange.pendingFinish : this[kPendingFinish];
    if (callback !== undefined) {
      ("unlikely");
      // The connection died mid-drain: like Node.js, the response still finishes, then closes.
      storeRarely(this, kPendingFinish, undefined);
      followResponse(exchange);
      this._closed = true;
      this._callPendingCallbacks();
      queueTick2(emitResponseFinishedThenClose, this, callback);
      return false;
    }
    // The callbacks of what it couldn't send run ahead of 'close'. An heir of the prototype that this constructor didn't make has none.
    const callbacks = this[kPendingCallbacks];
    if (callbacks !== undefined) {
      const pending = callbacks.length !== 0;
      if (pending) failPendingWriteCallbacks(this, undefined);
      if (this[kFailHeldWrites]() || pending) {
        ("unlikely");
        process.nextTick(emitClose, this);
        return false;
      }
    }
    settleDispatchAtClose(this);
  }
  return plainStream.emit.$apply(this, arguments);
});

function emitClose(res: $Node.ServerResponse) {
  res.emit("close");
}

function emitResponseFinishedThenClose(res: $Node.ServerResponse, callback: $Node.HttpWriteCallback | null) {
  emitResponseFinished(res, callback);
  res.emit("close");
}

ServerResponse.prototype.flushHeaders = function (this: $Node.ServerResponse) {
  const exchange = this.$exchange;
  if (exchange === undefined || exchange.response !== this) spillStateReachedThrough(this);
  const handle = this[kHandle];
  if (!this._header) {
    if (this._implicitHeader === OriginalImplicitHeadFn) this.writeHead(this.statusCode);
    else this._implicitHeader();
  }
  if (!handle) return OutgoingMessagePrototype.flushHeaders.$call(this);
  // Should be idempotent.
  if (this._headerSent) return;

  // Called from a replaced writeHead() that end() is driving. end() sends the head with the body, like Node's corked end().
  if (this[kImplicitHeaderFromEnd]) return;

  this._headerSent = true;
  writeHeadToHandle(this, exchange, handle);
  handle.flushHeaders();
  noteResponseWrite(this);
};

function updateHasBody(response: $Node.ServerResponse, statusCode: number) {
  // RFC 2616, 10.2.5:
  // The 204 response MUST NOT include a message-body, and thus is always
  // terminated by the first empty line after the header fields.
  // RFC 2616, 10.3.5:
  // The 304 response MUST NOT contain a message-body, and thus is always
  // terminated by the first empty line after the header fields.
  // RFC 2616, 10.1 Informational 1xx:
  // This class of status code indicates a provisional response,
  // consisting only of the Status-Line and optional headers, and is
  // terminated by an empty line.
  if (statusCode === 204 || statusCode === 304 || (statusCode >= 100 && statusCode <= 199)) {
    ("unlikely");
    response._hasBody = false;
  }
  // No else: Node.js never sets _hasBody back to true here, so a HEAD
  // request's response (set in the constructor) stays body-less whatever
  // status writeHead() picks.
}

function callWriteHeadIfObservable(self: $Node.ServerResponse, fromEnd?: boolean) {
  if (!self._header && !(self.writeHead === OriginalWriteHeadFn && self._implicitHeader === OriginalImplicitHeadFn)) {
    ("unlikely");
    callObservableWriteHead(self, fromEnd);
  }
}

function callObservableWriteHead(self: $Node.ServerResponse, fromEnd: boolean | undefined) {
  // Node's end(chunk) assigns _contentLength before _implicitHeader reaches
  // _storeHeader, so this implicit call must not freeze the framing to chunked
  // the way an explicit writeHead() does — the body is already in hand.
  if (fromEnd) {
    storeRarely(self, kImplicitHeaderFromEnd, true);
    followResponse(self.$exchange);
  }
  try {
    self.writeHead(self.statusCode, self.statusMessage);
  } finally {
    if (fromEnd) {
      storeRarely(self, kImplicitHeaderFromEnd, false);
      followResponse(self.$exchange);
    }
  }
}

// A write that only reached the backpressure buffer doesn't count, so a peer that stopped reading still times out.
function noteResponseWrite(res: $Node.ServerResponse) {
  const socket = res[kSocket] as $Node.HttpServerSocket | null;
  if (!socket?.timeout) return;
  // The timer may have fired and a 'timeout' listener kept the socket. refresh() arms it again, like in Node.
  if (socket[kLastResponseWrite] === undefined) socket._unrefTimer();
  socket[kLastResponseWrite] = timerClockMs();
}

function allowWritesToContinue(this: $Node.ServerResponse) {
  noteResponseWrite(this);
  this._callPendingCallbacks();
  this.emit("drain");
}

function failPendingWriteCallbacks(res: $Node.ServerResponse, error: Error | null | undefined) {
  const callbacks = res[kPendingCallbacks];
  const length = callbacks?.length ?? 0;
  if (length === 0) return;
  res[kPendingCallbacks] = [];
  const failure = error ?? $ERR_STREAM_DESTROYED("write");
  for (let i = 0; i < length; i++) {
    process.nextTick(callbacks[i], failure);
  }
}

ServerResponse.prototype._expect_continue = false;

function defaultShouldUpgradeCallback(this: $Node.HttpServer) {
  return this.listenerCount("upgrade") > 0;
}

function storeHTTPOptions(this: $Node.HttpServer, options: $Node.HttpServerOptions) {
  this[kIncomingMessage] = options.IncomingMessage || IncomingMessage;
  this[kServerResponse] = options.ServerResponse || ServerResponse;

  const maxHeaderSize = options.maxHeaderSize;
  if (maxHeaderSize !== undefined) validateInteger(maxHeaderSize, "maxHeaderSize", 0);
  this.maxHeaderSize = maxHeaderSize;

  const insecureHTTPParser = options.insecureHTTPParser;
  if (insecureHTTPParser !== undefined) validateBoolean(insecureHTTPParser, "options.insecureHTTPParser");
  this.insecureHTTPParser = insecureHTTPParser;

  const httpValidation = options.httpValidation;
  if (httpValidation !== undefined) {
    validateOneOf(httpValidation, "options.httpValidation", ["strict", "relaxed", "insecure"]);
    if (insecureHTTPParser !== undefined) {
      throw $ERR_INVALID_ARG_VALUE(
        "options.httpValidation",
        httpValidation,
        "cannot be used with options.insecureHTTPParser",
      );
    }
    this.httpValidation = httpValidation;
  }

  const requestTimeout = options.requestTimeout;
  if (requestTimeout !== undefined) {
    validateInteger(requestTimeout, "requestTimeout", 0);
    this.requestTimeout = requestTimeout;
  } else {
    this.requestTimeout = 300_000; // 5 minutes
  }

  const headersTimeout = options.headersTimeout;
  if (headersTimeout !== undefined) {
    validateInteger(headersTimeout, "headersTimeout", 0);
    this.headersTimeout = headersTimeout;
  } else {
    this.headersTimeout = MathMin(60_000, this.requestTimeout); // Minimum between 60 seconds or requestTimeout
  }

  if (this.requestTimeout > 0 && this.headersTimeout > 0 && this.headersTimeout > this.requestTimeout) {
    throw $ERR_OUT_OF_RANGE("headersTimeout", "<= requestTimeout", headersTimeout);
  }

  const keepAliveTimeout = options.keepAliveTimeout;
  if (keepAliveTimeout !== undefined) {
    validateInteger(keepAliveTimeout, "keepAliveTimeout", 0);
    this.keepAliveTimeout = keepAliveTimeout;
  } else {
    this.keepAliveTimeout = 5_000; // 5 seconds
  }

  const keepAliveTimeoutBuffer = options.keepAliveTimeoutBuffer;
  if (keepAliveTimeoutBuffer !== undefined) {
    validateInteger(keepAliveTimeoutBuffer, "keepAliveTimeoutBuffer", 0);
    this.keepAliveTimeoutBuffer = keepAliveTimeoutBuffer;
  } else {
    this.keepAliveTimeoutBuffer = 1000;
  }

  const connectionsCheckingInterval = options.connectionsCheckingInterval;
  if (connectionsCheckingInterval !== undefined) {
    validateInteger(connectionsCheckingInterval, "connectionsCheckingInterval", 0);
    this.connectionsCheckingInterval = connectionsCheckingInterval;
  } else {
    this.connectionsCheckingInterval = 30_000; // 30 seconds
  }

  const requireHostHeader = options.requireHostHeader;
  if (requireHostHeader !== undefined) {
    validateBoolean(requireHostHeader, "options.requireHostHeader");
    this.requireHostHeader = requireHostHeader;
  } else {
    this.requireHostHeader = true;
  }

  const joinDuplicateHeaders = options.joinDuplicateHeaders;
  if (joinDuplicateHeaders !== undefined) {
    validateBoolean(joinDuplicateHeaders, "options.joinDuplicateHeaders");
  }
  this.joinDuplicateHeaders = joinDuplicateHeaders;

  const shouldUpgradeCallback = options.shouldUpgradeCallback;
  if (shouldUpgradeCallback !== undefined) {
    validateFunction(shouldUpgradeCallback, "options.shouldUpgradeCallback");
    this.shouldUpgradeCallback = shouldUpgradeCallback;
  } else {
    this.shouldUpgradeCallback = defaultShouldUpgradeCallback;
  }

  const rejectNonStandardBodyWrites = options.rejectNonStandardBodyWrites;
  if (rejectNonStandardBodyWrites !== undefined) {
    validateBoolean(rejectNonStandardBodyWrites, "options.rejectNonStandardBodyWrites");
    this.rejectNonStandardBodyWrites = rejectNonStandardBodyWrites;
  } else {
    this.rejectNonStandardBodyWrites = false;
  }

  const optimizeEmptyRequests = options.optimizeEmptyRequests;
  if (optimizeEmptyRequests !== undefined) {
    validateBoolean(optimizeEmptyRequests, "options.optimizeEmptyRequests");
  }
  this[kOptimizeEmptyRequests] = optimizeEmptyRequests || false;
}

// An object that stands in the place of a response, a Proxy or an heir, sees each read and each store of the state of the
// response, so it takes the functions below, which keep that state on their receiver. The exchange goes on holding what the
// response itself has: a store through a Proxy reaches the response, a store on an heir does not. A receiver that no response
// stands behind has no exchange, and takes the same functions.
function spillStateReachedThrough(receiver: $Node.ServerResponse): void {
  const exchange = receiver.$exchange;
  if (exchange === undefined) return;
  if (IS_COMPILED_AHEAD_OF_TIME) spillHeadersReachedThrough(receiver);
  spillHeaders(exchange);
  const flags = exchange.flags;
  if ((flags & EXCHANGE_HAS_STAND_IN) === 0) {
    exchange.flags |= EXCHANGE_HAS_STAND_IN;
    if ((flags & EXCHANGE_HAS_PENDING_CALLBACKS) === 0) {
      try {
        exchange.response[kPendingCallbacks] = [];
        exchange.flags |= EXCHANGE_HAS_PENDING_CALLBACKS;
      } catch {}
    }
  }
}

// What few responses ever have takes no room in all of them.
function storeRarely(receiver: object, key: symbol, value: unknown): void {
  (receiver as any)[key] = value;
}

function followResponse(exchange: Exchange | undefined): void {
  if (exchange === undefined) return;
  const response = exchange.response;
  exchange.isFrozenChunked = !!response[kFramingFrozenChunked];
  exchange.isImplicitFromEnd = !!response[kImplicitHeaderFromEnd];
  exchange.bytesBuffered = response[kBytesBuffered] ?? 0;
  exchange.isFlushScheduled = !!response[kAccountingFlushScheduled];
  exchange.pendingFinish = response[kPendingFinish];
  const statusCode = response[kSnapshotStatusCode];
  if (statusCode !== undefined) {
    exchange.statusCode = statusCode;
    exchange.statusMessage = response[kSnapshotStatusMessage]!;
    exchange.flags |= EXCHANGE_HAS_SNAPSHOT;
  }
}

function writeHeadToHandle(
  res: $Node.ServerResponse,
  exchange: Exchange | undefined,
  handle: $Node.NodeHTTPResponse,
): void {
  const renderedHeaders = renderNativeHeaders(res, exchange, exchange !== undefined && exchange.response === res);
  const statusCode = statusCodeToSend(res);
  const statusMessage = statusMessageToSend(res);
  handle.writeHead(statusCode, statusMessage, renderedHeaders as string[], renderedAutoHeaders, renderedKeepAliveSecs);
}

function endInFull(
  res: $Node.ServerResponse,
  exchange: Exchange | undefined,
  chunk: $Node.HttpChunk | null | $Node.HttpWriteCallback | undefined,
  encoding: string | null | $Node.HttpWriteCallback | undefined,
  callback: $Node.HttpWriteCallback | null | undefined,
) {
  if (exchange === undefined || exchange.response !== res) spillStateReachedThrough(res);
  const handle = res[kHandle];
  // A late end() gets the same answer whatever carries the response.
  if (!handle || res.finished) {
    return OutgoingMessagePrototype.end.$call(res, toOutgoingChunk(res, chunk), encoding, callback);
  }

  if ($isCallable(chunk)) {
    callback = chunk;
    chunk = undefined;
    encoding = undefined;
  } else if ($isCallable(encoding)) {
    callback = encoding;
    encoding = undefined;
  } else if (!$isCallable(callback)) {
    callback = undefined;
  }

  // Node's write_() drops the chunk of a destroyed response before _implicitHeader(), and end() goes on: https://github.com/nodejs/node/blob/v26.3.0/lib/_http_outgoing.js#L951-L964
  const droppedChunk = !!chunk && res.destroyed;
  if (droppedChunk) chunk = undefined;

  if (!res._header) validateImplicitHead(res);
  if (chunk && !res._hasBody) {
    if (res[kRejectNonStandardBodyWrites]) {
      throw $ERR_HTTP_BODY_NOT_ALLOWED();
    } else {
      // node.js just ignores the write in this case
      chunk = undefined;
    }
  }

  // Trailers follow the last chunk (RFC 9112 7.1.2), so they need chunked framing. Node drops them with a Content-Length, on HTTP/1.0 and without a body.
  const trailer = res._trailer;
  if (trailer && res._hasBody && willBeChunked(res)) {
    res.socket?.[kHandle]?.setResponseTrailers(trailer);
  }

  if (!droppedChunk) callWriteHeadIfObservable(res, true);

  const flags = handle.flags;
  if (!!(flags & NodeHTTPResponseFlags.closed_or_completed)) {
    // Node's _implicitHeader() ran unless the chunk was dropped above, so the head counts as sent like on the normal path below.
    return endWithoutSocket(res, !droppedChunk || !!res._header);
  }
  // Native end() returns -(length + 1) while part of the body is still draining; 'finish' waits for it.
  let draining = false;
  // A replaced writeHead() can have sent the head itself, with write().
  if (!res._headerSent) {
    const renderedHeaders = renderNativeHeaders(
      res,
      exchange,
      exchange !== undefined && exchange.response === res,
    ) as string[];
    // It throws before it sends anything.
    let contentLength = handle.writeHeadAndEnd(
      statusCodeToSend(res),
      statusMessageToSend(res),
      renderedHeaders,
      chunk,
      encoding,
      strictContentLength(res, true, true),
      renderedAutoHeaders,
      renderedKeepAliveSecs,
    )!;
    res._headerSent = true;
    if (contentLength < 0) {
      draining = true;
      contentLength = -contentLength - 1;
    }
    res._contentLength = contentLength;
  } else {
    // No data after end() is nothing to do. `flags` was read above in the same tick.
    if (!(!chunk && flags & NodeHTTPResponseFlags.ended) && !(flags & NodeHTTPResponseFlags.socket_closed)) {
      draining = handle.end(chunk, encoding, undefined, strictContentLength(res, true, true))! < 0;
    }
  }
  res._header = " ";
  noteResponseWrite(res);
  uncorkSocketOf(res);
  // Like in Node, res.socket stays assigned until the 'finish' machinery detaches it, so a handler can reach it after end().
  res.finished = true;
  return finishInSteps(res, exchange, handle, draining, callback);
}

function writeInFull(
  res: $Node.ServerResponse,
  exchange: Exchange | undefined,
  chunk: $Node.HttpChunk | null | $Node.HttpWriteCallback | undefined,
  encoding: string | null | $Node.HttpWriteCallback | undefined,
  callback: $Node.HttpWriteCallback | null | undefined,
) {
  if (exchange === undefined || exchange.response !== res) spillStateReachedThrough(res);
  const handle = res[kHandle];
  // So does a late write().
  if (!handle || res.finished || res.destroyed) {
    return OutgoingMessagePrototype.write.$call(res, toOutgoingChunk(res, chunk) ?? "", encoding, callback);
  }

  if ($isCallable(chunk)) {
    callback = chunk;
    chunk = undefined;
    encoding = undefined;
  } else if ($isCallable(encoding)) {
    callback = encoding;
    encoding = undefined;
  } else if (!$isCallable(callback)) {
    callback = undefined;
  }

  const hadHeader = !!res._header;
  callWriteHeadIfObservable(res);

  if (!res._header) validateImplicitHead(res);

  const flags = handle.flags;
  if (!!(flags & NodeHTTPResponseFlags.closed_or_completed)) {
    // Socket already gone, and 'close' is still to come.
    if (callback) {
      addPendingCallback(res, callback);
      failPendingWriteCallbacks(res, res[kSocket]?.errored);
    }
    return false;
  }

  if (!res._hasBody) {
    if ((chunk || chunk === "") && res[kRejectNonStandardBodyWrites]) throw $ERR_HTTP_BODY_NOT_ALLOWED();
    // Node's write_(): the chunk is dropped, and the head waits for end() or flushHeaders().
    res._implicitHeader();
    if (callback) process.nextTick(callback);
    return true;
  }

  const result = writeToHandle(res, exchange, handle, chunk, encoding, strictContentLength(res, hadHeader, false));

  if (result < 0) {
    // Bound only for a write that the transport didn't take whole.
    handle.onwritable = allowWritesToContinue.bind(res);
    if (callback) addPendingCallback(res, callback);
    return false;
  }

  noteResponseWrite(res);
  res._callPendingCallbacks();
  if (callback && !hasSentForCallback(res, handle, callback)) return false;

  let written = 0;
  if (chunk) {
    written = typeof chunk === "string" ? Buffer.byteLength(chunk, encoding) : chunk.length;
    if (written > 0 && res.getHeader("content-length") === undefined) {
      written += written.toString(16).length + 4;
    }
  }
  if (written > 0) {
    res[kBytesBuffered] = (res[kBytesBuffered] ?? 0) + written;
    followResponse(exchange);
    scheduleWriteAccountingFlush(res);
  }

  const buffered = res[kBytesBuffered];
  return !buffered || buffered < res.writableHighWaterMark;
}

function writeHeadInFull(
  self: $Node.ServerResponse,
  statusCode: number,
  statusMessage: string | $Node.HttpHeadersInit | null | undefined,
  headers: $Node.HttpHeadersInit | null | undefined,
  explicit: boolean,
) {
  const exchange = self.$exchange;
  spillStateReachedThrough(self);
  if (self._header) {
    throw $ERR_HTTP_HEADERS_SENT("writeHead");
  }
  _writeHead(
    statusCode,
    statusMessage,
    headers,
    self,
    explicit,
    exchange !== undefined && exchange.response === self ? exchange : undefined,
  );

  self[kSnapshotStatusCode] = self.statusCode;
  self[kSnapshotStatusMessage] = self.statusMessage;

  if (!self[kImplicitHeaderFromEnd] && !self.hasHeader("content-length") && !self.hasHeader("transfer-encoding")) {
    self[kFramingFrozenChunked] = true;
  }
  followResponse(exchange);

  if (self[kHandle]) {
    self._header = " ";
  } else {
    storeHeadWithoutHandle(self, exchange);
  }

  return self;
}

http.requestRoad.readsDestroyedUnseen = readsDestroyedUnseen as (socket: $Node.HttpSocket) => boolean;

export default {
  Server,
  ServerResponse,
  setupConnectionsTracking,
  // An Http2SecureServer that allows HTTP/1 calls these three on itself.
  storeHTTPOptions: storeHTTPOptions as (this: $Node.EventEmitter, options: $Node.HttpServerOptions) => void,
  _connectionListener: connectionListener as (this: $Node.EventEmitter, socket: $Node.Duplex) => void,
  httpServerPreClose: httpServerPreClose as (server: $Node.EventEmitter) => void,
  kConnectionsCheckingInterval,
} as const;
