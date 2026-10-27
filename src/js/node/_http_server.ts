// Hardcoded module "node:_http_server"
const EventEmitter = require("node:events");
const { Stream } = require("node:stream");
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
  validateHeaderName,
  validateHeaderValue,
  HTTPParser,
  calculateLenientFlags,
} = require("node:_http_common");
const {
  validateObject,
  validateLinkHeaderValue,
  validateBoolean,
  validateInteger,
  validateFunction,
  validateOneOf,
} = require("internal/validators");
const {
  ConnResetException,
  ErrnoException,
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
const {
  STATUS_CODES,
  hasServerResponseFinished,
  drainMicrotasks,
  setServerCustomOptions,
  setServerAppFlags,
  setServerMaxHeadersCount,
  getMaxHTTPHeaderSize,
  http1ServerPipeline,
} = http;
const enum NodeHTTPResponseAbortEvent {
  none = 0,
  abort = 1,
  timeout = 2,
  readParsed = 3,
}
const enum NodeHTTPBodyReadState {
  none,
  pending = 1 << 1,
  done = 1 << 2,
  aborted = 1 << 3,
}
const enum NodeHTTPResponseFlags {
  socket_closed = 1 << 0,
  request_has_completed = 1 << 1,
  ended = 1 << 2,
  upgraded = 1 << 3,
  dispatch_threw_while_queued = 1 << 9,

  closed_or_completed = socket_closed | request_has_completed,
}
const enum NodeHTTPHeaderState {
  none,
  assigned,
  sent,
}
// A symbol taken out of a pattern is a plain `symbol` for the type checker, and what it keys is untyped.
const kInternalSocketData: typeof http.kInternalSocketData = http.kInternalSocketData;
const serverSymbol: typeof http.serverSymbol = http.serverSymbol;
const kHandle: typeof http.kHandle = http.kHandle;
const kOnReadParsed: typeof http.kOnReadParsed = http.kOnReadParsed;
const kHandoffResponse: typeof http.kHandoffResponse = http.kHandoffResponse;
const kHasQueuedReads: typeof http.kHasQueuedReads = http.kHasQueuedReads;
const kRealListen: typeof http.kRealListen = http.kRealListen;
const tlsSymbol: typeof http.tlsSymbol = http.tlsSymbol;
const optionsSymbol: typeof http.optionsSymbol = http.optionsSymbol;
const kPendingCallbacks: typeof http.kPendingCallbacks = http.kPendingCallbacks;
const headerStateSymbol: typeof http.headerStateSymbol = http.headerStateSymbol;
const fakeSocketSymbol: typeof http.fakeSocketSymbol = http.fakeSocketSymbol;
const kChunkedEncoding = Symbol("kChunkedEncoding");
const kShouldKeepAlive = Symbol("kShouldKeepAlive");
const kMustCloseConnection = Symbol("kMustCloseConnection");
const kDetachedFrom = Symbol("kDetachedFrom");
const kSocketTimeoutTimer = Symbol("socketTimeoutTimer");
const kKeepAliveTimeoutSet = Symbol("keepAliveTimeoutSet");
const kBytesBuffered = Symbol("kBytesBuffered");
const kAccountingFlushScheduled = Symbol("kAccountingFlushScheduled");
const kSnapshotStatusCode = Symbol("kSnapshotStatusCode");
const kSnapshotStatusMessage = Symbol("kSnapshotStatusMessage");
const kFramingFrozenChunked = Symbol("kFramingFrozenChunked");
const kImplicitHeaderFromEnd = Symbol("kImplicitHeaderFromEnd");
const kReplayingPipelinedOps = Symbol("kReplayingPipelinedOps");
const kPendingFinish = Symbol("kPendingFinish");
const kRememberPeer: typeof http.kRememberPeer = http.kRememberPeer;
const kRequest: typeof http.kRequest = http.kRequest;
const kCloseCallback: typeof http.kCloseCallback = http.kCloseCallback;
const kClosedWithUnsentData: typeof http.kClosedWithUnsentData = http.kClosedWithUnsentData;
const isTlsSymbol: typeof http.isTlsSymbol = http.isTlsSymbol;
const kOutHeaders: typeof http.kOutHeaders = http.kOutHeaders;
const kErrored: typeof http.kErrored = http.kErrored;
const kHighWaterMark: typeof http.kHighWaterMark = http.kHighWaterMark;
const kSocket: typeof http.kSocket = http.kSocket;
const kRejectNonStandardBodyWrites: typeof http.kRejectNonStandardBodyWrites = http.kRejectNonStandardBodyWrites;
const kUniqueHeaders: typeof http.kUniqueHeaders = http.kUniqueHeaders;
const kReqShouldKeepAlive: typeof http.kReqShouldKeepAlive = http.kReqShouldKeepAlive;
const kIncomingMessage: typeof http.kIncomingMessage = http.kIncomingMessage;
const kCapture: typeof shared.kCapture = shared.kCapture;
const kShapeMode: typeof shared.kShapeMode = shared.kShapeMode;
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
const HEADER_UNUSUAL = HEADER_DATE | HEADER_CONNECTION | HEADER_KEEP_ALIVE | HEADER_TRANSFER_ENCODING | HEADER_SPILLED;
const { FakeSocket } = require("internal/http/FakeSocket");
const NumberIsNaN = Number.isNaN;

const { IncomingMessage } = require("node:_http_incoming");
const onBodyData = streamInternals.onRequestBodyData!;
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
const plainOutgoingMessage: any = new OutgoingMessage();
let http1Fallback: typeof import("internal/http1_server_fallback").default | undefined;
const kConnectionsCheckingInterval = Symbol("http.server.connectionsCheckingInterval");
const kTrackedConnections = Symbol("http.server.trackedConnections");
const kPendingDrainClose = Symbol("http.server.pendingDrainClose");
const kPendingCloseGenerations = Symbol("http.server.pendingCloseGenerations");
const kListenerGeneration = Symbol("http.server.listenerGeneration");
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
function traceServerRequestStart(http_res: $Node.ServerResponse) {
  if (!traceEvents.isCategoryGroupEnabled(kHttpTraceCat)) return;
  traceEvents.emitEvent("b", kHttpTraceCat, "http.server.request");
  http_res.once("finish", traceServerRequestEnd);
}
function traceServerRequestEnd() {
  traceEvents.emitEvent("e", kHttpTraceCat, "http.server.request");
}

const getBunServerAllClosedPromise = $bindgen("node_http_binding.bind.ts", "getBunServerAllClosedPromise") as (
  server: $Node.NativeHTTPServer,
) => Promise<void>;
const getBunServerOpenCount = $bindgen("node_http_binding.bind.ts", "getBunServerOpenCount") as (
  server: $Node.NativeHTTPServer,
) => number;

const kServerResponse = Symbol("ServerResponse");
const kOptimizeEmptyRequests = Symbol("kOptimizeEmptyRequests");
const kEmptyBuffer = Buffer.alloc(0);
const ObjectKeys = Object.keys;
const ObjectHasOwn = Object.hasOwn;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const MathMin = Math.min;
const MathFloor = Math.floor;
const DateNow = Date.now;

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
  if ((relistened || self[kTrackedConnections].size > 0) && !drainedAtClose) return;
  self[kPendingDrainClose] = false;
  pendingGenerations.clear();
  if (!relistened) self[kListenerGeneration] = undefined;
  self.emit("close");
}
function markListenerGenerationClosed(self: $Node.HttpServer, generation: ListenerGeneration) {
  generation.nativeClosed = true;
  emitCloseServer(self);
}
function emitCloseNTServer(this: $Node.HttpServer, generation: ListenerGeneration) {
  process.nextTick(markListenerGenerationClosed, this, generation);
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

function setCloseCallback(self: $Node.HttpServerSocket, callback: (this: $Node.HttpServerSocket) => void) {
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
function strictContentLength(response: $Node.ServerResponse, headerState: NodeHTTPHeaderState, fromEnd: boolean) {
  if (!response.strictContentLength) return;
  if (!fromEnd && headerState === NodeHTTPHeaderState.none) return;
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
    free: serverParserShimFree,
    close: serverParserShimClose,
    [kParserOnTimeout]: serverParserShimOnTimeout,
  };
}

function releaseServerParserShim(socket: $Node.HttpServerSocket, req?: $Node.IncomingMessage) {
  const parser = socket.parser;
  if (parser == null) return;
  socket.parser = null;
  socket.$isPrepared = false;
  parser.incoming = null;
  parser.socket = null;
  parser[kParserOnTimeout] = null;
  parser.free();
  if (req != null && req.parser != null) req.parser = null;
}

function onNodeHTTPServerSocketTimeout(this: $Node.HttpServerSocket) {
  const req = this[kRequest];
  // Like Node.js's socketOnTimeout: the request only sees 'timeout' while its
  // message is still being received.
  const reqTimeout = req && !req.complete && req.emit("timeout", this);
  const res = this._httpMessage;
  const resTimeout = res && res.emit("timeout", this);
  const serverTimeout = this.server.emit("timeout", this);

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

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1367-L1368
function normalizeServerTls(tls: $Node.HttpServerTLSOptions) {
  tls.requestCert = tls.requestCert === true;
  tls.rejectUnauthorized = tls.rejectUnauthorized !== false;
  return tls;
}

// Node registers connectionListener on every http.Server so `server.emit("connection", socket)`
// works for foreign Duplex sockets. The native listener handles its own sockets end to end;
// this picks up the rest. https://github.com/nodejs/node/blob/main/lib/_http_server.js
function connectionListener(this: $Node.HttpServer, socket: $Node.HttpSocket) {
  // A tunnel socket that was handed to 'connect'/'upgrade' has left the native listener: re-emitted, it is a connection like any other.
  if (NodeHTTPServerSocket && socket instanceof NodeHTTPServerSocket && !socket[kHandedOff]) return;
  (http1Fallback ??= require("internal/http1_server_fallback")).connectionListenerHTTP1(this, socket, {
    http1Options: {
      IncomingMessage: this[kIncomingMessage],
      ServerResponse: this[kServerResponse],
    },
  });
}

/** One `listen()`: a native listener, and what `close()` has to know about it. */
interface ListenerGeneration {
  isUnix: boolean;
  nativeClosed: boolean;
  drainedAtClose: boolean;
}

type PipelinedOperation = [
  kind: "raw" | "write" | "end",
  chunk: $Node.HttpChunk | null | undefined,
  encoding: string | null | undefined,
  callback: $Node.HttpWriteCallback | null | undefined,
];

/** What a response holds while it waits behind the response in flight on its connection. */
interface PipelinedQueuedState {
  ops: PipelinedOperation[];
  bytes: number;
  headerBytes: number;
  needDrain: boolean;
  ended: boolean;
  isAncient: boolean;
  socket: $Node.HttpSocket;
}

type RequestListener = (request: $Node.IncomingMessage, response: $Node.ServerResponse) => void;

declare global {
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
      timeout: number;
      maxRequestsPerSocket: number | null;
      maxHeadersCount: number | null;
      maxConnections?: number;
      noDelay: boolean;
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
      [kServerResponse]: ServerResponseConstructor | undefined;
      [kConnectionsCheckingInterval]: Timeout | undefined;
      [kTrackedConnections]: Set<HttpServerSocket>;
      [kPendingDrainClose]: boolean;
      [kPendingCloseGenerations]: Set<ListenerGeneration>;
      [kListenerGeneration]: ListenerGeneration | undefined;
      [kHttpAllowHalfOpen]: boolean;
      [kMaxHeadersCount]: number | null;
      [kOptimizeEmptyRequests]: boolean;
    }

    type HttpServerConstructor = typeof Server;

    /** What the server keeps on every connection, its own sockets and the streams that were given to it. */
    interface HttpSocket {
      _requestCount?: number;
      [kHandedOff]?: boolean;
      [kUpgradeIncoming]?: IncomingMessage;
      /** In the order of their requests. */
      $pipelinedResponses?: PipelinedResponse[];
      [kOutgoingData]?: number;
      [kPipelineKickScheduled]?: boolean;
      [kSocketTimeoutTimer]?: Timeout;
      [kKeepAliveTimeoutSet]?: boolean;
      [kKeepAliveIdleStart]?: number;
    }

    /** A connection of the native listener: the class `Socket` of this module, which extends `net.Socket`. */
    interface HttpServerSocket extends HttpSocket {
      server: HttpServer;
      parser: HttpServerParserShim | null;
      _httpMessage: ServerResponse | null | undefined;
      _paused: boolean;
      _secureEstablished: boolean;
      bytesRead: number;
      bytesWritten: number;
      connecting: boolean;
      timeout: number;
      encrypted: boolean;
      resetAndClosing: boolean;
      remoteAddress: string | undefined;
      remoteFamily: string | undefined;
      remotePort: number | undefined;
      readonly localAddress: string | undefined;
      readonly localFamily: string | undefined;
      readonly localPort: number | undefined;
      setTimeout(msecs: number, callback?: () => void): this;
      destroySoon(): void;
      destroyNow(): void;
      _onTimeout(): void;
      _unrefTimer(): void;
      [kHandedOff]: boolean;
      [kUpgradeIncoming]: IncomingMessage | undefined;
      [kStreamingEnabled]: boolean;
      $armedTimeout: number;
      $isOpen: boolean;
      $isPrepared: boolean;
      $hasWaitingResponses: boolean;
      $writableMark: number;
      $readableMark: number;
      $ownReadableState: ReadableState;
      $ownWritableState: WritableState;
      [kKeepAliveTimeoutSet]?: boolean;
      [kSocketTimeoutTimer]?: Timeout;
      $pipelinedResponses: PipelinedResponse[] | undefined;
      [kDestroySoon]: boolean;
      [kBoundOnAbort]: ((event: number) => void) | null;
      [kKeepAliveIdleStart]: number | undefined;
      [kSocketBytesWritten]: number;
      [kStopParsingOnCloseListener]: boolean | undefined;
      [kEnableStreaming](enable: boolean): void;
    }

    /** A native response in `$pipelinedResponses`: it holds the turn of a request whose `ServerResponse` is not made yet. */
    interface PipelinedTurn extends NodeHTTPResponse {
      /** Never there, which tells it from a `ServerResponse` that waits. */
      [kPipelinedQueuedState]?: undefined;
    }

    type PipelinedResponse = ServerResponse | PipelinedTurn;

    interface ServerResponseOptions extends OutgoingMessageOptions {
      [kHandle]?: NodeHTTPResponse | Http1ResponseHandle;
      [kRejectNonStandardBodyWrites]?: boolean;
    }

    interface ServerResponse extends OutgoingMessage {
      req: IncomingMessage;
      statusCode: number;
      statusMessage: string | undefined;
      headersSent: boolean;
      writableCorked: number;
      _sent100: boolean;
      _ended: boolean;
      [kChunkedEncoding]: boolean;
      [kShouldKeepAlive]: boolean;
      [kMustCloseConnection]?: boolean;
      [kDetachedFrom]?: HttpServerSocket;
      [kBytesBuffered]?: number;
      [kAccountingFlushScheduled]?: boolean;
      [kSnapshotStatusCode]?: number;
      [kSnapshotStatusMessage]?: string;
      [kFramingFrozenChunked]?: boolean;
      [kImplicitHeaderFromEnd]?: boolean;
      [kReplayingPipelinedOps]?: boolean;
      [kPendingFinish]?: HttpWriteCallback | null;
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
      [kPipelinedQueuedState]: PipelinedQueuedState | undefined;
      $exchange: HttpExchange;
      [kServerResponseStatistics]?: object;
    }

    type ServerResponseConstructor = typeof ServerResponse;
  }
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

  this.prependListener("connection", (socket: $Node.HttpSocket | null | undefined) => {
    if (socket != null && typeof socket === "object") socket.server = this;
  });

  this._unref = false;
  this.timeout = 0;
  this.maxRequestsPerSocket = 0;
  defineMaxHeadersCount(this);
  defineHttpAllowHalfOpen(this);
  this[kInternalSocketData] = undefined;
  this[kTrackedConnections] = new Set();
  this[kPendingDrainClose] = false;
  this[kPendingCloseGenerations] = new Set();
  this[kListenerGeneration] = undefined;
  this[tlsSymbol] = null;
  this.noDelay = true;
  if (typeof options === "function") {
    callback = options;
    options = {};
  } else if (options == null) {
    options = {};
  } else {
    validateObject(options, "options");
    options = { ...options };
    const tlsHelpers =
      this[isTlsSymbol] || options.pfx || options.cert || options.key || options.ca
        ? require("internal/tls")
        : undefined;

    // Node's https.Server accepts PKCS#12 bundles (pfx [+ passphrase]); fold
    // them into plain key/cert/ca so the native TLS config sees PEM material.
    let tlsOptions = options;
    if (options.pfx) {
      tlsOptions = tlsHelpers!.processPfxOptions(options);
    }

    let cert = tlsOptions.cert;
    if (cert) {
      tlsHelpers!.throwOnInvalidTLSArray("options.cert", cert);
    }

    let key = tlsOptions.key;
    if (key) {
      tlsHelpers!.throwOnInvalidTLSArray("options.key", key);
    }

    let ca = tlsOptions.ca;
    // PKCS#12-embedded CAs extend the trust set; the server path hands raw
    // {key, cert, ca} to the native config and has no addCACert hook, so fold
    // them into `ca` (mirrors tls.Server.setSecureContext).
    const pfxExtraCAs = tlsOptions._pfxExtraCACerts;
    if (pfxExtraCAs?.length) {
      ca = ca == null ? pfxExtraCAs : $isArray(ca) ? [...ca, ...pfxExtraCAs] : [ca, ...pfxExtraCAs];
    }
    if (ca) {
      tlsHelpers!.throwOnInvalidTLSArray("options.ca", ca);
    }

    let passphrase = options.passphrase || undefined;
    if (passphrase && typeof passphrase !== "string") {
      throw $ERR_INVALID_ARG_TYPE("options.passphrase", "string", passphrase);
    }

    let serverName = options.servername;
    if (serverName && typeof serverName !== "string") {
      throw $ERR_INVALID_ARG_TYPE("options.servername", "string", serverName);
    }

    let secureOptions = options.secureOptions || 0;
    if (secureOptions && typeof secureOptions !== "number") {
      throw $ERR_INVALID_ARG_TYPE("options.secureOptions", "number", secureOptions);
    }

    if (tlsHelpers) {
      const { secureProtocolToVersionRange, tlsStringToProtocolVersion } = tlsHelpers;
      // A falsy value counts as absent: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1423-L1518
      const secureProtocol = options.secureProtocol || undefined;
      const minVersionOption = options.minVersion || undefined;
      const maxVersionOption = options.maxVersion || undefined;
      const sessionTimeout = options.sessionTimeout || undefined;
      tlsHelpers.validateSecureContextOptions({
        ...options,
        secureProtocol,
        minVersion: minVersionOption,
        maxVersion: maxVersionOption,
        sessionTimeout,
        passphrase,
        ciphers: options.ciphers || undefined,
        clientCertEngine: options.clientCertEngine || undefined,
        ticketKeys: options.ticketKeys || undefined,
        // BoringSSL has no DHE suites to apply it to.
        dhparam: undefined,
      });
      const crl = options.crl || undefined;
      if (crl) {
        tlsHelpers.throwOnInvalidTLSArray("options.crl", crl);
      }
      if (options.honorCipherOrder !== false) secureOptions |= tlsHelpers.SSL_OP_CIPHER_SERVER_PREFERENCE;
      // secureProtocol, or else minVersion/maxVersion, as the integer range the native layer applies; 0 keeps its defaults.
      let minVersion, maxVersion;
      const ciphers = options.ciphers ? tlsHelpers.stripTls13CipherNames(options.ciphers) : undefined;
      const range = secureProtocolToVersionRange(secureProtocol);
      if (range) {
        minVersion = range[0];
        maxVersion = range[1];
      } else {
        minVersion = tlsStringToProtocolVersion(ciphers?.tls13Only ? "TLSv1.3" : minVersionOption);
        maxVersion = tlsStringToProtocolVersion(maxVersionOption);
      }
      this[tlsSymbol] = normalizeServerTls({
        serverName,
        key: tlsHelpers.normalizePemKeyOption(key, passphrase),
        cert,
        ca,
        crl,
        sessionTimeout: sessionTimeout ?? 0,
        sigalgs: options.sigalgs,
        ecdhCurve: options.ecdhCurve ?? require("node:tls").DEFAULT_ECDH_CURVE,
        passphrase,
        secureOptions,
        minVersion,
        maxVersion,
        ciphers: ciphers?.cipherList || undefined,
        requestCert: options.requestCert,
        rejectUnauthorized: options.rejectUnauthorized,
      });
    }
  }

  this[optionsSymbol] = options;
  storeHTTPOptions.$call(this, options);

  if (callback) this.on("request", callback);
  return this;
}
$toClass(Server, "Server", EventEmitter);

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
}

// Node.js's checkConnections sweep: every connectionsCheckingInterval, expire
// connections whose in-flight request exceeded headersTimeout/requestTimeout.
// The per-connection timing lives on the native socket handle (the parser is
// native), so each tracked connection is asked whether it expired.
function checkConnections(this: $Node.HttpServer) {
  const headersTimeout = this.headersTimeout;
  const requestTimeout = this.requestTimeout;
  if (headersTimeout === 0 && requestTimeout === 0) {
    return;
  }

  const connections = this[kTrackedConnections];
  if (!connections || connections.size === 0) {
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
function onRequestTimeout(socket: $Node.HttpServerSocket) {
  socketOnError.$call(socket, $ERR_HTTP_REQUEST_TIMEOUT("Request timeout"));
}

Server.prototype.ref = function (this: $Node.HttpServer) {
  this._unref = false;
  this[serverSymbol]?.ref?.();
  return this;
};

Server.prototype.unref = function (this: $Node.HttpServer) {
  this._unref = true;
  this[serverSymbol]?.unref?.();
  return this;
};

Server.prototype.closeAllConnections = function (this: $Node.HttpServer) {
  http1Fallback?.closeAllHttp1Connections(this);
  // Like Node, the listener and the sockets handed to 'connect' and 'upgrade' listeners stay.
  const tracked = this[kTrackedConnections];
  if (tracked && tracked.size > 0) {
    for (const socket of $Array.from(tracked)) {
      if (!socket[kHandedOff]) socket.destroyNow();
    }
  }
};

Server.prototype.getConnections = function (
  this: $Node.HttpServer,
  callback: (error: Error | null, count: number) => void,
) {
  // Connections are tracked from the moment they are accepted (the native
  // server surfaces accepts through the onConnection callback).
  const count = this[kTrackedConnections]?.size ?? 0;
  if (typeof callback === "function") {
    process.nextTick(callback, null, count);
  }
  return this;
};

Server.prototype.closeIdleConnections = function (this: $Node.HttpServer) {
  http1Fallback?.closeIdleHttp1Connections(this);
  const server = this[serverSymbol];
  if (server) {
    server.closeIdleConnections();
    return;
  }
  const tracked = this[kTrackedConnections];
  if (tracked && tracked.size > 0) {
    for (const socket of $Array.from(tracked)) {
      // uWS knows whether a request is arriving on the connection. A missing _httpMessage does not tell.
      if (!socket[kHandedOff]) socket[kHandle]?.closeIfIdle();
    }
  }
};

Server.prototype.close = function (this: $Node.HttpServer, optionalCallback?: (error?: Error) => void) {
  const server = this[serverSymbol];
  // Node.js's httpServerPreClose clears the connections-checking interval
  // even when the server was never listening.
  clearInterval(this[kConnectionsCheckingInterval]);
  http1Fallback?.closeIdleHttp1Connections(this);
  if (!server) {
    if (typeof optionalCallback === "function") process.nextTick(optionalCallback, $ERR_SERVER_NOT_RUNNING());
    // Like Node.js's net.Server#close, close() returns the server.
    return this;
  }
  if (typeof optionalCallback === "function") this.once("close", optionalCallback);
  const generation = this[kListenerGeneration];
  if (generation) this[kPendingCloseGenerations].add(generation);
  this[serverSymbol] = undefined;
  this[kPendingDrainClose] = true;
  // Like Node, a connection that this sweep closes counts as gone, also a TLS one whose close ends later with the peer's close_notify.
  const open = getBunServerOpenCount(server);
  const swept = server.closeIdleConnections();
  if (generation) generation.drainedAtClose = open === swept;
  // stop() queues the task that emits 'close', which holds the loop one more turn, as node's uv_close() does.
  server.stop();
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
  let port: number | string | undefined, host: string | undefined;
  let socketPath: string | undefined;
  let tls = this[tlsSymbol];

  // This logic must align with:
  // - https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/net.js#L274-L307
  const argc = arguments.length;
  if (argc > 0) {
    const arg0 = arguments[0];
    if (($isObject(arg0) || $isCallable(arg0)) && arg0 !== null) {
      // (options[...][, cb])
      addServerAbortSignalOption(this, arg0);
      port = arg0.port;
      host = arg0.host;
      socketPath = arg0.path;

      const otherTLS = arg0.tls;
      if (otherTLS && $isObject(otherTLS)) {
        tls = normalizeServerTls({ __proto__: null, ...otherTLS });
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
  if (port === undefined && !socketPath) {
    port = 0;
  }

  if (typeof port === "string") {
    const portNumber = parseInt(port);
    if (!Number.isNaN(portNumber)) {
      port = portNumber;
    }
  }

  const lastArg = arguments[argc - 1];
  if ($isCallable(lastArg)) {
    // Before the bind, as in node, so a listen() retried from the 'error' handler still calls it.
    this.once("listening", lastArg);
  }

  try {
    // listenInCluster

    if (isPrimary) {
      server[kRealListen](tls, port, host, socketPath, false);
      return this;
    }

    if (cluster === undefined) cluster = loadChild();

    if (CAN_BE_CLUSTER_WORKER) {
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

      server[kRealListen](tls, port, host, socketPath, true);
    }
  } catch (err) {
    process.nextTick(emitListenErrorNextTick, server, err);
  }

  return this;
};

Server.prototype[kRealListen] = function (
  this: $Node.HttpServer,
  tls: $Node.HttpServerTLSOptions | null,
  port: number | string | undefined,
  host: string | undefined,
  socketPath: string | undefined,
  reusePort: boolean,
) {
  {
    // What the first connection and the first request need, so that neither waits for it.
    getNodeHTTPServerSocket();
    traceEvents ??= require("internal/trace_event_recorder");

    const ResponseClass = this[optionsSymbol].ServerResponse || ServerResponse;
    const RequestClass = this[optionsSymbol].IncomingMessage || IncomingMessage;
    const canUseInternalAssignSocket = ResponseClass?.prototype.assignSocket === ServerResponse.prototype.assignSocket;
    let server = this;
    let listenerGeneration: ListenerGeneration | undefined;
    const uniqueHeaders = this[kUniqueHeaders];
    const optimizeEmptyRequests = this[kOptimizeEmptyRequests];
    const usesOwnClasses =
      ResponseClass === ServerResponse &&
      RequestClass === IncomingMessage &&
      uniqueHeaders == null &&
      !optimizeEmptyRequests;

    if (tls) {
      this.serverName = tls.serverName || host || "localhost";
    }
    const dispatchInFull = function onNodeHTTPRequest(
      bunServer: $Node.NativeHTTPServer,
      url: string,
      method: string,
      // Native dispatch bitfield (kDispatch* in NodeHTTP.cpp): presence and token bits for the headers the dispatcher consults, so no header object or array is materialized unless user code reads them.
      dispatchBits: number,
      handle: $Node.NodeHTTPResponse,
      hasBody: boolean,
      socketHandle: $Node.NodeHTTPServerSocket,
      isSocketNew: boolean,
      socket: $Node.HttpServerSocket | null | undefined,
      isAncientHTTP: boolean,
      connectHead?: Buffer,
      isPipelinedDispatch?: boolean,
    ) {
      if (!socket) {
        socket = new (getNodeHTTPServerSocket())(server, socketHandle, !!tls, listenerGeneration);
      }

      if (isPipelinedDispatch) {
        // The native handle holds this request's turn until its response exists, also when a throw prevents that.
        socket.$hasWaitingResponses = true;
        (socket.$pipelinedResponses ??= []).push(handle);
        // For a throw before the kick below. drainMicrotasks() further down runs this one when nothing throws.
        kickPipelineIfIdle(server, socket);
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
      const requestAllowsKeepAlive = isAncientHTTP ? false : (dispatchBits & DISPATCH_CONN_CLOSE) === 0;
      http_req[kReqShouldKeepAlive] = requestAllowsKeepAlive;
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
      // Pipelined or not, like Node.js: the native parser is in tunnel mode from this request on.
      if (method === "CONNECT") {
        // Handle CONNECT method for HTTP tunneling/proxy
        if (server.listenerCount("connect") > 0) {
          // For CONNECT, emit the event and let the handler respond
          // Don't assign the socket to a response for CONNECT
          // The handler should write the raw response
          socket[kEnableStreaming](true);
          // The connection already parses as a CONNECT tunnel natively; this
          // additionally marks it half-open-capable so a client FIN ends the
          // readable side without tearing the tunnel down (allowHalfOpen).
          socketHandle.upgradeToTunnel(false, handle);
          socket[kHandoffResponse] = handle;
          // The parser is detached: the socket is handed over with only
          // net.Socket's 'end' listener left, like Node.js.
          detachSocketListenersForHandoff(socket);
          // Pass the pipelined data (head buffer) if any was received with the CONNECT request
          const head = connectHead ? connectHead : kEmptyBuffer;
          socket.bytesRead += head.length;
          // Node.js's parserOnIncoming: req.upgrade is true for CONNECT
          // regardless of shouldUpgradeCallback.
          http_req.upgrade = true;
          // Node frees the parser before handing the raw socket to 'connect'.
          releaseServerParserShim(socket, http_req);
          // llhttp completes a CONNECT request at the end of its head, before Node emits 'connect'.
          http_req.complete = true;
          try {
            server.emit("connect", http_req, socket, head);
          } catch (err) {
            // Like 'upgrade' below. Native would end the pending response, here the one ahead.
            process.nextTick(rethrowUncaught, err);
          }
          // Native would tie a returned promise to the socket's current response, the one in flight.
          if (isPipelined) return;
          // Attach the internal close listener after the user's "connect"
          // handler ran: Node.js hands the socket over with no listeners and
          // tests assert socket.listenerCount("close") === 0 there.
          const promise = $newPromise();
          socket.once("close", resolveHandoffPromise.bind(undefined, promise));
          return promise;
        } else {
          // Node.js will close the socket and will NOT respond with 400 Bad Request
          socketHandle.close();
        }
        return;
      }
      if (socket[kStreamingEnabled] !== false) socket[kEnableStreaming](false);

      let http_res: $Node.ServerResponse;
      if (ResponseClass === ServerResponse && RequestClass === IncomingMessage) {
        http_res = new ResponseClass(
          http_req,
          kHandle,
          handle,
          socket,
          socket.writableHighWaterMark ?? getDefaultHighWaterMark(),
          server.rejectNonStandardBodyWrites,
          server.keepAliveTimeout,
          method !== "HEAD",
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
          [kRejectNonStandardBodyWrites]: server.rejectNonStandardBodyWrites,
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
      if (uniqueHeaders != null) http_res[kUniqueHeaders] = uniqueHeaders;

      // The request itself forbids connection reuse (HTTP/1.0, or the
      // client sent Connection: close): end the server's writable side as
      // soon as the response has been written, like Node.js's resOnFinish.
      // Registered before the 'request' event so the socket is already
      // ended inside user 'finish' listeners. (Not done for the
      // maxRequestsPerSocket limit - pipelined requests past the limit
      // still need to be answered with 503.)
      if (!requestAllowsKeepAlive) {
        http_res.$exchange.mustClose = http_res[kMustCloseConnection] = true;
      }
      // One plain on() listener (once() allocates a wrapper, a second listener
      // deoptimizes every 'finish' emit), registered before the 'request' event
      // like Node's resOnFinish so res.on-replacing middleware cannot swallow it.
      if (ResponseClass !== ServerResponse || RequestClass !== IncomingMessage)
        http_res.on("finish", emitResponseFinish);

      if (hasObserver("http")) {
        startPerf(http_res, kServerResponseStatistics, {
          type: "http",
          name: "HttpRequest",
          detail: {
            req: {
              method: http_req.method,
              url: http_req.url,
              headers: http_req.headers,
            },
          },
        });
        http_res.once("finish", stopServerResponsePerf);
      }

      handle.onabort = socket[kBoundOnAbort] ??= onServerRequestEvent.bind(socket);
      // Like Node's connectionListener -> parserOnBody: body bytes flow into
      // the IncomingMessage as they arrive, and the push callback readStop()s
      // the socket (which emits 'pause' on it) once the buffer fills.
      if (hasBody) {
        handle.ondata = onBodyData.bind(http_req);
      }
      drainMicrotasks();

      if (isSocketNew) {
        server.emit("connection", socket);
      }

      // Target of the socket 'timeout' handler until this request's response detaches.
      socket[kRequest] = http_req;
      // Node.js (llhttp) only flags a request as an upgrade when it carries
      // both an Upgrade header and a Connection header with the "upgrade"
      // token; the server then consults shouldUpgradeCallback (default: an
      // 'upgrade' listener is installed) and otherwise dispatches the
      // request normally.
      // Pipelined requests never upgrade, because a queued native response can't.
      let is_upgrade = false;
      if (!isPipelined && (dispatchBits & DISPATCH_HAS_UPGRADE) !== 0 && (dispatchBits & DISPATCH_CONN_UPGRADE) !== 0) {
        // Like Node.js, shouldUpgradeCallback sees req.upgrade === true.
        http_req.upgrade = true;
        is_upgrade = !!server.shouldUpgradeCallback(http_req);
      }
      // Like Node.js's parserOnIncoming: req.upgrade is true inside the
      // 'upgrade' listener and false for a declined upgrade that falls
      // through to 'request'.
      http_req.upgrade = is_upgrade;
      if (isPipelined) {
        // A previous response on this connection has not finished yet: like
        // Node.js, this response is queued (res.socket === null) and its
        // writes are buffered until the in-flight response finishes and the
        // pipeline assigns it the socket (advanceResponsePipeline).
        socket.$pipelinedResponses?.pop(); // the turn that the native handle held
        queuePipelinedResponse(socket, http_res, !!isAncientHTTP);
        // A pipelined dispatch can arrive after the previous response finished and detached
        // (bytes still flushing keep it pending), leaving nothing in flight to advance the
        // queue. Kick the pipeline once this dispatch settles.
        kickPipelineIfIdle(server, socket);
        // Node's parserOnIncoming stops reading the connection once the bytes
        // queued on responses that do not own the socket yet reach the
        // socket's high water mark, so pipelined requests cannot flood it.
        if (!socket._paused && (socket[kOutgoingData] ?? 0) >= socket.writableHighWaterMark) {
          pausePipelineReads(socket);
        }
      } else if (!is_upgrade) {
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
      if (!isPipelined) {
        http_res.$exchange.awaitsClose = true;
        http_res[kCloseCallback] = onClose;
      }
      // Node traces every parsed request before Expect/limit routing
      // (parserOnIncoming); upgrades never reach that path.
      if (!is_upgrade) traceServerRequestStart(http_res);

      // Like Node.js: with the optimizeEmptyRequests server option,
      // requests without body headers skip the Readable life cycle (no
      // 'data'/'end'/'close' events) and arrive pre-dumped.
      if (
        optimizeEmptyRequests &&
        !is_upgrade &&
        (dispatchBits & (DISPATCH_HAS_CONTENT_LENGTH | DISPATCH_HAS_TRANSFER_ENCODING)) === 0
      ) {
        http_req._dumpAndCloseReadable();
      }

      // Node's parserOnIncoming never counts an accepted upgrade or a missing-Host 400 against maxRequestsPerSocket.
      let rejectMissingHost = false;
      let reachedRequestsLimit = false;
      // Node's parserOnIncoming counts requests and routes Expect for HTTP/1.1 only.
      const isHttp11 =
        RequestClass === IncomingMessage
          ? !isAncientHTTP
          : http_req.httpVersionMajor === 1 && http_req.httpVersionMinor === 1;
      if (!is_upgrade) {
        const maxRequestsPerSocket = server.maxRequestsPerSocket;
        if (
          server.requireHostHeader &&
          (dispatchBits & DISPATCH_HAS_HOST) === 0 &&
          http_req.httpVersionMajor === 1 &&
          http_req.httpVersionMinor! >= 1
        ) {
          // The native parser skips its Host check for Upgrade requests; one dispatched normally still needs it.
          rejectMissingHost = true;
        } else if (isHttp11 && typeof maxRequestsPerSocket === "number" && maxRequestsPerSocket > 0) {
          const requestCount = (socket._requestCount || 0) + 1;
          socket._requestCount = requestCount;
          http_res._maxRequestsPerSocket = maxRequestsPerSocket;
          // <= like Node: the response that uses up the limit, and every 503 after it, advertises Connection: close.
          http_res.maxRequestsOnConnectionReached = maxRequestsPerSocket <= requestCount;
          reachedRequestsLimit = maxRequestsPerSocket < requestCount;
        }
      }

      if (reachedRequestsLimit) {
        server.emit("dropRequest", http_req, socket);
        http_res.writeHead(503);
        http_res.end();
        if (isPipelined) {
          // The 503 is queued behind the in-flight responses; the connection
          // closes once it has been written, like Node.js (Connection: close).
          http_res.$exchange.mustClose = http_res[kMustCloseConnection] = true;
        } else {
          socket.destroy();
        }
      } else if (is_upgrade) {
        // Hand the raw socket over to the 'upgrade' listener, like Node.js.
        // Without a body the message is already complete: bytes that arrived
        // after the request head become the upgradeHead and the connection
        // switches into CONNECT-style tunnel mode immediately. With a body
        // (Node 26 semantics) the body keeps being parsed and delivered
        // through req; the connection only switches to tunnel mode once the
        // message completes, so the upgradeHead is empty and everything after
        // the end of the message reaches the socket as raw data.
        socketHandle.upgradeToTunnel(hasBody, handle);
        socket[kHandoffResponse] = handle;
        socket[kEnableStreaming](true);
        detachSocketListenersForHandoff(socket);
        // Node frees the parser before emitting 'upgrade' (socket.parser === null there).
        releaseServerParserShim(socket, http_req);
        if (hasBody) {
          socket[kUpgradeIncoming] = http_req;
          http_req.once("end", clearUpgradeIncoming.bind(undefined, socket));
        } else {
          http_req.complete = true;
        }
        const upgradeHead = !hasBody && connectHead ? connectHead : kEmptyBuffer;
        socket.bytesRead += upgradeHead.length;
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
        // Like CONNECT: the connection is detached from the HTTP request
        // machinery; hold the native callback open until the raw socket
        // closes.
        const upgradePromise = $newPromise();
        socket.once("close", resolveHandoffPromise.bind(undefined, upgradePromise));
        return upgradePromise;
      } else if (rejectMissingHost) {
        http_res.writeHead(400, { Connection: "close" });
        http_res.end();
      } else {
        if (isHttp11 && (dispatchBits & DISPATCH_HAS_EXPECT) !== 0) {
          // Case-insensitive, token-boundary match like Node's
          // parserOnIncoming (RFC 7231 5.1.1: expectation values compare
          // case-insensitively); computed natively into the bitfield.
          if ((dispatchBits & DISPATCH_EXPECT_CONTINUE) !== 0) {
            if (server.listenerCount("checkContinue") > 0) {
              server.emit("checkContinue", http_req, http_res);
            } else {
              http_res.writeContinue();
              server.emit("request", http_req, http_res);
            }
          } else if (server.listenerCount("checkExpectation") > 0) {
            server.emit("checkExpectation", http_req, http_res);
          } else {
            http_res.writeHead(417);
            http_res.end();
          }
        } else {
          try {
            server.emit("request", http_req, http_res);
          } catch (error) {
            sendWhatIsHeld(http_res);
            throw error;
          }
        }
      }

      // Node's parserOnMessageComplete: a message without a body is complete once the listener returns. EOF stays lazy (_read).
      if (!hasBody) http_req.complete = true;

      if (isPipelined) {
        // Completion of a queued response is tracked through the pipeline
        // (advanceResponsePipeline) and its native handle, not this dispatch.
        return;
      }

      if (handle.finished || !http_res.$exchange.awaitsClose) {
        handle = undefined!;
        // Set in time only because end() defers the 'finish' emit to a
        // process.nextTick (see ServerResponse.prototype.end) and nothing
        // between the 'request' emit and here drains the tick queue.
        http_res.$exchange.awaitsClose = false;
        http_res[kCloseCallback] = undefined;
        http_res.$exchange.detachedFrom = http_res[kDetachedFrom] = socket;
        http_res.detachSocket(socket);
        if (socket.$pipelinedResponses !== undefined) {
          advanceResponsePipeline(server, socket);
        }
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
      reusePort,
      maxRequestBodySize: Number.MAX_SAFE_INTEGER,

      onNodeHTTPRequest(
        bunServer: $Node.NativeHTTPServer,
        url: string,
        method: string,
        // Native dispatch bitfield (kDispatch* in NodeHTTP.cpp): presence and token bits for the headers the dispatcher consults, so no header object or array is materialized unless user code reads them.
        dispatchBits: number,
        handle: $Node.NodeHTTPResponse,
        hasBody: boolean,
        socketHandle: $Node.NodeHTTPServerSocket,
        isSocketNew: boolean,
        socket: $Node.HttpServerSocket | null | undefined,
        isAncientHTTP: boolean,
        connectHead?: Buffer,
        isPipelinedDispatch?: boolean,
      ) {
        if (
          socket != null &&
          usesOwnClasses &&
          !isAncientHTTP &&
          !isSocketNew &&
          !socket._httpMessage &&
          socket._readableState === socket.$ownReadableState &&
          readsHighWaterMarksUnseen(socket) &&
          isPipelinedDispatch !== true &&
          (dispatchBits & DISPATCH_USUAL_MASK) === DISPATCH_HAS_HOST &&
          !server.joinDuplicateHeaders &&
          !server.maxRequestsPerSocket &&
          method !== "CONNECT" &&
          !hasObserver("http") &&
          !traceEvents.isCategoryGroupEnabled(kHttpTraceCat) &&
          (socket.$isPrepared || prepareSocket(socket))
        ) {
          return onNodeHTTPRequest(server, url, method, handle, socket, hasBody);
        }
        return dispatchInFull(
          bunServer,
          url,
          method,
          dispatchBits,
          handle,
          hasBody,
          socketHandle,
          isSocketNew,
          socket,
          isAncientHTTP,
          connectHead,
          isPipelinedDispatch,
        );
      },
    });

    const handle = this[serverSymbol]!;
    listenerGeneration = {
      isUnix: !!socketPath,
      nativeClosed: false,
      drainedAtClose: false,
    };
    this[kListenerGeneration] = listenerGeneration;
    getBunServerAllClosedPromise(handle).$then(emitCloseNTServer.bind(this, listenerGeneration));
    applyServerCustomOptions(this);

    if (this?._unref) {
      this[serverSymbol]?.unref?.();
    }

    // A tick, not a timer, as in node: a timer never fires on its own under jest.useFakeTimers().
    process.nextTick(emitListeningNextTick, this, this[serverSymbol]?.hostname, this[serverSymbol]?.port);
  }
};

function prepareSocket(socket: $Node.HttpServerSocket): boolean {
  if (socket[kStreamingEnabled] || socket[kHandedOff] || !socket.$isOpen) return false;
  if (socket.parser === null) socket.parser = createServerParserShim(socket);
  if (socket[kBoundOnAbort] === null) socket[kBoundOnAbort] = onServerRequestEvent.bind(socket);
  if (!socket[kStopParsingOnCloseListener]) {
    socket[kRequest] = undefined;
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
  } else if (socket.$armedTimeout !== 0) {
    socket[kSocketTimeoutTimer]!.refresh();
  }

  const req: $Node.IncomingMessage = new IncomingMessage(
    kHandle,
    url,
    method,
    handle,
    hasBody,
    socket,
    socket.$readableMark,
  );
  let parser = socket.parser;
  if (parser == null) parser = socket.parser = createServerParserShim(socket);
  parser.incoming = req;

  const res: $Node.ServerResponse = new ServerResponse(
    req,
    kHandle,
    handle,
    socket,
    socket.$writableMark,
    server.rejectNonStandardBodyWrites,
    server.keepAliveTimeout,
    method !== "HEAD",
  );
  handle.onabort = socket[kBoundOnAbort]!;
  if (hasBody) handle.ondata = onBodyData.bind(req);
  socket[kRequest] = req;
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

  try {
    server.emit("request", req, res);
  } catch (error) {
    if ((exchange.flags & EXCHANGE_HOLDS_CHUNK) !== 0) sendHeldChunk(res, exchange);
    throw error;
  }

  if (!hasBody) req.complete = true;

  if ((exchange.flags & EXCHANGE_ENDED_CLEAN) !== 0 && detachesItself(res) && removesListenersUnseen(socket)) {
    exchange.awaitsClose = false;
    try {
      res[kCloseCallback] = undefined;
      exchange.detachedFrom = res[kDetachedFrom] = socket;
      if (socket._httpMessage === res) {
        socket[kCloseCallback] = undefined;
        socket._httpMessage = null;
        socket[kRequest] = undefined;
      }
      res[fakeSocketSymbol] = null;
      res[kSocket] = null;
      return undefined;
    } catch {
      // One of the two takes no stores. The same stores again, from the functions of the full road.
    }
  } else if (
    exchange.awaitsClose &&
    !(
      (res.finished || res.destroyed || !socket.$isOpen || (exchange.flags & EXCHANGE_HAS_STAND_IN) !== 0) &&
      handle.finished
    )
  ) {
    return (exchange.dispatchPromise = $newPromise());
  }
  exchange.awaitsClose = false;
  res[kCloseCallback] = undefined;
  exchange.detachedFrom = res[kDetachedFrom] = socket;
  res.detachSocket(socket);
  return undefined;
}

// Pushes the per-server parser/handler options down to the native listener.
// Always sets strict method validation, for node.js compatibility.
function applyServerCustomOptions(server: $Node.HttpServer) {
  const handle = server[serverSymbol];
  if (!handle) return;
  setServerCustomOptions(
    handle,
    server.requireHostHeader,
    true,
    serverLenientFlags(server),
    typeof server.maxHeaderSize !== "undefined" ? server.maxHeaderSize : getMaxHTTPHeaderSize(),
    onServerClientError.bind(server, server[kListenerGeneration]),
    onServerConnection.bind(server, server[kListenerGeneration]),
    !!server.httpAllowHalfOpen,
  );
  setServerMaxHeadersCount(handle, nativeMaxHeadersCount(server.maxHeadersCount));
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
  if (handle) setServerAppFlags(handle, this.requireHostHeader, true, serverLenientFlags(this), next);
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

// Native callback fired when the server accepts a connection (for TLS, when
// its handshake completes), before any request bytes - like Node.js's
// net.Server 'connection' / tls.Server 'secureConnection' events.
function onServerConnection(
  this: $Node.HttpServer,
  listenerGeneration: ListenerGeneration | undefined,
  socketHandle: $Node.NodeHTTPServerSocket,
) {
  if (socketHandle.duplex) {
    // Already wrapped (shouldn't happen for a brand-new connection).
    return;
  }
  const isTLS = !!this[tlsSymbol];
  const socket = new (getNodeHTTPServerSocket())(this, socketHandle, isTLS, listenerGeneration);

  // Node's net.Server accept path refuses at maxConnections and emits 'drop'; the native
  // listener bypasses that, so gate it here. `>` (not Node's `>=`) because the constructor
  // above already tracked this socket in the count.
  const maxConnections = this.maxConnections;
  const tracked = this[kTrackedConnections];
  if (maxConnections != null && (tracked?.size ?? 0) > maxConnections) {
    tracked?.delete(socket);
    const data = {
      localAddress: socket.localAddress,
      localPort: socket.localPort || socketHandle.localPort,
      localFamily: socket.localFamily,
      remoteAddress: socket.remoteAddress,
      remotePort: socket.remotePort,
      remoteFamily: socket.remoteFamily || "IPv4",
    };
    socket.destroy();
    this.emit("drop", data);
    return;
  }

  // https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L2338-L2346
  const blockList = this.blockList;
  if (blockList) {
    const remoteAddress = socket.remoteAddress;
    const addressType = isIP(remoteAddress);
    if (addressType) {
      let blocked = true;
      try {
        blocked = !!blockList.check(remoteAddress!, `ipv${addressType}`);
      } finally {
        if (blocked) {
          tracked?.delete(socket);
          socket.destroy();
        }
      }
      if (blocked) return;
    }
  }

  // Node's connectionListener attaches the HTTPParser (socket.parser) before
  // emitting 'connection'; expose the shim here so listeners see it populated.
  socket.parser = createServerParserShim(socket);
  this.emit("connection", socket);
  if (isTLS && socketHandle.secureEstablished) {
    this.emit("secureConnection", socket);
  }
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
    case NodeHTTPResponseAbortEvent.abort: {
      if (!socket.destroyed) {
        socket.destroy();
      }
      break;
    }
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
  HTTP_PARSER_ERROR_MISSING_HOST_HEADER = 4,
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
}
// Native callback fired when the HTTP parser rejects incoming bytes. Builds
// the same error object Node's parser produces and routes it through
// socketOnError, exactly like Node's onParserExecuteCommon: the server's
// 'clientError' listener (or the default handler) decides what to write back
// and when to destroy the connection.
function onServerClientError(
  this: $Node.HttpServer,
  listenerGeneration: ListenerGeneration | undefined,
  ssl: boolean,
  socket: $Node.NodeHTTPServerSocket,
  errorCode: number,
  rawPacket: ArrayBuffer,
) {
  const self = this;
  // A prior request on this keep-alive connection may already have wrapped
  // the native handle (the native side returns the existing handle); a second
  // wrapper would overwrite its onclose/duplex and strand the first one in
  // kTrackedConnections. Reuse it, and only announce genuinely new
  // connections - the existing duplex already had its 'connection' event.
  const existingDuplex = socket.duplex;
  const nodeSocket = existingDuplex ?? new (getNodeHTTPServerSocket())(self, socket, ssl, listenerGeneration);
  if (!existingDuplex) {
    nodeSocket.parser = createServerParserShim(nodeSocket);
    self.emit("connection", nodeSocket);
  }

  if (errorCode === HttpParserError.HTTP_PARSER_ERROR_MISSING_HOST_HEADER) {
    replyMissingHostHeader(nodeSocket);
    return;
  }

  let err;
  switch (errorCode) {
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_CHUNKED_ENCODING:
      err = $HPE_INVALID_CHUNK_SIZE("Parse Error: Invalid character in chunk size");
      break;
    case HttpParserError.HTTP_PARSER_ERROR_INVALID_CONTENT_LENGTH:
      err = $HPE_UNEXPECTED_CONTENT_LENGTH("Parse Error");
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
  err.rawPacket = Buffer.from(rawPacket);
  socketOnError.$call(nodeSocket, err);
}

// Node answers an HTTP/1.1 request with no Host header from parserOnIncoming
// (res.writeHead(400, ['Connection', 'close']); res.end()), so no parse error
// reaches socketOnError and 'clientError' never fires for it.
function replyMissingHostHeader(socket: $Node.HttpServerSocket) {
  if (!socket.writable) return;
  socket.write(
    `HTTP/1.1 400 Bad Request\r\nConnection: close\r\nDate: ${new Date().toUTCString()}\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n`,
  );
  socket.destroySoon();
}

// Snapshot of bytesWritten, taken when the socket releases its native handle.
const kSocketBytesWritten = Symbol("kBytesWritten");
// Raw socket.write() bytes plus the bytes the current response wrote (its body, or a WebSocket's 101).
function handleBytesWritten(handle: $Node.NodeHTTPServerSocket) {
  return handle.bytesWritten + (handle.response?.getBytesWritten() ?? 0);
}
const kEnableStreaming = Symbol("kEnableStreaming");
// Upgrade request whose body is still being parsed: reading the raw socket also
// resumes this request, like Node.js's UpgradeStream._read, so an unread body
// can never stall the upgrade data behind it.
const kUpgradeIncoming = Symbol("kUpgradeIncoming");

// Like Node.js's net.Socket onReadableStreamEnd: every socket carries one 'end'
// listener. http server connections have allowHalfOpen: true, so it is a no-op,
// but its presence is part of the listener set handed to 'connect'/'upgrade'.
function onReadableStreamEnd() {}

function clearUpgradeIncoming(socket: $Node.HttpServerSocket) {
  socket[kUpgradeIncoming] = undefined;
}

// Node's UpgradeStream._read: resume the request only while its body is incomplete.
function resumePausedUpgradeIncoming(socket: $Node.HttpSocket) {
  const req = socket[kUpgradeIncoming];
  if (req == null) return;
  const response = socket[kHandle]?.response;
  if (response && (response.hasBody & NodeHTTPBodyReadState.done) !== 0) {
    socket[kUpgradeIncoming] = undefined;
  } else {
    req.resume();
  }
}

// Node.js hands the connection over to 'connect'/'upgrade' listeners with the
// connection-listener set removed (onParserExecuteCommon removes its data/end/
// close/drain/error/timeout listeners) and only net.Socket's own 'end' listener
// left in place.
function detachSocketListenersForHandoff(socket: $Node.HttpServerSocket) {
  socket[kHandedOff] = true;
  socket.removeListener("error", socketOnError);
  socket.removeListener("timeout", onNodeHTTPServerSocketTimeout);
  socket.on("end", onReadableStreamEnd);
  // Like Node's onParserExecuteCommon: a flowing socket would drop tunnel bytes that arrive before the listener attaches a reader.
  socket.readableFlowing = null;
}
function resolveHandoffPromise(promise: Promise<unknown>) {
  $resolvePromise(promise, undefined);
}
const kStreamingEnabled = Symbol("kStreamingEnabled");
// destroySoon() was called: native lets the read that is being parsed reach the request, then closes right behind the FIN.
const kDestroySoon = Symbol("kDestroySoon");
// Per-socket cached bound abort handler (the socket outlives its requests).
const kBoundOnAbort = Symbol("kBoundOnAbort");
// When the keep-alive idle period on a connection started (the last response
// finish). onResponseFinishHandleSocket records this instead of rescheduling
// the socket timer on every response; onSocketTimeoutTimerExpired reads it to
// grant the remaining idle budget when the timer actually fires.
const kKeepAliveIdleStart = Symbol("keepAliveIdleStart");
// HTTP/1.1 pipelining (responses queued behind an in-flight response):
// - `$pipelinedResponses` on the socket: array of queued ServerResponses, in arrival order
// - on a queued response: { ops, bytes, needDrain, ended, isAncient } while it
//   is queued (undefined once it owns the socket)
const kPipelinedQueuedState = Symbol("kPipelinedQueuedState");
// Node's `state.outgoingData`: bytes buffered across this connection's queued
// responses. Reads are paused while it is at or above the high water mark.
const kOutgoingData = Symbol("kOutgoingData");
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
function socketOnError(this: $Node.HttpServerSocket, err: Error) {
  // Ignore further errors
  this.removeListener("error", socketOnError);
  this.on("error", noopOnError);

  const server = this.server;
  if (!server || !server.emit("clientError", err, this)) {
    // Caution must be taken to avoid corrupting the remote peer.
    // Reply an error segment if there is no in-flight `ServerResponse`,
    // or no data of the in-flight one has been written yet to this socket.
    const message = this._httpMessage;
    // Node checks _headerSent (bytes reached the socket), not headersSent
    // (writeHead called): after res.writeHead() but before write/end/flush,
    // no bytes are on the wire yet so the raw error response is still safe.
    if (this.writable && (!message || message[headerStateSymbol] !== NodeHTTPHeaderState.sent)) {
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
      // Write through the native handle so the raw error response reaches the
      // wire before the destroy below, regardless of the duplex's cork state.
      const handle = this[kHandle];
      if (handle && !handle.closed) {
        handle.write(response);
      } else {
        this.write(response);
      }
    }
    this.destroy(err);
  }
}
function noopOnError() {}

function onSocketTimeoutTimerExpired(socket: $Node.HttpServerSocket) {
  // The keep-alive idle timer is left armed across the request to avoid a
  // clear + setTimeout cycle per request. A fire while a request is in
  // flight (kKeepAliveTimeoutSet was cleared on request arrival) is stale;
  // re-arm the timer so the response-finish fast path, which relies on it
  // staying live, keeps working, and bail. This runs at most once per idle
  // interval per busy connection, not once per request.
  if (socket.timeout === 0 && !socket[kKeepAliveTimeoutSet]) {
    socket[kSocketTimeoutTimer]?.refresh();
    return;
  }
  // onResponseFinishHandleSocket records when the last response finished
  // instead of rescheduling the timer on every response, so the timer's
  // deadline may predate the start of the real idle period. Grant the
  // remaining budget once, measured from that last finish. Gated on
  // kKeepAliveTimeoutSet so a fire of the server's regular per-socket
  // timeout (socket.timeout !== 0 with no response outstanding) never
  // consumes a stale keep-alive idle mark.
  const idleStart = socket[kKeepAliveIdleStart];
  if (idleStart !== undefined && socket[kKeepAliveTimeoutSet]) {
    socket[kKeepAliveIdleStart] = undefined;
    const remaining = socket.timeout - (DateNow() - idleStart);
    if (remaining > 0) {
      const existingTimer = socket[kSocketTimeoutTimer];
      if (existingTimer !== undefined) clearTimeout(existingTimer);
      const timer: $Node.Timeout = setTimeout(onSocketTimeoutTimerExpired, remaining, socket);
      timer.unref();
      socket[kSocketTimeoutTimer] = timer;
      socket.$armedTimeout = remaining;
      return;
    }
  }
  // A fired keep-alive idle timer is dead; drop the reference so the next
  // response-finish re-arms via setTimeout instead of trusting a fired
  // timer whose _idleTimeout still matches (a 'timeout' listener may keep
  // the socket alive). Only for the keep-alive case: the server.timeout
  // path relies on _unrefTimer() refreshing the fired timer in the slot,
  // like net.Socket.
  if (socket[kKeepAliveTimeoutSet]) {
    socket[kSocketTimeoutTimer] = undefined;
    socket.$armedTimeout = 0;
  }
  socket._onTimeout();
}

// Extends net.Socket so server connection sockets satisfy Node's class
// contract (`req.socket instanceof net.Socket`); all I/O still goes through
// the native NodeHTTP handle, not a net handle.
let NodeHTTPServerSocket: NodeHTTPServerSocketConstructor | undefined;
interface NodeHTTPServerSocketConstructor {
  new (
    server: $Node.HttpServer,
    handle: $Node.NodeHTTPServerSocket,
    encrypted: boolean,
    listenerGeneration: ListenerGeneration | undefined,
  ): $Node.HttpServerSocket;
  prototype: any;
}
/** What the class below takes from `net.Socket`. Its `server` is an `http.Server`, so it is no `$Node.Socket`. */
interface NetSocketBase extends $Node.Duplex {
  destroySoon(): void;
}
interface NetSocketConstructor {
  new (options?: $Node.SocketOptions): NetSocketBase;
  prototype: any;
}
/** What the handle can no longer tell once the connection has closed. */
interface RememberedPeer {
  remoteAddress: $Node.SocketAddressInfo | null;
  servername: string | null;
  peerCertVerified: boolean;
  authorizationError: string | null;
}
let serverSocketResume: (() => $Node.HttpServerSocket) | undefined;
let serverSocketSetTimeout: $Node.HttpServerSocket["setTimeout"] | undefined;
let netSocketResume: (() => NetSocketBase) | undefined;
let netSocketPrototype: { resume: unknown } | undefined;
let serverSocketPrototype: object | undefined;
function getNodeHTTPServerSocket(): NodeHTTPServerSocketConstructor {
  if (NodeHTTPServerSocket) return NodeHTTPServerSocket;
  require("node:net");
  const NetSocket = netConstructors.Socket as unknown as NetSocketConstructor;
  const NetSocketPrototype = NetSocket.prototype;
  const { getTimerDuration } = require("internal/timers");
  const resumeUnlessFlowing = function (this: $Node.HttpServerSocket, asksWhetherReadable: boolean) {
    if (!readsFlowUnseen(this)) {
      ("unlikely");
      if (!asksWhetherReadable || this.readable) this.resume();
      return;
    }
    if (
      !((IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(this, "resume")) || this.resume === serverSocketResume) ||
      NetSocketPrototype.resume !== netSocketResume ||
      DuplexPrototype.resume !== duplexResume ||
      this[kStreamingEnabled] ||
      (flagsOf(this._readableState) & (kFlowing | kHasPaused | kPaused)) !== (kFlowing | kHasPaused) ||
      this[kUpgradeIncoming] !== undefined
    ) {
      this.resume();
    }
  };
  NodeHTTPServerSocket = class Socket extends NetSocket {
    bytesRead = 0;
    connecting = false;
    timeout = 0;
    parser: $Node.HttpServerParserShim | null = null;
    [kStreamingEnabled] = false;
    [kBoundOnAbort]: ((event: number) => void) | null = null;
    [kKeepAliveIdleStart]: number | undefined = undefined;
    $pipelinedResponses: $Node.PipelinedResponse[] | undefined = undefined;
    declare [kKeepAliveTimeoutSet]?: boolean;
    declare [kSocketTimeoutTimer]?: $Node.Timeout;
    $armedTimeout = 0;
    $isOpen = true;
    $isPrepared = false;
    $hasWaitingResponses = false;
    $writableMark = 0;
    $readableMark = 0;
    $ownReadableState: $Node.ReadableState;
    $ownWritableState: $Node.WritableState;
    declare $resumeUnlessFlowing?: (this: $Node.HttpServerSocket, asksWhetherReadable: boolean) => void;
    declare [kRequest]: $Node.IncomingMessage | undefined;
    declare [kCloseCallback]: ((this: $Node.HttpServerSocket) => void) | undefined;
    declare [kStopParsingOnCloseListener]: boolean | undefined;
    [kSocketBytesWritten] = 0;
    [kClosedWithUnsentData]: boolean | undefined = undefined;
    [kHandle]: $Node.NodeHTTPServerSocket | null | undefined;
    [kUpgradeIncoming]: $Node.IncomingMessage | undefined = undefined;
    [kOnReadParsed]: ((socket: $Node.HttpSocket) => void) | undefined = undefined;
    [kHandoffResponse]: $Node.NodeHTTPResponse | undefined = undefined;
    [kDestroySoon] = false;
    [kHandedOff] = false;
    server: $Node.HttpServer;
    _httpMessage: $Node.ServerResponse | null | undefined = undefined;
    _secureEstablished = false;
    // Node's connectionListener sets socket._paused when it stops reading a
    // connection whose pipelined responses have buffered past the high water mark.
    _paused = false;
    #pendingCallback: $Node.ErrorCallback | null = null;
    #pendingAbortMessage: $Node.ServerResponse | null | undefined;
    #closeHandled = false;
    #peer: RememberedPeer | undefined;
    #closingHandle: $Node.NodeHTTPServerSocket | undefined;
    #resetSupported: boolean;
    #closeError: Error | undefined = undefined;
    declare encrypted: boolean;
    declare resetAndClosing: boolean;
    declare writableBuffer: { chunk: Buffer }[];
    constructor(
      server: $Node.HttpServer,
      handle: $Node.NodeHTTPServerSocket,
      encrypted: boolean,
      listenerGeneration: ListenerGeneration | undefined,
    ) {
      // allowHalfOpen: node's connectionListener sockets never auto-end the
      // writable side on the peer's FIN (CONNECT/Upgrade tunnels stay writable);
      // net.Socket would otherwise default it to false.
      super(
        server[kHighWaterMark] !== undefined
          ? { highWaterMark: server[kHighWaterMark], allowHalfOpen: true }
          : { allowHalfOpen: true },
      );
      // net.Socket's constructor wires net-handle machinery this class replaces:
      // its 'end' listener installs writeAfterFIN (breaks half-open tunnels), and
      // it forces emitClose/decodeStrings off while this class relies on the
      // Duplex defaults (destroy() emits 'close'; _write receives decoded chunks).
      this.removeAllListeners("end");
      this._writableState.emitClose = true;
      this._readableState.emitClose = true;
      this._writableState.decodeStrings = true;
      this.$ownReadableState = this._readableState;
      this.$ownWritableState = this._writableState;
      this.$writableMark = +this.writableHighWaterMark;
      this.$readableMark = +this.readableHighWaterMark;
      if (IS_COMPILED_AHEAD_OF_TIME) this.$resumeUnlessFlowing = resumeUnlessFlowing;
      this.server = server;
      this.#resetSupported = !encrypted && !listenerGeneration?.isUnix;
      this[kHandle] = handle;
      this._secureEstablished = !!handle?.secureEstablished;
      handle.onclose = this.#onClose.bind(this);
      handle.duplex = this;

      this.encrypted = encrypted;
      this.on("timeout", onNodeHTTPServerSocketTimeout);
      // Like Node.js's socketOnError: connection errors are routed to the
      // server's 'clientError' event instead of crashing as unhandled 'error'
      // events on the socket.
      this.on("error", socketOnError);
      server[kTrackedConnections]?.add(this);
      // Like Node.js's connectionListener: server.setTimeout's per-socket
      // inactivity timeout is armed when the connection is established.
      const serverTimeout = server.timeout;
      if (serverTimeout) {
        this.setTimeout(serverTimeout);
      }
    }

    get bytesWritten() {
      sendWhatIsHeld(this._httpMessage);
      const handle = this[kHandle];
      let bytes = handle ? handleBytesWritten(handle) : this[kSocketBytesWritten];
      // Like net.Socket, include writes still queued in the Writable.
      const queued = this.writableBuffer;
      for (let i = 0; i < queued.length; i++) bytes += queued[i].chunk.length;
      return bytes;
    }
    set bytesWritten(value) {
      this[kSocketBytesWritten] = value;
    }

    // Called when an 'upgrade' or 'connect' listener, or `ws` from a 'request' listener, takes the connection over. Its
    // 'close' listeners run after the handle is gone and still ask who the peer was, and the handle can't answer once the
    // connection has closed.
    [kRememberPeer]() {
      const handle = this[kHandle];
      if (!handle) return;
      this.#peer = {
        remoteAddress: handle.remoteAddress,
        servername: handle.servername,
        peerCertVerified: handle.peerCertVerified,
        authorizationError: handle.authorizationError,
      };
    }

    [kEnableStreaming](enable: boolean) {
      // The common keep-alive request never streams: the dispatcher disables
      // streaming on every request, so track the state and skip the two native
      // setter crossings (writing undefined over undefined) when unchanged.
      if (this[kStreamingEnabled] === enable) {
        return;
      }
      const handle = this[kHandle];
      if (handle) {
        this[kStreamingEnabled] = enable;
        if (enable) {
          this.$isPrepared = false;
          handle.ondata = this.#onData.bind(this);
          handle.ondrain = this.#onDrain.bind(this);
          this[kRememberPeer]();
        } else {
          handle.ondata = undefined;
          handle.ondrain = undefined;
        }
      }
    }
    #onDrain() {
      const callback = this.#pendingCallback;
      if (callback) {
        this.#pendingCallback = null;
        callback();
      }
      this.emit("drain");
    }
    #onData(chunk: Buffer | undefined, last: boolean) {
      this._unrefTimer();
      if (chunk) {
        this.bytesRead += chunk.length;
        // A full buffer stops the reads: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/stream_base_commons.js#L191-L198
        if (this.push(chunk) === false && !last) {
          this[kHandle]?.readStop();
        }
      }
      if (last) {
        const handle = this[kHandle];
        if (handle) {
          handle.ondata = undefined;
          this[kStreamingEnabled] = false;
          // The peer finished its writable side of a CONNECT/Upgrade tunnel. The
          // connection stays writable (allowHalfOpen), but - like Node, where the
          // detached socket stops reading and no longer keeps the process alive -
          // the never-used response for this request must not keep the event loop
          // alive either.
          // Not handle.response: behind a pipelined CONNECT that is the response in flight.
          this[kHandoffResponse]?.unref();
        }

        this.push(null);
        // Like Node's net.Socket (and its UpgradeStream): EOF on a socket with no
        // pending data emits 'end' even when nothing is reading the socket.
        if (this.readableLength === 0) {
          this.resume();
        }
      }
    }
    #closeHandle(handle: $Node.NodeHTTPServerSocket, callback: $Node.ErrorCallback, err?: Error | null) {
      this[kSocketBytesWritten] = handleBytesWritten(handle);
      this[kHandle] = undefined;
      this.$isOpen = false;
      // Capture the in-flight response before detachSocket() can clear it: a
      // synchronous res.destroy() inside the request handler runs detachSocket()
      // between here and the native close delivering #onClose. The abort itself
      // is deferred to #onClose so the dispatch promise resolves only after the
      // native on_abort has released the pending-request ref.
      this.#pendingAbortMessage = this._httpMessage;
      this.#closingHandle = handle;
      handle.onclose = this.#onCloseForDestroy.bind(this, callback, err, handle);
      if (this.resetAndClosing) {
        this.resetAndClosing = false;
        handle.reset();
      } else {
        handle.close();
      }
    }
    #onClose(closedHandle = this[kHandle]) {
      // Once: a queued response's abort can destroy the socket, and run this, before the native close calls it.
      if (this.#closeHandled) return;
      this.#closeHandled = true;
      const errored = this.errored;
      // freeParser equivalent: runs before 'close' listeners so they observe the
      // released parser (free() invoked, kOnTimeout nulled).
      releaseServerParserShim(this);
      this[kHandle] = null;
      this.$isOpen = false;
      if (closedHandle) {
        this[kSocketBytesWritten] = handleBytesWritten(closedHandle);
        this[kClosedWithUnsentData] = closedHandle.closedWithUnsentData;
        // Peer FIN: 'end' before 'close', like Node's net.Socket. read(0) emits it when nothing reads the socket.
        if (closedHandle.peerEnded) {
          this.push(null);
          this.read(0);
        }
        // With no 'error' listener (a socket handed to 'upgrade') the read error would be an uncaught exception.
        const closeError = this.listenerCount("error") > 0 ? closedHandle.closeError : undefined;
        if (closeError) {
          // Node's errnoException(nread, 'read'): "read ECONNRESET".
          const er = new ErrnoException(closeError.errno, "read");
          this.#closeError = er.code === closeError.code ? er : closeError;
        }
      }
      const server = this.server;
      const tracked = server?.[kTrackedConnections];
      if (tracked) {
        tracked.delete(this);
        if (tracked.size === 0 && server[kPendingDrainClose]) {
          // The server 'close' follows this socket's own 'close' event.
          this.once("close", () => process.nextTick(emitCloseServer, server));
        }
      }
      const timer = this[kSocketTimeoutTimer];
      if (timer) {
        clearTimeout(timer);
        this[kSocketTimeoutTimer] = undefined;
        this.$armedTimeout = 0;
      }

      // Node.js's `socketOnClose` → `abortIncoming()` only destroys requests
      // that are still in `state.incoming` — i.e. requests whose response has
      // not yet finished (`resOnFinish` does `incoming.shift()`). Our
      // equivalent of "still in the queue" is `_httpMessage` being non-null:
      // `detachSocket()` (called from `res.end()` / on `"finish"`) clears it.
      // Do NOT fall back to `this[kRequest]` here — `_httpMessage` is the
      // canonical "response still attached" indicator. (`detachSocket()` now
      // clears `kRequest` alongside `_httpMessage`, so the two agree after a
      // finished response; historically `kRequest` was never cleared and the
      // fallback aborted the request on every keep-alive close even after a
      // fully successful response, racing `req._dump()`'s nextTick into a
      // spurious `"aborted"` — seen as flakes in the express `res.sendFile`
      // suite where supertest closes the socket right after reading the body.)
      //
      // Gate on `!req.destroyed` rather than `!req.complete`: a body-less GET
      // flips `complete` before the response is written, so an aborted
      // connection would otherwise never reach `req.destroy()` →
      // `emit("close")` (test-http-should-emit-close-when-connection-is-aborted).
      //
      // `#pendingAbortMessage` is the `_httpMessage` captured when the destroy
      // was initiated from JS (`#closeHandle`). It is only honoured when the
      // captured response was itself destroy()ed: a `res.end()` followed by a
      // JS-initiated socket.destroy() also reaches detachSocket() via the
      // dispatcher's finished branch, and Node.js does not abort the request
      // once the response has finished (resOnFinish shifts state.incoming).
      const pending = this.#pendingAbortMessage;
      this.#pendingAbortMessage = undefined;
      const message = this._httpMessage ?? (pending?.destroyed ? pending : undefined);
      const writeFailure = errored ?? $ERR_STREAM_DESTROYED("write");
      if (message) {
        failPendingWriteCallbacks(message, writeFailure);
      }
      // An ended response that was still draining finishes first, like Node.js's failed last write: its request is not aborted.
      const wasDraining = message != null && message[kPendingFinish] !== undefined;
      if (wasDraining) flushPendingFinish.$call(message);
      const req = wasDraining ? undefined : message?.req;

      // Node emits the response 'close' from its first socket 'close' listener: a response listener cannot remove a socket listener from the current emission.
      if (message && !message._closed) {
        this.prependOnceListener("close", emitCloseNT.bind(undefined, message));
      }

      if (req && !req.destroyed && !req[kHandle]?.upgraded) {
        // At this point the socket is already destroyed; let's avoid UAF
        req[kHandle] = undefined;
        if (req.listenerCount("error") > 0) {
          req.destroy(new ConnResetException("aborted"));
        } else {
          req.destroy();
        }
      }

      // Pipelined responses (and their requests) that were still queued behind
      // the in-flight response are aborted, like Node.js's socketOnClose
      // (abortIncoming + abortOutgoing).
      abortQueuedPipelinedResponses(this, writeFailure);

      // Node's server connection socket emits 'close' whenever the TCP
      // connection closes, even with no request in flight (this also covers
      // tunneled/upgraded sockets, main's kIsTunnel case); reaching here from a
      // native close without a JS-initiated destroy must still surface it.
      if (!this.destroyed) {
        this.destroy(this.#closeError);
      }
      // A tunnel write that waited for a drain fails now. After destroy(), it settles the callbacks of Writable and emits no 'error'.
      const pendingCallback = this.#pendingCallback;
      if (pendingCallback) {
        this.#pendingCallback = null;
        pendingCallback(writeFailure);
      }
    }
    // The close of a TLS handle waits for ciphertext that write() reported and a stalled peer does not take, but only once.
    destroyNow() {
      this.destroy();
      const handle = this.#closingHandle;
      if (!handle || handle.closed) return;
      handle.close();
      // In the middle of its own request a handle only takes note, and closes behind it, for the first time.
      if (!handle.closed) setImmediate(closeHandle, handle);
    }
    #onCloseForDestroy(
      closeCallback: $Node.ErrorCallback,
      err: Error | null | undefined,
      handle: $Node.NodeHTTPServerSocket,
    ) {
      this.#closingHandle = undefined;
      this.#onClose(handle);
      // Thread the destroy error through to the streams machinery (like
      // Node.js's net.Socket._destroy passing the exception to its callback),
      // so socket.destroy(err) emits 'error' before 'close'.
      if ($isCallable(closeCallback)) closeCallback(err);
    }

    _onTimeout() {
      const handle = this[kHandle];
      const response = handle?.response;
      // If there is a response, and it has pending data,
      // we suppress the timeout because a write is in progress.
      if (response && response.writableLength! > 0) {
        // Re-arm so the timeout still fires once the write actually stalls.
        this._unrefTimer();
        return;
      }
      this.emit("timeout");
    }
    _unrefTimer() {
      // Socket activity: push the inactivity timeout (socket.setTimeout /
      // server.timeout / keepAliveTimeout) further out, like Node.js's
      // net.Socket._unrefTimer.
      this[kSocketTimeoutTimer]?.refresh();
    }

    address() {
      return (this[kHandle] ?? this.#peer)?.remoteAddress || null;
    }

    get bufferSize() {
      return this.writableLength;
    }

    connect(_port?: unknown, _host?: unknown, _connectListener?: unknown) {
      return this;
    }

    _destroy(err: Error | null, callback: $Node.ErrorCallback) {
      sendWhatIsHeld(this._httpMessage);
      // Match net.Socket._destroy: #onClose clears this too, but the native close is async and an already-due timer would fire first.
      const timer = this[kSocketTimeoutTimer];
      if (timer) {
        clearTimeout(timer);
        this[kSocketTimeoutTimer] = undefined;
        this.$armedTimeout = 0;
      }
      const handle = this[kHandle];
      if (!handle) {
        if ($isCallable(callback)) callback(err);
        return;
      }
      handle.ondata = undefined;
      if (handle.closed) {
        const onclose = handle.onclose;
        handle.onclose = undefined;
        if ($isCallable(onclose)) {
          onclose.$call(handle);
        }
        if ($isCallable(callback)) callback(err ?? this.#closeError);
        return;
      }

      this.#closeHandle(handle, callback, err);
    }

    _final(callback: $Node.ErrorCallback) {
      sendWhatIsHeld(this._httpMessage);
      const handle = this[kHandle];
      if (!handle) {
        callback();
        return;
      }
      handle.end(this[kDestroySoon]);
      callback();
    }

    // Not destroy() on 'finish' like net.Socket: 'finish' does not wait for bytes uWS still queues.
    destroySoon() {
      if (this[kDestroySoon]) return;
      const handle = this[kHandle];
      if (this.writable && handle && !handle.closed) {
        this[kDestroySoon] = true;
        this.end();
        return;
      }
      super.destroySoon();
    }

    get localAddress() {
      return this[kHandle]?.localAddress?.address;
    }

    get localFamily() {
      return this[kHandle]?.localAddress?.family;
    }

    get localPort() {
      return this[kHandle]?.localAddress?.port;
    }

    get pending() {
      return this.connecting;
    }

    #resumeSocket(readStart: boolean) {
      const handle = this[kHandle];
      // A tunnel reads again: response.resume() below does nothing for it.
      if (readStart && this[kStreamingEnabled]) handle?.readStart();
      const response = handle?.response;
      const upgradeIncoming = this[kUpgradeIncoming];
      if (upgradeIncoming) {
        // Upgrade with a body: reading the raw socket resumes the request so its
        // body keeps draining (Node's UpgradeStream._read). Request-body bytes
        // belong to the request stream, never to the raw upgrade stream, and the
        // socket does not end when the request body does.
        response?.resume();
        // Not paused: req.complete is false in the listener, so it can wait for 'end' with no reader.
        if (upgradeIncoming.readableFlowing !== false) upgradeIncoming.resume();
        // The 'upgrade' listener runs before the rest of its read is parsed; that rest can complete the body.
        else if (response?.notifyWhenReadParsed()) this[kOnReadParsed] = resumePausedUpgradeIncoming;
        else resumePausedUpgradeIncoming(this);
        return;
      }
      response?.resume();
    }

    _read(_size: number) {
      // https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L779-L792
      this.#resumeSocket(true);
    }

    get readyState() {
      if (this.connecting) return "opening";
      if (this.readable) {
        return this.writable ? "open" : "readOnly";
      } else {
        return this.writable ? "writeOnly" : "closed";
      }
    }

    // SNI hostname the client sent in its ClientHello, or false when the TLS
    // client sent none (matches Node's server-side TLSSocket.servername).
    get servername() {
      if (!this.encrypted) return undefined;
      const name = (this[kHandle] ?? this.#peer)?.servername;
      return typeof name === "string" && name.length > 0 ? name : false;
    }

    // Like Node's server-side TLSSocket: `authorized` is only ever true when the
    // server requested a client certificate and its verification succeeded;
    // `authorizationError` carries the X.509 verification error code otherwise.
    get authorized() {
      if (!this.encrypted) return undefined;
      if (!this.server?.[tlsSymbol]?.requestCert) return false;
      return (this[kHandle] ?? this.#peer)?.peerCertVerified === true;
    }

    get authorizationError() {
      if (!this.encrypted) return undefined;
      if (!this.server?.[tlsSymbol]?.requestCert) return null;
      return (this[kHandle] ?? this.#peer)?.authorizationError ?? null;
    }

    ref() {
      return this;
    }

    get remoteAddress() {
      return this.address()?.address;
    }

    set remoteAddress(val: string | undefined) {
      // initialize the object so that other properties wouldn't be lost
      this.address()!.address = val!;
    }

    get remotePort() {
      return this.address()?.port;
    }

    set remotePort(val: number | undefined) {
      // initialize the object so that other properties wouldn't be lost
      this.address()!.port = val!;
    }

    get remoteFamily() {
      return this.address()?.family;
    }

    set remoteFamily(val: string | undefined) {
      // initialize the object so that other properties wouldn't be lost
      this.address()!.family = val!;
    }

    resetAndDestroy() {
      if (this[kHandle]) {
        if (!this.#resetSupported) {
          throw $ERR_INVALID_HANDLE_TYPE();
        }
        this.resetAndClosing = true;
        this.destroy();
      } else {
        this.destroy($ERR_SOCKET_CLOSED());
      }
      return this;
    }

    setKeepAlive(_enable = false, _initialDelay = 0) {
      return this;
    }

    setNoDelay(_noDelay = true) {
      return this;
    }

    // Like Node.js's net.Socket#setTimeout (setStreamTimeout): an unref'd
    // inactivity timer that emits 'timeout' on this socket. server.setTimeout,
    // server.keepAliveTimeout, req.setTimeout and res.setTimeout all funnel here.
    setTimeout(msecs: number, callback?: () => void) {
      if (this.destroyed) {
        return this;
      }

      msecs = getTimerDuration(msecs, "msecs");
      // Assigned after validation (unlike setStreamTimeout): onSocketTimeoutTimerExpired reads this.timeout.
      this.timeout = msecs;

      const existingTimer = this[kSocketTimeoutTimer];
      if (msecs === 0) {
        if (existingTimer) {
          clearTimeout(existingTimer);
          this[kSocketTimeoutTimer] = undefined;
          this.$armedTimeout = 0;
        }
        if (callback !== undefined) {
          validateFunction(callback, "callback");
          this.removeListener("timeout", callback);
        }
      } else {
        // The keep-alive cycle re-arms the same idle interval after every
        // response: refresh the existing timer instead of clear+allocate.
        if (existingTimer && this.$armedTimeout === msecs) {
          existingTimer.refresh();
        } else {
          if (existingTimer) clearTimeout(existingTimer);
          const timer: $Node.Timeout = setTimeout(onSocketTimeoutTimerExpired, msecs, this);
          timer.unref();
          this[kSocketTimeoutTimer] = timer;
          this.$armedTimeout = msecs;
        }
        if (callback !== undefined) {
          validateFunction(callback, "callback");
          this.once("timeout", callback);
        }
      }
      return this;
    }

    setEncoding(_encoding: string): never {
      const err = new Error("Changing the socket encoding is not allowed per RFC7230 Section 3.");
      err.code = "ERR_HTTP_SOCKET_ENCODING";
      throw err;
    }

    unref() {
      return this;
    }

    _write(_chunk: $Node.HttpChunk, _encoding: string, _callback: $Node.ErrorCallback) {
      sendWhatIsHeld(this._httpMessage);
      const handle = this[kHandle];
      let err;
      this._unrefTimer();
      try {
        if (handle) {
          const flushed = handle.write(_chunk, _encoding);
          if (!flushed && handle.ondrain) {
            // Streaming mode (CONNECT tunnels): wait for the native drain
            // callback before completing the write.
            this.#pendingCallback = _callback;
            return false;
          }
        }
      } catch (e) {
        err = e;
      }
      if (err) _callback(err);
      else _callback();
    }

    pause() {
      const handle = this[kHandle];
      const response = handle?.response;
      if (response) {
        response.pause();
      }

      return super.pause();
    }

    resume() {
      // Like Node's onSocketResume: the pipeline read gate outranks stream flow.
      if (this._paused) return this;
      // A full buffer keeps the reads of a tunnel stopped: _read() starts them when the reader has made room.
      this.#resumeSocket(this.readableLength < this.readableHighWaterMark);
      return super.resume();
    }

    get [kInternalSocketData]() {
      return this[kHandle]?.response;
    }

    get [kHasQueuedReads]() {
      return this[kHandle]?.hasQueuedTunnelReads === true;
    }
  };
  Object.defineProperty(NodeHTTPServerSocket, "name", { value: "Socket" });
  serverSocketResume = NodeHTTPServerSocket.prototype.resume;
  serverSocketSetTimeout = NodeHTTPServerSocket.prototype.setTimeout;
  netSocketResume = NetSocket.prototype.resume;
  netSocketPrototype = NetSocket.prototype;
  serverSocketPrototype = NodeHTTPServerSocket.prototype;
  return NodeHTTPServerSocket;
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

// A non-chunked message is terminated by the first empty line after the header
// fields, so it can carry neither a body nor trailers.
function hasInvalidTrailer(response: $Node.ServerResponse, exchange: Exchange | undefined) {
  if (exchange !== undefined && !response._trailer && (exchange.headerBits & (HEADER_TRAILER | HEADER_SPILLED)) === 0) {
    return false;
  }
  if (willBeChunked(response)) return false;
  if (response._trailer) return true;
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

// `exchange` is there where `response` is entered itself, and not where another object stands in its place.
function _writeHead(
  statusCode: number,
  reason: string | $Node.HttpHeadersInit | null | undefined,
  obj: $Node.HttpHeadersInit | null | undefined,
  response: $Node.ServerResponse,
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
          if (k) response.appendHeader(k[0], k[1]);
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
          if (k) response.appendHeader(k, (obj as string[])[n + 1]);
        }
      }
    } else if (obj) {
      const keys = Object.keys(obj);
      const length = keys.length;
      const setsHeadersItself =
        IS_COMPILED_AHEAD_OF_TIME &&
        exchange !== undefined &&
        !response._header &&
        response.setHeader === responseSetHeader &&
        outgoingSetHeaderIsOurs();
      // Retain for(;;) loop for performance reasons
      // Refs: https://github.com/nodejs/node/pull/30958
      for (let i = 0; i < length; i++) {
        k = keys[i];
        if (k) {
          if (setsHeadersItself) storeHeader(exchange!, k, obj[k]);
          else response.setHeader(k, obj[k]);
        }
      }
    }
    if (hasInvalidTrailer(response, exchange)) {
      ("unlikely");
      // The message is not chunk-framed, so `Trailer` is the offending header; drop it
      // so a caller that swallows the throw cannot put it on the wire.
      response.removeHeader("trailer");
      throw $ERR_HTTP_TRAILER_INVALID();
    }
  }
}

const EXCHANGE_TICK_QUEUED = 1 << 0;
const EXCHANGE_HOLDS_CHUNK = 1 << 1;
const EXCHANGE_ENDED_CLEAN = 1 << 2;
const EXCHANGE_HAS_STAND_IN = 1 << 3;
const EXCHANGE_SKIPS_A_TICK = 1 << 4;
const EXCHANGE_HAS_END_CALLBACK = 1 << 5;
const EXCHANGE_HAS_PENDING_CALLBACKS = 1 << 6;
const EXCHANGE_WAITS_ITS_TURN = 1 << 7;
const EXCHANGE_HAS_SNAPSHOT = 1 << 8;
const EXCHANGE_FINISHES_HERE = 1 << 9;
const EXCHANGE_REQUEST_WAITS = 1 << 10;
const REQUEST_UNSEEN = 0;
const REQUEST_CONSUMED = 1;
const REQUEST_OTHER = 2;
const REQUEST_DUMPED_IN_PLACE = 3;
const EXCHANGE_OTHERS_WAIT = 1 << 11;
// end() came while the tick that write() had queued was still to run, so that tick finds a response without a socket.
const EXCHANGE_ENDED_BEFORE_ITS_TICK = 1 << 12;

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
    this.destroyed = false;
    this._last = false;
    this[kChunkedEncoding] = false;
    this[kShouldKeepAlive] = true;
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
    this._hasBody = nativeHasBody!;
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
    this.useChunkedEncodingByDefault = true;
    this.req = req;
    this.sendDate = true;
    this._sent100 = false;
    this[headerStateSymbol] = NodeHTTPHeaderState.none;
    this[kPendingCallbacks] = noCallbacks;
    this.finished = false;
    this[kHandle] = nativeHandle;
    this.statusCode = 200;
    this.statusMessage = undefined;
    this._keepAliveTimeout = nativeKeepAliveTimeout;
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
  this.destroyed = false;
  this._last = false;
  this[kChunkedEncoding] = false;
  this[kShouldKeepAlive] = true;
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
  this._hasBody = req.method !== "HEAD";
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
  this[kRejectNonStandardBodyWrites] =
    options?.[kRejectNonStandardBodyWrites] ?? options?.rejectNonStandardBodyWrites ?? false;
  this[kLenientValidation] = undefined;
  this.$exchange = exchange;
  this.useChunkedEncodingByDefault = true;
  this.req = req;
  this.sendDate = true;
  this._sent100 = false;
  this[headerStateSymbol] = NodeHTTPHeaderState.none;
  this[kPendingCallbacks] = [];
  this.finished = false;

  if (req.httpVersionMajor! < 1 || req.httpVersionMinor! < 1) {
    this.useChunkedEncodingByDefault = chunkExpression.test((req.headers?.te as string | undefined) ?? "");
    this.shouldKeepAlive = false;
  }

  this[kHandle] = (options ? options[kHandle] : undefined) || req[kHandle];
  this.statusCode = 200;
  this.statusMessage = undefined;
}
$toClass(ServerResponse, "ServerResponse", OutgoingMessage);

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

  res.useChunkedEncodingByDefault = true;

  res.req = req;
  res.sendDate = true;
  res._sent100 = false;
  res[headerStateSymbol] = NodeHTTPHeaderState.none;
  res[kPendingCallbacks] = [];
  res.finished = false;

  if (req.method === "HEAD") res._hasBody = false;

  if (req.httpVersionMajor! < 1 || req.httpVersionMinor! < 1) {
    res.useChunkedEncodingByDefault = chunkExpression.test((req.headers?.te as string | undefined) ?? "");
    res.shouldKeepAlive = false;
  }

  if (options) {
    res[kHandle] = options[kHandle] || req[kHandle];
    const rejectNonStandardBodyWrites = options[kRejectNonStandardBodyWrites];
    if (rejectNonStandardBodyWrites !== undefined) {
      res[kRejectNonStandardBodyWrites] = rejectNonStandardBodyWrites;
    }
  } else {
    res[kHandle] = req[kHandle];
  }

  res.statusCode = 200;
  res.statusMessage = undefined;
  res.chunkedEncoding = false;
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
// The largest Keep-Alive timeout, in seconds, handed to the native writeHead (it takes a uint32).
const kMaxNativeKeepAliveSecs = 0x7fffffff;
let renderedAutoHeaders = 0;
let renderedKeepAliveSecs = 0;
let lastKeepAliveTimeout = -1;
let lastKeepAliveSecs = 0;

function renderNativeHeadersOf(res: $Node.ServerResponse, exchange: Exchange | undefined): unknown[] {
  return exchange !== undefined && exchange.response === res
    ? renderNativeHeaders(res, exchange)
    : renderNativeHeadersInFull(res, exchange);
}

function renderNativeHeaders(res: $Node.ServerResponse, exchange: Exchange): unknown[] {
  if (!IS_COMPILED_AHEAD_OF_TIME) {
    const entries = headerEntriesOf(exchange, res);
    if (entries === undefined || entries.length !== 0) return renderNativeHeadersInFull(res, exchange, true, entries);
  }
  const bits = IS_COMPILED_AHEAD_OF_TIME ? exchange.headerBits : 0;
  const keepAliveTimeout = res._keepAliveTimeout;
  const req = res.req;
  if (
    req != null &&
    (bits & HEADER_UNUSUAL) === 0 &&
    res.sendDate === true &&
    res._hasBody === true &&
    res.useChunkedEncodingByDefault === true &&
    ((bits & HEADER_CONTENT_LENGTH) !== 0 || !res._removedTE) &&
    !res._removedConnection &&
    !res.maxRequestsOnConnectionReached &&
    res[kShouldKeepAlive] === true &&
    reachesShouldKeepAlive(res) &&
    req[kReqShouldKeepAlive] === true &&
    res._maxRequestsPerSocket === undefined &&
    typeof keepAliveTimeout === "number" &&
    keepAliveTimeout > 0
  ) {
    if (keepAliveTimeout !== lastKeepAliveTimeout) {
      lastKeepAliveSecs = MathFloor(keepAliveTimeout / 1000);
      lastKeepAliveTimeout = keepAliveTimeout;
    }
    const keepAliveSecs = lastKeepAliveSecs;
    if (keepAliveSecs <= kMaxNativeKeepAliveSecs) {
      // A header value's toString() can send another response, so the results are set after flatHeadersOf().
      if ((bits & HEADER_CONTENT_LENGTH) !== 0 || (!res._removedContLen && !exchange.isFrozenChunked)) {
        const headers = flatHeadersOf(exchange);
        renderedAutoHeaders = AUTO_HEADER_DATE | AUTO_HEADER_CONN_KEEP_ALIVE | AUTO_HEADER_KEEP_ALIVE_TIMEOUT;
        renderedKeepAliveSecs = keepAliveSecs;
        return headers;
      }
      if (req.httpVersionMajor! >= 1 && req.httpVersionMinor! >= 1) {
        const headers = flatHeadersOf(exchange);
        renderedAutoHeaders =
          AUTO_HEADER_DATE |
          AUTO_HEADER_CONN_KEEP_ALIVE |
          AUTO_HEADER_KEEP_ALIVE_TIMEOUT |
          AUTO_HEADER_TRANSFER_ENCODING_CHUNKED;
        renderedKeepAliveSecs = keepAliveSecs;
        return headers;
      }
    }
  }
  return IS_COMPILED_AHEAD_OF_TIME
    ? renderNativeHeadersInFull(res, exchange)
    : renderNativeHeadersInFull(res, exchange, true, []);
}

function renderNativeHeadersInFull(
  res: $Node.ServerResponse,
  exchange: Exchange | undefined,
  isRead?: boolean,
  entriesRead?: unknown[],
): unknown[] {
  let autoHeaders = 0;
  let keepAliveSecs = 0;
  const entries = !IS_COMPILED_AHEAD_OF_TIME && isRead ? entriesRead : headerEntriesOf(exchange, res);
  const flat: unknown[] = [];
  let hasDate = false;
  let hasConnection = false;
  let hasKeepAlive = false;
  let hasTransferEncoding = false;
  let hasContentLength = false;
  const entriesLength = entries === undefined ? 0 : entries.length;
  for (let i = 0; i < entriesLength; i += 3) {
    const key = entries![i] as string;
    const value = entries![i + 2] as $Node.HttpHeaderValue;
    if (key === "date") hasDate = true;
    else if (key === "connection") {
      hasConnection = true;
      if (RE_CONN_CLOSE.test($isArray(value) ? value.join(", ") : String(value))) {
        storeMustClose(res, exchange);
      }
    } else if (key === "keep-alive") hasKeepAlive = true;
    else if (key === "transfer-encoding") hasTransferEncoding = true;
    else if (key === "content-length") hasContentLength = true;
    pushRenderedHeader(flat, res, key, entries![i + 1] as string, value);
  }

  if (res.sendDate && !hasDate) {
    autoHeaders |= AUTO_HEADER_DATE;
  }

  // The headers that frame the body are looked for in the map of headers.
  if (entries === undefined) throw new TypeError("undefined is not an object (evaluating 'headers[name]')");

  let defectiveNoBodyResponse = false;
  if (hasTransferEncoding) {
    const statusCode = statusCodeToSend(res);
    if (statusCode === 204 || statusCode === 304) {
      defectiveNoBodyResponse = true;
      storeMustClose(res, exchange);
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
      storeMustClose(res, exchange);
    } else if (res._removedTE) {
      closeDelimited = true;
      storeMustClose(res, exchange);
    } else if (
      res._removedContLen ||
      (exchange !== undefined && exchange.response === res ? exchange.isFrozenChunked : res[kFramingFrozenChunked])
    ) {
      const req = res.req;
      if (req.httpVersionMajor! >= 1 && req.httpVersionMinor! >= 1) {
        forceChunked = true;
      } else {
        closeDelimited = true;
        storeMustClose(res, exchange);
      }
    }
  }

  if (res._removedConnection) {
    if (res.shouldKeepAlive === false) {
      storeMustClose(res, exchange);
    }
  } else if (!hasConnection) {
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
      if (keepAliveTimeout && !hasKeepAlive) {
        const timeoutSecs = MathFloor(keepAliveTimeout / 1000);
        const hasMax = ~~maxRequestsPerSocket! > 0;
        if (!hasMax && timeoutSecs >= 0 && timeoutSecs <= kMaxNativeKeepAliveSecs) {
          autoHeaders |= AUTO_HEADER_CONN_KEEP_ALIVE | AUTO_HEADER_KEEP_ALIVE_TIMEOUT;
          keepAliveSecs = timeoutSecs;
        } else {
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
        storeMustClose(res, exchange);
      }
      autoHeaders |= AUTO_HEADER_CONN_CLOSE;
    }
  }

  if (res._hasBody === false) {
    flat.push("\u0000", "2");
  }

  if (closeDelimited) {
    flat.push("\u0000", "1");
  } else if (forceChunked) {
    autoHeaders |= AUTO_HEADER_TRANSFER_ENCODING_CHUNKED;
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
  // req.socket is nulled by the stream destroyer (pipeline/compose cleanup);
  // the response's own socket (set by assignSocket, cleared only by
  // detachSocket) still references the connection then.
  const detachedFrom = isItself ? exchange.detachedFrom : (this[kDetachedFrom] ?? null);
  const socket: $Node.HttpServerSocket | null | undefined = (detachedFrom ?? this.req?.socket ?? this.socket) as any;
  // Node's clearIncoming: a request that ended before its response did. Any other one is cleared at its EOF.
  const parser = socket?.parser;
  if (parser != null && parser.incoming === req && req.readableEnded) parser.incoming = null;
  const server = socket?.server;
  onResponseFinishHandleSocket(server, socket, this);
  // The dispatcher detached a synchronously-finished response itself;
  // advancing the pipeline again here would skip a queued response.
  if (detachedFrom !== null) return;
  if (socket != null) {
    this.detachSocket(socket);
    if (socket.$pipelinedResponses !== undefined || !readsItsEndUnseen(socket)) {
      ("unlikely");
      advanceResponsePipeline(server, socket);
    }
  }
}

function isResumeScheduled(state: $Node.ReadableState | null | undefined) {
  if (state == null) return false;
  const flags = flagsOf(state);
  return typeof flags === "number" ? (flags & kResumeScheduled) !== 0 : state.resumeScheduled;
}

// Runs when a response has finished, like the transport-related half of
// Node.js's resOnFinish: either end the connection (responses that must
// close) or arm the keep-alive idle timeout so an idle kept-alive connection
// is eventually closed.
function onResponseFinishHandleSocket(
  server: $Node.HttpServer | null | undefined,
  socket: $Node.HttpServerSocket | null | undefined,
  res: $Node.ServerResponse,
) {
  const exchange = res.$exchange;
  if (exchange !== undefined && exchange.response === res ? exchange.mustClose : res[kMustCloseConnection]) {
    if (socket != null) {
      if (typeof socket.destroySoon === "function") {
        socket.destroySoon();
      } else {
        socket.end();
      }
    }
    return;
  }
  if (!socket || socket.destroyed || typeof socket.setTimeout !== "function") {
    return;
  }
  // Another response is already in flight on this connection (pipelining):
  // it is not idle, so leave its timeout alone.
  const inFlight = socket._httpMessage;
  if (inFlight && inFlight !== res) {
    return;
  }
  // Pipelined responses are still queued behind this one: the connection is
  // not idle, so do not arm the keep-alive idle timeout yet.
  if (socket.$pipelinedResponses?.length) {
    return;
  }
  const rawKeepAliveTimeout = server!.keepAliveTimeout;
  const keepAliveTimeout = Number.isFinite(rawKeepAliveTimeout) && rawKeepAliveTimeout! >= 0 ? rawKeepAliveTimeout! : 0;
  const rawKeepAliveBuffer = server!.keepAliveTimeoutBuffer;
  const keepAliveTimeoutBuffer =
    Number.isFinite(rawKeepAliveBuffer) && rawKeepAliveBuffer! >= 0 ? rawKeepAliveBuffer! : 1000;
  if (keepAliveTimeout) {
    // Extend the internal timeout by the configured buffer to reduce
    // the likelihood of ECONNRESET errors, like Node.js's resOnFinish.
    const total = keepAliveTimeout + keepAliveTimeoutBuffer;
    // Rescheduling the socket timer on every response finish was the single
    // largest per-request cost of the keep-alive path. Once the timer is
    // armed with this exact interval (every response after the first on a
    // kept-alive connection), leave it in place and only record when this
    // idle period started; onSocketTimeoutTimerExpired grants the remaining
    // budget if the timer fires early, so the socket still closes after
    // exactly `total` ms of idle.
    if (socket.$armedTimeout === total) {
      socket.timeout = total;
    } else {
      socket.setTimeout(total);
    }
    socket[kKeepAliveIdleStart] = DateNow();
    socket[kKeepAliveTimeoutSet] = true;
  }
}

// Node.js's socketOnClose frees the parser, which aborts parsing of any
// pipelined requests still sitting in the current buffer - even when 'close'
// was emitted manually by user code.
function onSocketCloseStopParsing(this: $Node.HttpServerSocket) {
  this[kHandle]?.stopParsing?.();
}

// The second half of Node's read gate (lib/_http_server.js): uWS already pauses
// reads when the transport has unsent bytes (Node's `ws.needDrain`); these bytes
// sit in the JS queue and never reach the socket while the response is queued.
function pausePipelineReads(socket: $Node.HttpServerSocket) {
  const response = socket[kHandle]?.response;
  if (!response) return;
  socket._paused = true;
  // Not response.pause(): that is request-body flow control and no-ops once the in-flight
  // response has ended (always true when the pipeline backs up). pauseReads() pauses the
  // connection regardless and native stops consuming already-received pipelined requests.
  response.pauseReads();
}

// Node's parserOnIncoming read gate, for fallback connections (the native
// sibling is the kOutgoingData check before pausePipelineReads at the
// dispatcher): stop reading when the transport or the bytes buffered on
// queued pipelined responses are backed up, so a pipelining client cannot
// flood the connection's memory.
function maybePauseFallbackReads(socket: $Node.HttpSocket) {
  if (socket._paused) return;
  if (socket._writableState?.needDrain || (socket[kOutgoingData] ?? 0) >= socket.writableHighWaterMark) {
    socket._paused = true;
    socket.pause();
  }
}

// Node's socketOnDrain: the transport drained, so resume reads unless queued
// response bytes still hold the gate.
function resumeFallbackReadsOnDrain(socket: $Node.HttpSocket) {
  if (socket._paused && (socket[kOutgoingData] ?? 0) <= socket.writableHighWaterMark) {
    socket._paused = false;
    socket.resume();
  }
}

function addPipelineOutgoingData(queued: PipelinedQueuedState, bytes: number) {
  const socket = queued.socket;
  socket[kOutgoingData] = (socket[kOutgoingData] ?? 0) + bytes;
}

// Like Node's socketOnDrain: the buffered bytes are handed to the transport when
// the response is flushed, so they stop gating reads (_flushOutput calls
// `_onPendingData(-outputSize)`).
function releasePipelineOutgoingData(socket: $Node.HttpSocket, bytes: number) {
  const outgoing = (socket[kOutgoingData] ?? 0) - bytes;
  socket[kOutgoingData] = outgoing > 0 ? outgoing : 0;
  if (socket._paused && outgoing <= socket.writableHighWaterMark) {
    socket._paused = false;
    const response = socket[kHandle]?.response;
    if (response) {
      response.resume();
    } else if (!(NodeHTTPServerSocket && socket instanceof NodeHTTPServerSocket)) {
      // Fallback duplex paused by maybePauseFallbackReads: plain stream flow
      // control is the only way to restart it.
      socket.resume();
    }
  }
}

// Like the tail of Node.js's resOnFinish: when a response finishes and
// pipelined responses are queued behind it, the next one becomes the
// connection's current response, is assigned the socket, and its buffered
// output is flushed.
const kPipelineKickScheduled = Symbol("kPipelineKickScheduled");
function kickPipelineIfIdle(server: $Node.HttpServer, socket: $Node.HttpServerSocket) {
  if (socket._httpMessage == null && !socket[kPipelineKickScheduled]) {
    socket[kPipelineKickScheduled] = true;
    queueTick2(advancePipelineIfIdleNT, server, socket);
  }
}
function advancePipelineIfIdleNT(server: $Node.HttpServer, socket: $Node.HttpServerSocket) {
  socket[kPipelineKickScheduled] = false;
  if (socket._httpMessage == null && socket.$pipelinedResponses?.length) {
    advanceResponsePipeline(server, socket);
  }
}

// Like the dispatcher's pipelined branch and Node.js's parserOnIncoming
// outgoing queue: park the response behind the connection's in-flight one.
// Its write()/end() buffer (kPipelinedQueuedState) until
// advanceResponsePipeline assigns it the socket and replays them.
function queuePipelinedResponse(socket: $Node.HttpSocket, res: $Node.ServerResponse, isAncient: boolean) {
  res[kPipelinedQueuedState] = {
    ops: [],
    bytes: 0,
    headerBytes: 0,
    needDrain: false,
    ended: false,
    isAncient,
    socket,
  };
  const exchange = res.$exchange;
  if (exchange !== undefined) exchange.flags |= EXCHANGE_WAITS_ITS_TURN;
  (socket as any).$hasWaitingResponses = true;
  (socket.$pipelinedResponses ??= []).push(res);
}

// Like Node.js's socketOnEnd: the response that gets `_last` after the client's FIN is the last one in the queue.
function lastPipelinedResponse(socket: $Node.HttpSocket) {
  const queue = socket.$pipelinedResponses;
  return queue?.[queue.length - 1];
}

// When the connection dies with pipelined responses still queued behind the
// in-flight one, abort them and their requests, like Node.js's socketOnClose
// (abortIncoming). Runs from the native socket's close path and from the
// http1 fallback's socket 'close' listener.
function abortQueuedPipelinedResponses(socket: $Node.HttpSocket, error: Error = $ERR_STREAM_DESTROYED("write")) {
  const pipelined = socket.$pipelinedResponses;
  const pipelinedLength = pipelined ? pipelined.length : 0;
  if (pipelinedLength) {
    socket.$pipelinedResponses = undefined;
    for (let i = 0; i < pipelinedLength; i++) {
      const queuedRes = pipelined![i];
      // A turn that the native handle still holds: the native close path notifies that one.
      if (queuedRes[kPipelinedQueuedState] === undefined) continue;
      const queuedReq = queuedRes.req;
      failQueuedPipelinedWriteCallbacks(queuedRes[kPipelinedQueuedState], error);
      if (queuedReq && !queuedReq.destroyed) {
        queuedReq[kHandle] = undefined;
        if (queuedReq.listenerCount("error") > 0) {
          queuedReq.destroy(new ConnResetException("aborted"));
        } else {
          queuedReq.destroy();
        }
      }
      if (!queuedRes.destroyed) {
        queuedRes.destroy();
      } else if (!queuedRes._closed) {
        process.nextTick(emitCloseNT, queuedRes);
      }
    }
  }
}

// The head of the queue can never be sent: close once the bytes of the responses ahead of it have left.
function closeAfterLastSendableResponse(socket: $Node.HttpSocket) {
  if (NodeHTTPServerSocket && socket instanceof NodeHTTPServerSocket) {
    socket[kHandle]?.closeWhenDrained();
  } else if (!socket.destroyed) {
    socket.destroy();
  }
}

function failQueuedPipelinedWriteCallbacks(queued: PipelinedQueuedState | undefined, error: Error) {
  const ops = queued?.ops;
  const length = ops?.length ?? 0;
  if (length === 0) return;
  queued!.ops = [];
  for (let i = 0; i < length; i++) {
    const callback = ops![i][3];
    if (typeof callback === "function") process.nextTick(callback, error);
  }
}

function advanceResponsePipeline(
  server: $Node.HttpSocketServer | null | undefined,
  socket: $Node.HttpSocket | null | undefined,
) {
  // The previous response on this connection closed it (Connection: close,
  // HTTP/1.0, maxRequestsPerSocket): like Node.js's resOnFinish, advancing
  // the pipeline is mutually exclusive with closing the socket - the queued
  // responses are aborted by the socket close path instead of being replayed
  // onto a half-closed connection.
  if (!socket || socket.writableEnded || socket.destroyed) {
    return;
  }
  const queue = socket.$pipelinedResponses;
  if (!queue || queue.length === 0) {
    return;
  }
  // The current response has ended but is still draining; its 'finish' advances the pipeline.
  const current = socket[kHandle]?.response;
  if (
    current &&
    (current.flags & (NodeHTTPResponseFlags.ended | NodeHTTPResponseFlags.closed_or_completed)) ===
      NodeHTTPResponseFlags.ended
  ) {
    return;
  }
  const res = queue[0];
  const queued = res[kPipelinedQueuedState];
  if (queued === undefined) {
    // The native handle still holds this turn: its dispatch queued no response, and after a throw none can come.
    if (((res as $Node.PipelinedTurn).flags & NodeHTTPResponseFlags.dispatch_threw_while_queued) !== 0) {
      closeAfterLastSendableResponse(socket);
    }
    return;
  }
  const handle = res[kHandle];

  if (
    res.destroyed ||
    !handle ||
    // Its dispatch threw and nothing ended it since: natively only the current response is answered for a throw.
    (!queued.ended && (handle.flags & NodeHTTPResponseFlags.dispatch_threw_while_queued) !== 0)
  ) {
    failQueuedPipelinedWriteCallbacks(queued, res.errored ?? socket.errored ?? $ERR_STREAM_DESTROYED("write"));
    // The queued response was destroyed before it could be sent; the
    // connection cannot produce a response for this slot, so it is unusable.
    // Deliberate divergence from Node v26, which assigns the destroyed
    // message and wedges the connection until requestTimeout: an HTTP/1.1
    // connection cannot skip a response slot, so reset it instead.
    closeAfterLastSendableResponse(socket); // it stays queued for the close path
    return;
  }

  queue.shift();
  res[kPipelinedQueuedState] = undefined;
  const exchange = res.$exchange;
  if (exchange !== undefined) exchange.flags &= ~EXCHANGE_WAITS_ITS_TURN;
  releasePipelineOutgoingData(socket, queued.bytes);

  if (NodeHTTPServerSocket && socket instanceof NodeHTTPServerSocket) {
    const socketHandle = socket[kHandle];
    if (
      !socketHandle ||
      socket.destroyed ||
      !socketHandle.startPipelinedResponse(handle, !!queued.isAncient, !requestShouldKeepAlive(res.req))
    ) {
      // The connection is already gone; the socket close path destroys queued
      // responses, but make sure this (already dequeued) one is not skipped.
      failQueuedPipelinedWriteCallbacks(queued, socket.errored ?? $ERR_STREAM_DESTROYED("write"));
      if (!res.destroyed) {
        res.destroy();
      }
      return;
    }

    if (res.assignSocket === ServerResponse.prototype.assignSocket) {
      assignSocketInternal(res, socket);
    } else {
      res.assignSocket(socket);
    }
  } else {
    // internal/http1_server_fallback connection (a foreign duplex): the
    // response's JS handle writes to the socket itself (nothing to switch
    // natively), and the prototype assignSocket installs the 'close' listener
    // a plain stream needs. Clear `finished` first, or assignSocket's _flush
    // emits 'prefinish' before the ops replay below.
    if (queued.ended) {
      res.finished = false;
    }
    res.assignSocket(socket);
  }

  // Replay the writes buffered while the response was queued.
  // The buffered bytes are handed to the native handle below, so they no
  // longer count as pending output (Node's _flush does the same).
  res.outputSize = 0;
  const ops = queued.ops;
  const opsLength = ops.length;
  let hitBackpressure = false;
  if (opsLength) {
    // `finished` was set when the user called end() on the queued response;
    // clear it for the replay so the real write()/end() (end re-sets it) do
    // not treat the buffered calls as write-after-end.
    if (queued.ended) {
      res.finished = false;
    }
    if (exchange !== undefined) exchange.isReplaying = true;
    storeRarely(res, kReplayingPipelinedOps, true);
    try {
      for (let i = 0; i < opsLength; i++) {
        const op = ops[i];
        const kind = op[0];
        if (kind === "raw") {
          // Buffered 1xx bytes: route through the same AsyncSocket buffer the
          // response's own writeHead/end use so they precede the final response.
          handle.writeInformational(op[1]!, op[2]);
          if (typeof op[3] === "function") process.nextTick(op[3]);
        } else if (kind === "write") {
          if (ServerResponsePrototypeWrite.$call(res, op[1], op[2], op[3]) === false) hitBackpressure = true;
        } else {
          ServerResponsePrototypeEnd.$call(res, op[1], op[2], op[3]);
        }
      }
    } finally {
      if (exchange !== undefined) exchange.isReplaying = false;
      storeRarely(res, kReplayingPipelinedOps, false);
    }
  }
  if (queued.needDrain && !queued.ended) {
    // write() reported backpressure while the response was queued: the native drain callback emits 'drain' if the flush hit backpressure, else emit it now.
    if (!hitBackpressure) {
      process.nextTick(emitPipelinedDrainNT, res);
    }
  }
}

function emitPipelinedDrainNT(res: $Node.ServerResponse) {
  if (!res.destroyed && !res.finished) {
    res.emit("drain");
  }
}

// write()/end() on a response that is still queued behind an in-flight
// pipelined response: buffer the call (Node.js buffers through outputData
// while no socket is assigned) and report backpressure against the high water
// mark so 'drain' semantics match.
// Node's _storeHeader pushes the serialized header block through outputData, so a
// queued response's outputSize - and the connection's outgoingData that gates
// pipelined reads - counts header bytes, not just body chunks. Bun renders the
// block natively at replay, so account its size when the first buffered op fixes
// the headers. Without it every queued response contributes only its chunk
// length; power-of-two chunks can then land outgoingData exactly on
// writableHighWaterMark and pause reads one request earlier than Node would,
// deadlocking clients that pipeline the unblocking request behind the crossing
// one (test-http-pipeline-socket-parser-typeerror).
function accountQueuedHeaderBytes(res: $Node.ServerResponse, queued: PipelinedQueuedState) {
  if (queued.headerBytes !== 0) {
    return;
  }
  // Status line: "HTTP/1.1 NNN <message>\r\n".
  let bytes = 15 + String(res.statusMessage ?? STATUS_CODES[res.statusCode] ?? "unknown").length;
  spillHeadersOf(res);
  const outHeaders = res[kOutHeaders];
  if (outHeaders !== null && outHeaders !== undefined) {
    for (const key in outHeaders) {
      const entry = outHeaders[key];
      if (!entry) continue;
      const value = entry[1];
      if ($isJSArray(value)) {
        for (let i = 0; i < value.length; i++) {
          bytes += entry[0].length + 4 + String(value[i]).length;
        }
      } else {
        bytes += entry[0].length + 4 + String(value).length;
      }
    }
  }
  // Headers the native writer adds when absent, with their literal serialized
  // lengths: "Date: <29-byte IMF-fixdate>\r\n" (37), "Connection: keep-alive\r\n"
  // (24), "Transfer-Encoding: chunked\r\n" (28), plus the terminating "\r\n".
  if (!res.hasHeader("date")) bytes += 37;
  if (!res.hasHeader("connection")) bytes += 24;
  if (!res.hasHeader("content-length") && !res.hasHeader("transfer-encoding")) bytes += 28;
  bytes += 2;
  queued.headerBytes = bytes;
  queued.bytes += bytes;
  res.outputSize += bytes;
  addPipelineOutgoingData(queued, bytes);
}

function bufferPipelinedWrite(
  res: $Node.ServerResponse,
  queued: PipelinedQueuedState,
  chunk: $Node.HttpChunk | null | undefined,
  encoding: string | null | undefined,
  callback: $Node.HttpWriteCallback | undefined,
) {
  callWriteHeadIfObservable(res, res[headerStateSymbol]);
  if (res[headerStateSymbol] === NodeHTTPHeaderState.none) {
    updateHasBody(res, (res.statusCode = validateStatusCode(res.statusCode)));
  }
  accountQueuedHeaderBytes(res, queued);
  if (!res._hasBody) {
    if (chunk && res[kRejectNonStandardBodyWrites]) {
      throw $ERR_HTTP_BODY_NOT_ALLOWED();
    }
    // Node's write_(): a response that cannot have a body discards the write, calls back and returns true.
    queued.ops.push(["write", undefined, encoding, undefined]);
    if (typeof callback === "function") process.nextTick(callback);
    return true;
  }
  queued.ops.push(["write", chunk, encoding, callback]);
  if (chunk) {
    const bytes = typeof chunk === "string" ? Buffer.byteLength(chunk, encoding) : chunk.length;
    queued.bytes += bytes;
    // Node buffers these writes through outputData while no socket is
    // assigned, so outputSize reflects them until the response is flushed.
    res.outputSize += bytes;
    addPipelineOutgoingData(queued, bytes);
  }
  if (queued.bytes >= res.writableHighWaterMark) {
    queued.needDrain = true;
    return false;
  }
  return true;
}

function bufferPipelinedEnd(
  res: $Node.ServerResponse,
  queued: PipelinedQueuedState,
  chunk: $Node.HttpChunk | null | undefined,
  encoding: string | null | undefined,
  callback: $Node.HttpWriteCallback | undefined,
) {
  callWriteHeadIfObservable(res, res[headerStateSymbol], true);
  if (res[headerStateSymbol] === NodeHTTPHeaderState.none) {
    updateHasBody(res, (res.statusCode = validateStatusCode(res.statusCode)));
  }
  accountQueuedHeaderBytes(res, queued);
  if (chunk && !res._hasBody) {
    if (res[kRejectNonStandardBodyWrites]) {
      throw $ERR_HTTP_BODY_NOT_ALLOWED();
    }
    chunk = undefined;
  }
  queued.ops.push(["end", chunk, encoding, callback]);
  if (chunk) {
    const bytes = typeof chunk === "string" ? Buffer.byteLength(chunk, encoding) : chunk.length;
    queued.bytes += bytes;
    // Node buffers these writes through outputData while no socket is
    // assigned, so outputSize reflects them until the response is flushed.
    res.outputSize += bytes;
    addPipelineOutgoingData(queued, bytes);
  }
  queued.ended = true;
  res.finished = true;
  return res;
}

const RE_CONN_CLOSE = /(?:^|\W)close(?:$|\W)/i;

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

// Result of shouldKeepAliveForConnection, computed once at dispatch and
// reused by renderNativeHeaders / the pipelined-response path so neither has
// to re-read req.headers (which would materialize the lazy header object).

function requestShouldKeepAlive(req: $Node.IncomingMessage | null | undefined) {
  if (!req) return true;
  const cached = req[kReqShouldKeepAlive];
  if (cached !== undefined) return cached;
  return (req[kReqShouldKeepAlive] = shouldKeepAliveForConnection(req, req.headers.connection));
}

function isHTTPServerHeaderStateSentOrAssigned(state: NodeHTTPHeaderState) {
  return state === NodeHTTPHeaderState.sent || state === NodeHTTPHeaderState.assigned;
}

// In Node.js writeHead() renders the header block immediately, so mutating
// headers afterwards throws ERR_HTTP_HEADERS_SENT. Our headers are rendered
// lazily right before the native writeHead, so mirror the throwing behavior
// by also checking the header state, then defer to the OutgoingMessage
// implementations.
function headerStateOf(res: $Node.ServerResponse): NodeHTTPHeaderState {
  const exchange = res.$exchange;
  return exchange !== undefined && exchange.response === res ? exchange.headerState : res[headerStateSymbol];
}

function throwIfServerHeadersSent(self: $Node.ServerResponse, action: string) {
  if (isHTTPServerHeaderStateSentOrAssigned(headerStateOf(self))) {
    throw $ERR_HTTP_HEADERS_SENT(action);
  }
}

function outgoingSetHeaderIsOurs(): boolean {
  return OutgoingMessagePrototype.setHeader === outgoingSetHeader;
}

const responseSetHeader = function setHeader(this: $Node.ServerResponse, name: string, value: $Node.HttpHeaderValue) {
  const exchange = this.$exchange;
  const isItself = exchange !== undefined && exchange.response === this;
  if (
    isItself
      ? exchange.headerState !== NodeHTTPHeaderState.none
      : isHTTPServerHeaderStateSentOrAssigned(this[headerStateSymbol])
  ) {
    throw $ERR_HTTP_HEADERS_SENT("set");
  }
  if (!IS_COMPILED_AHEAD_OF_TIME || !isItself || !outgoingSetHeaderIsOurs()) {
    return OutgoingMessagePrototype.setHeader.$call(this, name, value);
  }
  if (this._header !== null && this._header) throw $ERR_HTTP_HEADERS_SENT("set");
  if (exchange.shape.count === 0) {
    // The first header of a message stores on the message. One that is frozen refuses that, where any other message stores it.
    const lenient = this[kLenientValidation];
    try {
      this[kLenientValidation] = lenient;
    } catch {
      this._isLenientHeaderValidation();
    }
  }
  storeHeader(exchange, name, value);
  return this;
};
ServerResponse.prototype.setHeader = responseSetHeader;

ServerResponse.prototype.appendHeader = function appendHeader(
  this: $Node.ServerResponse,
  name: string,
  value: $Node.HttpHeaderValue,
) {
  throwIfServerHeadersSent(this, "append");
  return plainOutgoingMessage.appendHeader.$call(this, name, value);
};

ServerResponse.prototype.setHeaders = function setHeaders(
  this: $Node.ServerResponse,
  headers: Iterable<[name: string, value: $Node.HttpHeaderValue]>,
) {
  throwIfServerHeadersSent(this, "set");
  return plainOutgoingMessage.setHeaders.$call(this, headers);
};

ServerResponse.prototype.removeHeader = function removeHeader(this: $Node.ServerResponse, name: string) {
  throwIfServerHeadersSent(this, "remove");
  return plainOutgoingMessage.removeHeader.$call(this, name);
};

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
    throwIfServerHeadersSent(this, "set");
    spillHeadersOf(this);
    this[kOutHeaders] = null;
    if (!value) return;
    if ($isArray(value)) {
      // Array of [name, value] pairs, like the WHATWG Headers sequence init.
      for (const { 0: key, 1: val } of value) {
        this.appendHeader(key, val);
      }
    } else if (typeof value.entries === "function") {
      for (const { 0: key, 1: val } of value.entries()) {
        this.appendHeader(key, val);
      }
    } else {
      const keys = ObjectKeys(value);
      for (let i = 0; i < keys.length; i++) {
        this.setHeader(keys[i], value[keys[i]]);
      }
    }
  },
});

function waitsItsTurn(res: $Node.ServerResponse): boolean {
  const exchange = res.$exchange;
  return exchange !== undefined && exchange.response === res
    ? (exchange.flags & EXCHANGE_WAITS_ITS_TURN) !== 0
    : res[kPipelinedQueuedState] !== undefined;
}

Object.defineProperty(ServerResponse.prototype, "socket", {
  get(this: $Node.ServerResponse) {
    if (waitsItsTurn(this)) {
      // Queued pipelined response: like Node.js, res.socket is null until the
      // response is assigned the socket.
      return null;
    }
    return (this[fakeSocketSymbol] ??= new FakeSocket(this));
  },
  set(this: $Node.ServerResponse, value: $Node.HttpSocket | null) {
    this[fakeSocketSymbol] = value;
    // Keep the OutgoingMessage storage in sync: the standalone no-handle path
    // routes through OutgoingMessage.write/end, whose kSocket-gated checks
    // (_finish()/'prefinish', _flushOutput) must see the assigned socket.
    this[kSocket] = value;
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

// The native-handle path ignores this flag (uWS does the chunk framing), but
// the standalone path (no kHandle, assignSocket()) goes through the upstream
// _storeHeader/write_/end machinery, which sets and reads it to frame the
// body - so it needs real storage.
Object.defineProperty(ServerResponse.prototype, "chunkedEncoding", {
  get(this: $Node.ServerResponse) {
    return this[kChunkedEncoding] ?? false;
  },
  set(this: $Node.ServerResponse, value) {
    this[kChunkedEncoding] = value;
  },
});

Object.defineProperty(ServerResponse.prototype, "writableCorked", {
  get(this: $Node.ServerResponse) {
    return this.socket?.writableCorked ?? 0;
  },
  set(_value) {},
});

ServerResponse.prototype.cork = function cork(this: $Node.ServerResponse) {
  sendWhatIsHeld(this);
  // socket is null while this response is queued behind a pipelined response.
  this.socket?.cork();
};

ServerResponse.prototype.uncork = function uncork(this: $Node.ServerResponse) {
  this.socket?.uncork();
};

ServerResponse.prototype.setTimeout = function setTimeout(
  this: $Node.ServerResponse,
  msecs: number,
  callback?: () => void,
) {
  // Like OutgoingMessage.prototype.setTimeout: the callback listens on the
  // response's 'timeout' event (emitted by onNodeHTTPServerSocketTimeout);
  // only msecs is delegated to the socket.
  if (callback) this.on("timeout", callback);
  if (!this[fakeSocketSymbol]) {
    this.once("socket", function socketSetTimeoutOnConnect(socket: $Node.HttpSocket) {
      socket.setTimeout!(msecs);
    });
  } else {
    this.socket!.setTimeout!(msecs);
  }

  return this;
};

// The end() callback (or null) while the body end() buffered is still draining.
ServerResponse.prototype._removedConnection = false;

ServerResponse.prototype._removedContLen = false;

ServerResponse.prototype._hasBody = true;

ServerResponse.prototype._ended = false;

// The end() callback (or null) while the body end() buffered is still draining.
ServerResponse.prototype[kPendingFinish] = undefined;

ServerResponse.prototype[kRejectNonStandardBodyWrites] = undefined;

Object.defineProperty(ServerResponse.prototype, "headersSent", {
  get(this: $Node.ServerResponse) {
    return headerStateOf(this) === NodeHTTPHeaderState.sent || headerStateOf(this) === NodeHTTPHeaderState.assigned;
  },
  set(this: $Node.ServerResponse, value: boolean) {
    storeHeaderState(this, this.$exchange, value ? NodeHTTPHeaderState.sent : NodeHTTPHeaderState.none);
  },
});

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
  const queued = this[kPipelinedQueuedState];
  if (queued !== undefined) {
    // Queued pipelined response: like Node.js (which buffers to outputData
    // while no socket is assigned and flushes on assignSocket), buffer the
    // raw 1xx bytes and write them ahead of the buffered body once this
    // response reaches the head of the pipeline.
    queued.ops.push(["raw", chunk, encoding, callback]);
    const bytes = typeof chunk === "string" ? Buffer.byteLength(chunk, encoding) : chunk.length;
    queued.bytes += bytes;
    this.outputSize += bytes;
    addPipelineOutgoingData(queued, bytes);
    return queued.bytes < this.writableHighWaterMark;
  }
  // Write through the response handle's AsyncSocket buffer (same path as
  // writeHead/end) so 1xx lines share ordering with the final response bytes;
  // socket.write() would land in the socket handle's separate stream buffer.
  this[kHandle].writeInformational(chunk, encoding);
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
  if (!this[kHandle] || this[kPipelinedQueuedState] !== undefined) {
    // Standalone path (no native handle) or queued pipelined response (no
    // socket yet): route through writeInformation like Node.js v26.3.0 so the
    // 100 Continue line is buffered and written once a socket is assigned.
    this.writeInformation(100, null, cb);
    this._sent100 = true;
    return;
  }
  const native = this.socket?.[kHandle]?.response;
  if (native) native.writeContinue();
  else this[kHandle]?.writeContinue?.();
  this._sent100 = true;
  cb?.();
};

function queueExchangeTick(exchange: Exchange, flags: number): void {
  exchange.flags = flags | EXCHANGE_TICK_QUEUED;
  queueTick1(finishExchange, exchange);
  exchange.tickMark = ring.write!;
}

// A first chunk that write() has not sent, with the head as write() rendered it.
class HeldChunk {
  chunk: string;
  headers: unknown[];
  autoHeaders: number;
  keepAliveSecs: number;

  constructor(chunk: string, headers: unknown[], autoHeaders: number, keepAliveSecs: number) {
    this.chunk = chunk;
    this.headers = headers;
    this.autoHeaders = autoHeaders;
    this.keepAliveSecs = keepAliveSecs;
  }
}

declare global {
  namespace $Node {
    type HttpHeldChunk = HeldChunk;
  }
}

// Hands the head on the way renderNativeHeaders() does.
function headOf(held: HeldChunk): unknown[] {
  renderedAutoHeaders = held.autoHeaders;
  renderedKeepAliveSecs = held.keepAliveSecs;
  return held.headers;
}

function sendHeldChunk(res: $Node.ServerResponse, exchange: Exchange): void {
  const handle = res[kHandle]!;
  const held = exchange.heldChunk!;
  exchange.flags &= ~EXCHANGE_HOLDS_CHUNK;
  exchange.heldChunk = null;
  if ((handle.flags & NodeHTTPResponseFlags.closed_or_completed) !== 0) return;
  handle.cork(() => {
    const renderedHeaders = headOf(held);
    handle.writeHead(
      statusCodeToSend(res),
      statusMessageToSend(res),
      renderedHeaders as string[],
      renderedAutoHeaders,
      renderedKeepAliveSecs,
    );
    handle.write(held.chunk, undefined, allowWritesToContinue.bind(res), undefined);
  });
}

function sendWhatIsHeld(res: $Node.ServerResponse | null | undefined): void {
  if (res == null) return;
  const exchange = res.$exchange;
  if (exchange !== undefined && (exchange.flags & EXCHANGE_HOLDS_CHUNK) !== 0)
    sendHeldChunk(exchange.response, exchange);
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
  if (exchange.bytesBuffered !== 0 && !exchange.isFlushScheduled) {
    queueTickInFront(flushWriteAccountingNT, 1, res, undefined);
  }
}

const flushWriteAccountingOfResponse = flushWriteAccountingNT;
const forgetBytesBuffered = function flushWriteAccountingNT(exchange: Exchange): void {
  if (exchange.bytesBuffered === 0) return;
  const res = exchange.response;
  if (!reachesWritableHighWaterMark(res)) {
    ("unlikely");
    return flushWriteAccountingOfResponse(res);
  }
  res[kAccountingFlushScheduled] = false;
  exchange.bytesBuffered = res[kBytesBuffered] = 0;
};

// flushWriteAccountingNT() asks for writableHighWaterMark, which asks for the socket, and a response that has let go of its socket makes one to answer with. forgetBytesBuffered() asks for neither. Whoever looks under the symbol of the socket, which a program finds by listing the keys of a response, finds the socket that the question would have left there.
function showSocketMadeForAccounting(this: $Node.ServerResponse): void {
  const exchange = this.$exchange;
  if (exchange === undefined) return;
  const response = exchange.response;
  if (response !== this) return;
  if (
    (exchange.flags & EXCHANGE_ENDED_BEFORE_ITS_TICK) !== 0 &&
    response[kAccountingFlushScheduled] === false &&
    response[fakeSocketSymbol] === null
  ) {
    response[fakeSocketSymbol] = new FakeSocket(response);
  }
}

if (IS_COMPILED_AHEAD_OF_TIME) {
  $newCppFunction(
    "BunCompiledModules.cpp",
    "jsFunctionPrepareHoldersBeforeLookupsUnder",
    2,
  )(fakeSocketSymbol, showSocketMadeForAccounting);
}

const finishExchange = function emitResponseFinished(exchange: Exchange): void {
  const flags = exchange.flags;
  if ((flags & (EXCHANGE_SKIPS_A_TICK | EXCHANGE_ENDED_CLEAN)) !== EXCHANGE_ENDED_CLEAN) {
    ("unlikely");
    if ((flags & EXCHANGE_SKIPS_A_TICK) !== 0) {
      exchange.flags = flags & ~EXCHANGE_SKIPS_A_TICK;
      return forgetBytesBuffered(exchange);
    }
    exchange.flags = flags & ~EXCHANGE_TICK_QUEUED;
    const res = exchange.response;
    if ((flags & EXCHANGE_HOLDS_CHUNK) !== 0) sendHeldChunk(res, exchange);
    return flushWriteAccountingNT(res);
  }
  exchange.flags = flags & ~EXCHANGE_TICK_QUEUED;
  const res = exchange.response;
  let takesStores = true;
  try {
    forgetBytesBuffered(exchange);
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
    exchange.mustClose ||
    socket === null ||
    req == null ||
    requestState == null ||
    req._readableState !== requestState ||
    req._events == null ||
    res._closed ||
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
  const server = socket.server;
  if (server == null) {
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
  if (socket.$armedTimeout !== idleTimeout && socket.setTimeout !== serverSocketSetTimeout) {
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
    if (parser != null && parser.incoming === req && req.readableEnded) parser.incoming = null;
  }
  const idleTimeout = exchange.idleTimeout;
  if (socket.$armedTimeout === idleTimeout) socket.timeout = idleTimeout;
  else {
    ("unlikely");
    socket.setTimeout(idleTimeout);
  }
  socket[kKeepAliveIdleStart] = DateNow();
  socket[kKeepAliveTimeoutSet] = true;
  if (exchange.detachedFrom === null) {
    if (socket._httpMessage === res) {
      socket[kCloseCallback] = undefined;
      socket._httpMessage = null;
      socket[kRequest] = undefined;
    }
    res[fakeSocketSymbol] = null;
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

function resumesUnseen(socket: $Node.HttpServerSocket): boolean {
  return (
    ((IS_COMPILED_AHEAD_OF_TIME && $findsDeclaredMember(socket, "resume")) || socket.resume === serverSocketResume) &&
    netSocketPrototype!.resume === netSocketResume &&
    DuplexPrototype.resume === duplexResume &&
    socket[kUpgradeIncoming] === undefined &&
    readsFlowUnseen(socket)
  );
}

// Whether a read of that name on the socket reaches the accessor of Duplex.prototype: neither the socket nor a prototype in front of it has such a property.
function reachesDuplexPrototype(socket: $Node.HttpServerSocket, name: string): boolean {
  return (
    !ObjectHasOwn(socket, name) &&
    !ObjectHasOwn(serverSocketPrototype!, name) &&
    !ObjectHasOwn(netSocketPrototype!, name)
  );
}

// The same for an accessor of Readable.prototype.
function reachesReadablePrototype(socket: $Node.HttpServerSocket, name: string): boolean {
  return reachesDuplexPrototype(socket, name) && !ObjectHasOwn(DuplexPrototype, name);
}

function hasThePrototypesOfItsClass(socket: $Node.HttpServerSocket): boolean {
  return (
    ObjectGetPrototypeOf(socket) === serverSocketPrototype &&
    ObjectGetPrototypeOf(serverSocketPrototype) === netSocketPrototype &&
    ObjectGetPrototypeOf(netSocketPrototype) === DuplexPrototype &&
    ObjectGetPrototypeOf(DuplexPrototype) === ReadablePrototype
  );
}

function readsFlowUnseen(socket: $Node.HttpServerSocket): boolean {
  if (!(
    IS_COMPILED_AHEAD_OF_TIME &&
    ObjectGetPrototypeOf(socket) === serverSocketPrototype &&
    $findsDeclaredMember(socket, "readable") &&
    $findsDeclaredMember(socket, "readableLength") &&
    $findsDeclaredMember(socket, "readableHighWaterMark") &&
    $findsDeclaredMember(socket, "readableEnded")
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
    reachesReadablePrototype(socket, "readableEnded")
  );
}

function readsHighWaterMarksUnseen(socket: $Node.HttpServerSocket): boolean {
  if (!(
    IS_COMPILED_AHEAD_OF_TIME &&
    ObjectGetPrototypeOf(socket) === serverSocketPrototype &&
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
    ObjectGetPrototypeOf(socket) === serverSocketPrototype &&
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
  return res.detachSocket === responseDetachSocket && reachesSocket(res);
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

function reachesShouldKeepAlive(res: $Node.ServerResponse): boolean {
  return !ObjectHasOwn(res, "shouldKeepAlive") && inheritsFromResponsePrototype(res, "shouldKeepAlive");
}

function reachesHeadersSent(res: $Node.ServerResponse): boolean {
  return !ObjectHasOwn(res, "headersSent") && inheritsFromResponsePrototype(res, "headersSent");
}

function reachesSocket(res: $Node.ServerResponse): boolean {
  return !ObjectHasOwn(res, "socket") && inheritsFromResponsePrototype(res, "socket");
}

function reachesWritableHighWaterMark(res: $Node.ServerResponse): boolean {
  const connection = res.$exchange.connection;
  return (
    !ObjectHasOwn(res, "writableHighWaterMark") &&
    inheritsFromResponsePrototype(res, "writableHighWaterMark") &&
    reachesSocket(res) &&
    (connection === null || readsHighWaterMarksUnseen(connection))
  );
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
  return (
    socket.$isOpen &&
    !socket._paused &&
    !socket.$hasWaitingResponses &&
    !socket[kStreamingEnabled] &&
    !socket[kHandedOff] &&
    socket._readableState === socket.$ownReadableState &&
    (flagsOf(socket.$ownReadableState) & kSocketFlowMask) === kSocketFlows &&
    readsItsEndUnseen(socket)
  );
}

function endAfterNativeThrow(
  res: $Node.ServerResponse,
  exchange: Exchange | undefined,
  handle: $Node.NodeHTTPResponse | $Node.Http1ResponseHandle,
  error: unknown,
): $Node.ServerResponse {
  const code = (error as { code?: string } | null | undefined)?.code;
  if (code === "ERR_STREAM_ALREADY_FINISHED") {
    if ((handle.flags & NodeHTTPResponseFlags.closed_or_completed) !== 0) {
      return endWithoutSocket(res, exchange, true);
    }
  } else if (
    code !== "ERR_HTTP_HEADERS_SENT" &&
    code !== "ERR_INVALID_CHAR" &&
    code !== "ERR_INVALID_ARG_TYPE" &&
    !(error instanceof RangeError)
  ) {
    storeHeaderState(res, exchange, NodeHTTPHeaderState.sent);
  }
  throw error;
}

// Like Node, 'prefinish' fires but 'finish' never does, and the close of the socket aborts the request.
function endWithoutSocket(
  res: $Node.ServerResponse,
  exchange: Exchange | undefined,
  countsAsSent: boolean,
): $Node.ServerResponse {
  if (countsAsSent) {
    storeHeaderState(res, exchange, NodeHTTPHeaderState.sent);
    res._header = " ";
  }
  res.finished = true;
  queueTick1(markResponseEndedNT, res);
  res.emit("prefinish");
  return res;
}

function sendTrailers(res: $Node.ServerResponse, trailer: string): boolean {
  if (
    res._hasBody &&
    !res.hasHeader("content-length") &&
    res.req?.httpVersionMajor === 1 &&
    (res.req?.httpVersionMinor as number) >= 1
  ) {
    res.socket?.[kHandle]?.setResponseTrailers(trailer);
    return true;
  }
  return false;
}

ServerResponse.prototype.end = function (
  this: $Node.ServerResponse,
  chunk?: $Node.HttpChunk | null | $Node.HttpWriteCallback,
  encoding?: string | null | $Node.HttpWriteCallback,
  callback?: $Node.HttpWriteCallback | null,
) {
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

  const exchange = this.$exchange;
  let flags = exchange !== undefined && exchange.response === this ? exchange.flags : EXCHANGE_WAITS_ITS_TURN;
  if ((flags & EXCHANGE_WAITS_ITS_TURN) !== 0 || this.finished || this.destroyed) {
    ("unlikely");
    return endInFull(this, exchange, chunk, encoding, callback);
  }

  const handle = this[kHandle];
  if (!handle) {
    ("unlikely");
    return OutgoingMessagePrototype.end.$call(this, chunk, encoding, callback);
  }

  let headerState = exchange.headerState;
  let held: HeldChunk | null = null;
  if ((flags & EXCHANGE_HOLDS_CHUNK) !== 0) {
    if (chunk) {
      sendHeldChunk(this, exchange);
      flags = exchange.flags;
    } else {
      held = exchange.heldChunk!;
      chunk = held.chunk;
      encoding = undefined;
      exchange.heldChunk = null;
      headerState = NodeHTTPHeaderState.assigned;
      flags &= ~EXCHANGE_HOLDS_CHUNK;
      exchange.flags = flags;
    }
  } else if (headerState === NodeHTTPHeaderState.none) {
    updateHasBody(this, (this.statusCode = validateStatusCode(this.statusCode)));
  }
  if (held === null && !this._hasBody && chunk) {
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
    if (sendTrailers(this, trailer)) headerState = exchange.headerState;
  }

  if (headerState === NodeHTTPHeaderState.none) {
    callWriteHeadIfObservable(this, headerState, true);
    flags = exchange.flags;
  }

  const socket = exchange.connection;
  if (socket === null || !socket.$isOpen) {
    ("unlikely");
    if ((handle.flags & NodeHTTPResponseFlags.closed_or_completed) !== 0) {
      return endWithoutSocket(this, exchange, true);
    }
  }
  let draining = false;
  if (headerState !== NodeHTTPHeaderState.sent) {
    const renderedHeaders = (held !== null ? headOf(held) : renderNativeHeaders(this, exchange)) as string[];
    const hasSnapshot = (flags & EXCHANGE_HAS_SNAPSHOT) !== 0;
    const statusCode = hasSnapshot ? exchange.statusCode : this.statusCode;
    const statusMessage = hasSnapshot
      ? exchange.statusMessage || undefined
      : this.statusMessage === undefined
        ? undefined
        : this.statusMessage;
    const strict = this.strictContentLength ? strictContentLength(this, headerState, true) : undefined;
    const autoHeaders = renderedAutoHeaders;
    const keepAliveSecs = renderedKeepAliveSecs;
    let contentLength: number;
    try {
      contentLength =
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
    } catch (error) {
      return endAfterNativeThrow(this, exchange, handle, error);
    }
    exchange.headerState = exchange.response[headerStateSymbol] = NodeHTTPHeaderState.sent;
    if (contentLength < 0) {
      ("unlikely");
      draining = true;
      contentLength = -contentLength - 1;
    }
    if (held === null) this._contentLength = contentLength;
  } else {
    const handleFlags = handle.flags;
    if (!!(handleFlags & NodeHTTPResponseFlags.closed_or_completed)) {
      ("unlikely");
      return endWithoutSocket(this, exchange, true);
    }
    if (
      !(!chunk && handleFlags & NodeHTTPResponseFlags.ended) &&
      !(handleFlags & NodeHTTPResponseFlags.socket_closed)
    ) {
      draining = handle.end(chunk, encoding, undefined, strictContentLength(this, headerState, true)) < 0;
    }
  }
  this._header = " ";
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
    if ((flags & EXCHANGE_TICK_QUEUED) === 0) queueExchangeTick(exchange, flags | EXCHANGE_ENDED_CLEAN);
    else if (exchange.tickMark === ring.write)
      exchange.flags = flags | EXCHANGE_ENDED_CLEAN | EXCHANGE_ENDED_BEFORE_ITS_TICK;
    else
      queueExchangeTick(
        exchange,
        flags | EXCHANGE_ENDED_CLEAN | EXCHANGE_ENDED_BEFORE_ITS_TICK | EXCHANGE_SKIPS_A_TICK,
      );
    return this;
  }

  return finishInSteps(this, exchange, handle, draining, callback);
};

function finishInSteps(
  res: $Node.ServerResponse,
  exchange: Exchange | undefined,
  handle: $Node.NodeHTTPResponse | $Node.Http1ResponseHandle,
  draining: boolean,
  callback: $Node.HttpWriteCallback | null | undefined,
): $Node.ServerResponse {
  queueTick1(markResponseEndedNT, res);
  res.emit("prefinish");

  if (draining) {
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

function queueResponseFinished(res: $Node.ServerResponse, callback: $Node.HttpWriteCallback | null | undefined) {
  res._callPendingCallbacks();
  queueTick2(emitResponseFinished, res, callback);
}

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
  queueResponseFinished(this, callback);
}

// For internal/http1_server_fallback. Like Node.js's onFinish it emits 'finish' in place: a tick later, a closing socket's 'close' listeners would run first.
function finishDrainedResponse(res: $Node.ServerResponse) {
  const callback = res[kPendingFinish];
  if (callback === undefined) return;
  storeRarely(res, kPendingFinish, undefined);
  followResponse(res.$exchange);
  res._callPendingCallbacks();
  emitResponseFinished(res, callback);
}

Object.defineProperty(ServerResponse.prototype, "writable", {
  // Node.js's OutgoingMessage assigns `this.writable = true` in the
  // constructor and never flips it back to false - not on end(), not on
  // destroy(), not when the peer aborts (see upstream
  // test-http-writable-true-after-close).
  get() {
    return true;
  },
  set(_value) {},
});

ServerResponse.prototype.write = function (
  this: $Node.ServerResponse,
  chunk?: $Node.HttpChunk | null | $Node.HttpWriteCallback,
  encoding?: string | null | $Node.HttpWriteCallback,
  callback?: $Node.HttpWriteCallback | null,
) {
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

  const exchange = this.$exchange;
  const flags = exchange !== undefined && exchange.response === this ? exchange.flags : EXCHANGE_WAITS_ITS_TURN;
  if ((flags & EXCHANGE_WAITS_ITS_TURN) !== 0 || this.finished || this.destroyed) {
    ("unlikely");
    return writeInFull(this, exchange, chunk, encoding, callback);
  }

  let result = 0;

  const headerState = exchange.headerState;
  if (headerState === NodeHTTPHeaderState.none) callWriteHeadIfObservable(this, headerState);

  const handle = this[kHandle];
  if (!handle) {
    ("unlikely");
    return OutgoingMessagePrototype.write.$call(this, chunk!, encoding, callback);
  }

  if (exchange.headerState === NodeHTTPHeaderState.none) {
    updateHasBody(this, (this.statusCode = validateStatusCode(this.statusCode)));
  }
  if (!this._hasBody && chunk) {
    ("unlikely");
    if (this[kRejectNonStandardBodyWrites]) {
      throw $ERR_HTTP_BODY_NOT_ALLOWED();
    } else {
      chunk = undefined;
    }
  }

  if (
    typeof chunk === "string" &&
    callback === undefined &&
    encoding == null &&
    exchange.headerState !== NodeHTTPHeaderState.sent &&
    (exchange.headerBits & HEADER_CONTENT_LENGTH) !== 0 &&
    exchange.oddMask === 0 &&
    !this.strictContentLength &&
    // Native code refuses some status messages, and this call is the one to throw. writeHead() has looked at its own.
    (this.statusMessage === undefined || (flags & EXCHANGE_HAS_SNAPSHOT) !== 0) &&
    chunk.length * 3 < this[kHighWaterMark] &&
    this.getHeader === outgoingGetHeader &&
    reachesWritableHighWaterMark(this) &&
    ticksAreUnhooked() &&
    callsPendingCallbacksUnseen(this)
  ) {
    const socket = exchange.connection;
    if (socket !== null && socket.$isOpen) {
      const renderedHeaders = renderNativeHeaders(this, exchange);
      exchange.heldChunk = new HeldChunk(chunk, renderedHeaders, renderedAutoHeaders, renderedKeepAliveSecs);
      this[kBytesBuffered] = exchange.bytesBuffered += Buffer.byteLength(chunk);
      this[kAccountingFlushScheduled] = true;
      exchange.headerState = exchange.response[headerStateSymbol] = NodeHTTPHeaderState.sent;
      // The head counts as sent, so what is assigned to statusCode or statusMessage from here on has no effect on the wire.
      if ((flags & EXCHANGE_HAS_SNAPSHOT) === 0) {
        exchange.statusCode = this.statusCode;
        exchange.statusMessage = "";
      }
      const held = flags | EXCHANGE_HOLDS_CHUNK | EXCHANGE_HAS_SNAPSHOT;
      if ((flags & EXCHANGE_TICK_QUEUED) === 0) queueExchangeTick(exchange, held);
      else exchange.flags = held;
      return true;
    }
  }
  if ((flags & EXCHANGE_HOLDS_CHUNK) !== 0) sendHeldChunk(this, exchange);

  const handleFlags = handle.flags;
  if (!!(handleFlags & NodeHTTPResponseFlags.closed_or_completed)) {
    return false;
  }

  const strict = strictContentLength(this, headerState, false);
  const hasBody = this._hasBody;
  let onWritable: (() => void) | undefined;
  if (hasBody) {
    const bound = exchange.onWritable;
    onWritable = bound !== null ? bound : (exchange.onWritable = allowWritesToContinue.bind(this));
  }

  if (exchange.headerState !== NodeHTTPHeaderState.sent) {
    handle.cork(() => {
      const renderedHeaders = renderNativeHeaders(this, exchange);
      handle.writeHead(
        statusCodeToSend(this),
        statusMessageToSend(this),
        renderedHeaders as string[],
        renderedAutoHeaders,
        renderedKeepAliveSecs,
      );
      exchange.headerState = exchange.response[headerStateSymbol] = NodeHTTPHeaderState.sent;
      result = handle.write(chunk, encoding, onWritable, strict);
    });
  } else {
    result = handle.write(chunk, encoding, onWritable, strict);
  }

  if (result < 0 && hasBody) {
    ("unlikely");
    if (callback) addPendingCallback(this, callback);
    return false;
  }

  this._callPendingCallbacks();
  if (callback && !hasSentForCallback(this, handle, hasBody, callback)) return false;

  let written = 0;
  if (chunk) {
    written = typeof chunk === "string" ? Buffer.byteLength(chunk, encoding) : chunk.length;
    if (
      written > 0 &&
      (this.getHeader === outgoingGetHeader
        ? !hasHeaderUnderKey(exchange, this, "content-length", HEADER_CONTENT_LENGTH)
        : this.getHeader("content-length") === undefined)
    ) {
      written += ((31 - Math.clz32(written)) >> 2) + 5;
    }
  }
  if (written > 0 && !exchange.isReplaying) {
    this[kBytesBuffered] = exchange.bytesBuffered += written;
    if ((exchange.flags & EXCHANGE_TICK_QUEUED) === 0) scheduleWriteAccountingFlush(this);
    else this[kAccountingFlushScheduled] = true;
  }

  const buffered = exchange.bytesBuffered;
  if (buffered === 0) return true;
  const connection = exchange.connection;
  if (connection !== null && this[kSocket] === connection && reachesWritableHighWaterMark(this)) {
    return buffered < connection.$ownWritableState.highWaterMark;
  }
  return buffered < this.writableHighWaterMark;
};

function bytesBufferedOf(res: $Node.ServerResponse): number {
  const exchange = res.$exchange;
  return exchange !== undefined && exchange.response === res ? exchange.bytesBuffered : (res[kBytesBuffered] ?? 0);
}

function writeHeadAndChunk(
  res: $Node.ServerResponse,
  exchange: Exchange | undefined,
  handle: $Node.NodeHTTPResponse | $Node.Http1ResponseHandle,
  chunk: $Node.HttpChunk | null | undefined,
  encoding: string | null | undefined,
  onWritable: $Node.HttpWriteCallback | null | undefined,
  strict: number | undefined,
): number {
  let result = 0;
  handle.cork(() => {
    writeHeadToHandle(res, exchange, handle);
    // If handle.writeHead throws, headersSent stays false.
    storeHeaderState(res, exchange, NodeHTTPHeaderState.sent);
    result = handle.write(chunk, encoding, onWritable, strict);
  });
  return result;
}

// A write callback reports that its bytes reached the socket: they are uncorked before the callback can destroy the response.
function hasSentForCallback(
  res: $Node.ServerResponse,
  handle: $Node.NodeHTTPResponse | $Node.Http1ResponseHandle,
  hasBody: boolean,
  callback: $Node.HttpWriteCallback,
): boolean {
  handle.flushHeaders();
  if (hasBody && handle.bufferedAmount > 0) {
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
  const callbacks = res[kPendingCallbacks]!;
  if (callbacks === noCallbacks) res[kPendingCallbacks] = [callback];
  else callbacks.push(callback);
}

// advanceResponsePipeline replays buffered ops through these; patched res.write/res.end (compression middleware) must not see them again.
const ServerResponsePrototypeWrite: $Node.ServerResponse["write"] = ServerResponse.prototype.write;
const ServerResponsePrototypeEnd: $Node.ServerResponse["end"] = ServerResponse.prototype.end;

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
  if (needsDrain && !res.destroyed && !res.finished) {
    res.emit("drain");
  }
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
  const originalLength = this[kPendingCallbacks]!.length;

  for (let i = 0; i < originalLength; ++i) {
    process.nextTick(this[kPendingCallbacks]![i]);
  }

  if (this[kPendingCallbacks]!.length == originalLength) {
    // If the array wasn't somehow appended to, just set it to an empty array
    this[kPendingCallbacks] = [];
  } else {
    // Otherwise, splice it.
    this[kPendingCallbacks]!.splice(0, originalLength);
  }
});

ServerResponse.prototype._finish = function (this: $Node.ServerResponse) {
  this.emit("prefinish");
};

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
    // Drop the request reference so a kept-alive idle connection does not
    // pin the last request in memory (Node.js frees the parser's incoming
    // reference when the response finishes).
    if (socket[kRequest] === this.req) {
      socket[kRequest] = undefined;
    }
  }

  this.socket = null;
});

const OriginalImplicitHeadFn = (ServerResponse.prototype._implicitHeader = function (this: $Node.ServerResponse) {
  if (this.headersSent) return;
  this.writeHead(this.statusCode);
});

Object.defineProperty(ServerResponse.prototype, "writableNeedDrain", {
  get(this: $Node.ServerResponse) {
    // True between a write() that returned false and the next 'drain'. An armed native drain callback means a later write flushed the bytes.
    const handle = this[kHandle];
    return (
      !this.destroyed &&
      !this.finished &&
      ((handle?.bufferedAmount ?? 0) !== 0 ||
        handle?.onwritable !== undefined ||
        bytesBufferedOf(this) >= this.writableHighWaterMark ||
        (this[kPipelinedQueuedState]?.needDrain ?? false))
    );
  },
});

Object.defineProperty(ServerResponse.prototype, "writableFinished", {
  get(this: $Node.ServerResponse) {
    const handle = this[kHandle];
    // Like Node, nothing is left to write once the socket is gone.
    return !!(
      this.finished &&
      (!handle || handle.finished || handle.flags & NodeHTTPResponseFlags.closed_or_completed)
    );
  },
});

Object.defineProperty(ServerResponse.prototype, "writableLength", {
  get(this: $Node.ServerResponse) {
    if (this.writableFinished) return 0;
    sendWhatIsHeld(this);
    // Bytes handed off this event-loop turn (including chunked framing, like
    // Node.js's outputData accounting) plus whatever the native handle still
    // has buffered, plus anything buffered while queued behind a pipelined
    // response.
    return bytesBufferedOf(this) + (this[kHandle]?.bufferedAmount ?? 0) + (this[kPipelinedQueuedState]?.bytes ?? 0);
  },
});

Object.defineProperty(ServerResponse.prototype, "writableHighWaterMark", {
  get(this: $Node.ServerResponse) {
    // Like Node.js's OutgoingMessage: the socket's high water mark when one
    // is assigned (the stream default differs by platform), otherwise the
    // OutgoingMessage default set by the constructor.
    return this.socket?.writableHighWaterMark ?? this[kHighWaterMark] ?? 64 * 1024;
  },
});

Object.defineProperty(ServerResponse.prototype, "closed", {
  get(this: $Node.ServerResponse) {
    return this._closed;
  },
});

ServerResponse.prototype._send = function (
  this: $Node.ServerResponse,
  data: $Node.HttpChunk,
  encoding?: string | null,
  callback?: $Node.HttpWriteCallback | null,
  _byteLength?: number,
) {
  const exchange = this.$exchange;
  if (exchange === undefined || exchange.response !== this) spillStateReachedThrough(this);
  const handle = this[kHandle];
  if (!handle) {
    return OutgoingMessagePrototype._send.$apply(this, arguments);
  }

  const strict = strictContentLength(this, this[headerStateSymbol], false);
  if (this[headerStateSymbol] !== NodeHTTPHeaderState.sent) {
    writeHeadAndChunk(this, exchange, handle, data, encoding, callback, strict);
  } else {
    handle.write(data, encoding, callback, strict);
  }
};

const OriginalWriteHeadFn = (ServerResponse.prototype.writeHead = function (
  this: $Node.ServerResponse,
  statusCode: number,
  statusMessage?: string | $Node.HttpHeadersInit | null,
  headers?: $Node.HttpHeadersInit | null,
) {
  const exchange = this.$exchange;
  if (
    exchange === undefined ||
    exchange.response !== this ||
    this.hasHeader !== outgoingHasHeader ||
    !reachesHeadersSent(this)
  ) {
    ("unlikely");
    return writeHeadInFull.$call(this, statusCode, statusMessage, headers);
  }
  if (exchange.headerState !== NodeHTTPHeaderState.none) throw $ERR_HTTP_HEADERS_SENT("writeHead");
  _writeHead(statusCode, statusMessage, headers, this, exchange);

  // Node.js renders the header block immediately in writeHead(), so mutating
  // res.statusCode/statusMessage afterwards has no effect on the wire.
  // Headers are flushed lazily here, so snapshot the status line now.
  exchange.statusCode = this[kSnapshotStatusCode] = this.statusCode;
  exchange.statusMessage = this[kSnapshotStatusMessage] = this.statusMessage!;
  exchange.flags |= EXCHANGE_HAS_SNAPSHOT;

  // Node's writeHead() freezes body framing: _storeHeader runs with _contentLength null and
  // a later end(chunk) cannot add Content-Length once _header exists. Headers render lazily
  // here, so record the frozen choice for renderNativeHeaders.
  if (
    !exchange.isImplicitFromEnd &&
    !hasHeaderUnderKey(exchange, this, "content-length", HEADER_CONTENT_LENGTH) &&
    !hasHeaderUnderKey(exchange, this, "transfer-encoding", HEADER_TRANSFER_ENCODING)
  ) {
    exchange.isFrozenChunked = this[kFramingFrozenChunked] = true;
  }

  exchange.headerState = exchange.response[headerStateSymbol] = NodeHTTPHeaderState.assigned;

  // Standalone responses (no native handle, e.g. new ServerResponse(req) +
  // assignSocket(writable)) write through the OutgoingMessage machinery, so
  // render the header block immediately like Node.js does.
  if (!this[kHandle] && !this._header) {
    ("unlikely");
    storeHeadWithoutHandle(this, exchange);
  }

  return this;
});

function storeHeadWithoutHandle(res: $Node.ServerResponse, exchange: Exchange | undefined): void {
  const statusLine = `HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n`;
  if (exchange !== undefined) spillHeaders(exchange);
  res._storeHeader(statusLine, res[kOutHeaders]);
}

ServerResponse.prototype.assignSocket = function (this: $Node.ServerResponse, socket: $Node.HttpSocket) {
  if (socket._httpMessage) {
    throw $ERR_HTTP_SOCKET_ASSIGNED();
  }
  socket._httpMessage = this;
  socket.once("close", onServerResponseClose);
  this.socket = socket;
  this.emit("socket", socket);
  // Like Node.js: drain anything written before the socket was assigned.
  this._flush();
};

// Backed by real storage (the native response handle exposes no such flag):
// the standalone _storeHeader path's 204/304 handling assigns it, graceful
// shutdown helpers clear it on in-flight responses, and renderNativeHeaders
// consults it for the Connection header and close-on-finish.
Object.defineProperty(ServerResponse.prototype, "shouldKeepAlive", {
  get(this: $Node.ServerResponse) {
    return this[kShouldKeepAlive] ?? true;
  },
  set(this: $Node.ServerResponse, value) {
    this[kShouldKeepAlive] = value;
  },
});

ServerResponse.prototype.destroy = function (this: $Node.ServerResponse, err?: Error | null) {
  if (this.destroyed) return this;
  sendWhatIsHeld(this);
  const handle = this[kHandle];
  this.destroyed = true;
  // Like Node.js's OutgoingMessage#destroy: remember the error (even when it
  // is undefined) so `res.errored` reports it, and forward it to the socket.
  this[kErrored] = err;
  // A response that is still queued behind an in-flight pipelined response
  // does not own the connection: destroying it must not touch the socket
  // (Node.js destroys a socket-less OutgoingMessage without side effects).
  if (handle && this[kPipelinedQueuedState] === undefined) {
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
    settleDispatchAtClose(this);
  }
  return plainStream.emit.$apply(this, arguments);
});

function emitResponseFinishedThenClose(res: $Node.ServerResponse, callback: $Node.HttpWriteCallback | null) {
  emitResponseFinished(res, callback);
  res.emit("close");
}

ServerResponse.prototype.flushHeaders = function (this: $Node.ServerResponse) {
  const exchange = this.$exchange;
  if (exchange === undefined || exchange.response !== this) spillStateReachedThrough(this);
  else sendWhatIsHeld(this);
  if (this[headerStateSymbol] === NodeHTTPHeaderState.sent) return; // Should be idempotent.
  if (this[headerStateSymbol] !== NodeHTTPHeaderState.assigned) this._implicitHeader();

  if (this[kPipelinedQueuedState] !== undefined) {
    // Queued pipelined response: its headers go out when it is assigned the
    // socket (advanceResponsePipeline) - nothing can be flushed before then.
    return;
  }

  const handle = this[kHandle];
  if (handle) {
    if (this[headerStateSymbol] === NodeHTTPHeaderState.assigned) {
      storeHeaderState(this, exchange, NodeHTTPHeaderState.sent);
      writeHeadToHandle(this, exchange, handle);
    }
    handle.flushHeaders();
  } else {
    // Standalone path: _storeHeader rendered this._header; _send('') pushes
    // it to the assigned socket like OutgoingMessage.flushHeaders does.
    this._send("");
  }
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

function callWriteHeadIfObservable(self: $Node.ServerResponse, headerState: NodeHTTPHeaderState, fromEnd?: boolean) {
  if (
    headerState === NodeHTTPHeaderState.none &&
    !(self.writeHead === OriginalWriteHeadFn && self._implicitHeader === OriginalImplicitHeadFn)
  ) {
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

function allowWritesToContinue(this: $Node.ServerResponse) {
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
    process.nextTick(callbacks![i], failure);
  }
}

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

  // Node passes options.highWaterMark through to net.Server, which applies it
  // to every accepted connection socket (and from there to req/res streams).
  this[kHighWaterMark] = options.highWaterMark;

  this[kUniqueHeaders] = parseUniqueHeadersOption(options.uniqueHeaders);

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
  if ((flags & EXCHANGE_HOLDS_CHUNK) !== 0) sendHeldChunk(exchange.response, exchange);
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
  exchange.headerState = response[headerStateSymbol] | 0;
  exchange.mustClose = !!response[kMustCloseConnection];
  exchange.isFrozenChunked = !!response[kFramingFrozenChunked];
  exchange.isImplicitFromEnd = !!response[kImplicitHeaderFromEnd];
  exchange.bytesBuffered = response[kBytesBuffered] ?? 0;
  exchange.isFlushScheduled = !!response[kAccountingFlushScheduled] && (exchange.flags & EXCHANGE_TICK_QUEUED) === 0;
  exchange.pendingFinish = response[kPendingFinish];
  const statusCode = response[kSnapshotStatusCode];
  if (statusCode !== undefined) {
    exchange.statusCode = statusCode;
    exchange.statusMessage = response[kSnapshotStatusMessage]!;
    exchange.flags |= EXCHANGE_HAS_SNAPSHOT;
  }
}

function storeMustClose(res: $Node.ServerResponse, exchange: Exchange | undefined): void {
  res[kMustCloseConnection] = true;
  if (exchange !== undefined) exchange.mustClose = !!exchange.response[kMustCloseConnection];
}

function storeHeaderState(res: $Node.ServerResponse, exchange: Exchange | undefined, state: NodeHTTPHeaderState): void {
  res[headerStateSymbol] = state;
  if (exchange !== undefined) exchange.headerState = exchange.response[headerStateSymbol] | 0;
}

function writeHeadToHandle(
  res: $Node.ServerResponse,
  exchange: Exchange | undefined,
  handle: $Node.NodeHTTPResponse | $Node.Http1ResponseHandle,
): void {
  const renderedHeaders = renderNativeHeadersOf(res, exchange);
  const statusCode = statusCodeToSend(res);
  const statusMessage = statusMessageToSend(res);
  handle.writeHead(statusCode, statusMessage, renderedHeaders as string[], renderedAutoHeaders, renderedKeepAliveSecs);
}

function endInFull(
  res: $Node.ServerResponse,
  exchange: Exchange | undefined,
  chunk: $Node.HttpChunk | null | undefined,
  encoding: string | null | undefined,
  callback: $Node.HttpWriteCallback | undefined,
) {
  if (exchange === undefined || exchange.response !== res) spillStateReachedThrough(res);
  const handle = res[kHandle];

  const droppedChunk = !!chunk && res.destroyed && !res.finished;
  if (droppedChunk) chunk = undefined;

  if (hasServerResponseFinished(res, chunk, callback, true)) {
    return res;
  }

  const queuedState = res[kPipelinedQueuedState];
  if (queuedState !== undefined) {
    return bufferPipelinedEnd(res, queuedState, chunk, encoding, callback);
  }

  if (!handle) {
    return OutgoingMessagePrototype.end.$call(res, chunk, encoding, callback);
  }

  if (res[headerStateSymbol] === NodeHTTPHeaderState.none) {
    updateHasBody(res, (res.statusCode = validateStatusCode(res.statusCode)));
  }
  if (chunk && !res._hasBody) {
    if (res[kRejectNonStandardBodyWrites]) {
      throw $ERR_HTTP_BODY_NOT_ALLOWED();
    } else {
      chunk = undefined;
    }
  }

  const trailer = res._trailer;
  if (trailer) sendTrailers(res, trailer);

  const headerState = res[headerStateSymbol];
  if (!droppedChunk) callWriteHeadIfObservable(res, headerState, true);

  const flags = handle.flags;
  if (!!(flags & NodeHTTPResponseFlags.closed_or_completed)) {
    return endWithoutSocket(res, exchange, !droppedChunk || headerState !== NodeHTTPHeaderState.none);
  }
  let draining = false;
  if (headerState !== NodeHTTPHeaderState.sent) {
    const renderedHeaders = renderNativeHeadersOf(res, exchange) as string[];
    let contentLength: number;
    try {
      contentLength = handle.writeHeadAndEnd(
        statusCodeToSend(res),
        statusMessageToSend(res),
        renderedHeaders,
        chunk,
        encoding,
        strictContentLength(res, headerState, true),
        renderedAutoHeaders,
        renderedKeepAliveSecs,
      );
    } catch (error) {
      return endAfterNativeThrow(res, exchange, handle, error);
    }
    storeHeaderState(res, exchange, NodeHTTPHeaderState.sent);
    if (contentLength < 0) {
      draining = true;
      contentLength = -contentLength - 1;
    }
    res._contentLength = contentLength;
  } else {
    if (!(!chunk && flags & NodeHTTPResponseFlags.ended) && !(flags & NodeHTTPResponseFlags.socket_closed)) {
      draining = handle.end(chunk, encoding, undefined, strictContentLength(res, headerState, true)) < 0;
    }
  }
  res._header = " ";
  res.finished = true;
  return finishInSteps(res, exchange, handle, draining, callback);
}

function writeInFull(
  res: $Node.ServerResponse,
  exchange: Exchange | undefined,
  chunk: $Node.HttpChunk | null | undefined,
  encoding: string | null | undefined,
  callback: $Node.HttpWriteCallback | undefined,
) {
  if (exchange === undefined || exchange.response !== res) spillStateReachedThrough(res);
  const handle = res[kHandle];

  if (hasServerResponseFinished(res, chunk, callback, false)) {
    return false;
  }

  const queuedState = res[kPipelinedQueuedState];
  if (queuedState !== undefined) {
    return bufferPipelinedWrite(res, queuedState, chunk, encoding, callback);
  }

  let result = 0;

  const headerState = res[headerStateSymbol];
  callWriteHeadIfObservable(res, headerState);

  if (!handle) {
    return OutgoingMessagePrototype.write.$call(res, chunk!, encoding, callback);
  }

  if (res[headerStateSymbol] === NodeHTTPHeaderState.none) {
    updateHasBody(res, (res.statusCode = validateStatusCode(res.statusCode)));
  }
  if (chunk && !res._hasBody) {
    if (res[kRejectNonStandardBodyWrites]) {
      throw $ERR_HTTP_BODY_NOT_ALLOWED();
    } else {
      chunk = undefined;
    }
  }

  const flags = handle.flags;
  if (!!(flags & NodeHTTPResponseFlags.closed_or_completed)) {
    return false;
  }

  const strict = strictContentLength(res, headerState, false);
  const hasBody = res._hasBody;
  const onWritable = hasBody ? allowWritesToContinue.bind(res) : undefined;

  if (res[headerStateSymbol] !== NodeHTTPHeaderState.sent) {
    result = writeHeadAndChunk(res, exchange, handle, chunk, encoding, onWritable, strict);
  } else {
    result = handle.write(chunk, encoding, onWritable, strict);
  }

  if (result < 0 && hasBody) {
    if (callback) addPendingCallback(res, callback);
    return false;
  }

  res._callPendingCallbacks();
  if (callback && !hasSentForCallback(res, handle, hasBody, callback)) return false;

  let written = 0;
  if (chunk) {
    written = typeof chunk === "string" ? Buffer.byteLength(chunk, encoding) : chunk.length;
    if (written > 0 && res.getHeader("content-length") === undefined) {
      written += written.toString(16).length + 4;
    }
  }
  if (written > 0 && !res[kReplayingPipelinedOps]) {
    res[kBytesBuffered] = (res[kBytesBuffered] ?? 0) + written;
    followResponse(exchange);
    scheduleWriteAccountingFlush(res);
  }

  const buffered = res[kBytesBuffered];
  return !buffered || buffered < res.writableHighWaterMark;
}

function writeHeadInFull(
  this: $Node.ServerResponse,
  statusCode: number,
  statusMessage?: string | $Node.HttpHeadersInit | null,
  headers?: $Node.HttpHeadersInit | null,
) {
  const exchange = this.$exchange;
  spillStateReachedThrough(this);
  if (this.headersSent) {
    throw $ERR_HTTP_HEADERS_SENT("writeHead");
  }
  _writeHead(
    statusCode,
    statusMessage,
    headers,
    this,
    exchange !== undefined && exchange.response === this ? exchange : undefined,
  );

  this[kSnapshotStatusCode] = this.statusCode;
  this[kSnapshotStatusMessage] = this.statusMessage;

  if (!this[kImplicitHeaderFromEnd] && !this.hasHeader("content-length") && !this.hasHeader("transfer-encoding")) {
    this[kFramingFrozenChunked] = true;
  }

  this[headerStateSymbol] = NodeHTTPHeaderState.assigned;
  followResponse(exchange);

  if (!this[kHandle] && !this._header) {
    storeHeadWithoutHandle(this, exchange);
  }

  return this;
}

// Share the pipelining machinery with internal/http1_server_fallback through
// internal/http instead of the user-visible module exports.
http.responseRoad.sendWhatIsHeld = sendWhatIsHeld;
http.requestRoad.readsDestroyedUnseen = readsDestroyedUnseen as (socket: $Node.HttpSocket) => boolean;
http1ServerPipeline.queuePipelinedResponse = queuePipelinedResponse;
http1ServerPipeline.advanceResponsePipeline = advanceResponsePipeline;
http1ServerPipeline.abortQueuedPipelinedResponses = abortQueuedPipelinedResponses;
http1ServerPipeline.lastPipelinedResponse = lastPipelinedResponse;
http1ServerPipeline.maybePauseFallbackReads = maybePauseFallbackReads;
http1ServerPipeline.resumeFallbackReadsOnDrain = resumeFallbackReadsOnDrain;
http1ServerPipeline.finishDrainedResponse = finishDrainedResponse;
http1ServerPipeline.mustCloseConnection = function (res: $Node.ServerResponse) {
  const exchange = res.$exchange;
  return exchange !== undefined && exchange.response === res ? exchange.mustClose : !!res[kMustCloseConnection];
};

export default {
  Server,
  ServerResponse,
  kConnectionsCheckingInterval,
} as const;
