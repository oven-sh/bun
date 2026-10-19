// JS HTTP/1 server path over an arbitrary Duplex: Node's connectionListenerInternal for a socket that the native listener did not accept.
// Its responses have no native handle. They write through OutgoingMessage, so the socket's own write queue answers write() and its 'drain' is the response's.
// Used by http2's `allowHTTP1` ALPN fallback and http's `server.emit("connection", socket)`.
// See https://github.com/nodejs/node/blob/v26.3.0/lib/_http_server.js
const { emitCloseNT, kHttp1Connection, kNeedDrain } = require("internal/http");
const { SafeSet } = require("internal/primordials");

const kHttp1Connections = Symbol("http1Connections");
// Node's last_message_start_: from the first byte of a request to its end, closeIdleConnections() leaves the connection alone.
const kHttp1MessageOpen = Symbol("http1MessageOpen");

type IncomingMessage = import("node:http").IncomingMessage;
type ServerResponse = import("node:http").ServerResponse;
type ResponseQueue = import("internal/fifo").default<ServerResponse>;

interface Http1FallbackRequest extends IncomingMessage {
  upgrade: boolean;
  _dumped: boolean;
  joinDuplicateHeaders?: boolean;
  _addHeaderLines(headers: string[], n: number): void;
}

// Node's per-connection `state`.
interface Http1Connection {
  // The responses that wait for the socket, in request order. Made for the first pipelined request.
  outgoing: ResponseQueue | undefined;
  // The newest response in `outgoing`.
  lastOutgoing: ServerResponse | undefined;
  // The bytes those responses hold. The connection stops reading while they are over the socket's high water mark.
  outgoingData: number;
  requestsCount: number;
  onPendingData: (delta: number) => void;
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/_http_server.js#L862-L889
function updateOutgoingData(socket, connection: Http1Connection, delta: number) {
  connection.outgoingData += delta;
  socketOnDrain(socket, connection);
}

function socketOnDrain(socket, connection: Http1Connection) {
  if (socket._paused && connection.outgoingData <= socket.writableHighWaterMark) {
    socket._paused = false;
    socket.resume();
  }
  const msg = socket._httpMessage;
  if (msg && !msg.finished && msg[kNeedDrain] && msg.writableLength === 0) {
    msg[kNeedDrain] = false;
    msg.emit("drain");
  }
}

// https://github.com/nodejs/node/blob/v26.3.0/lib/_http_server.js#L1186-L1240
function resOnFinish(req, res, socket, connection: Http1Connection) {
  if (!req._consuming && !req._readableState.resumeScheduled) req._dump();
  res.detachSocket(socket);
  res[kHttp1Connection] = undefined;
  process.nextTick(emitCloseNT, res);

  if (res._last) {
    if (typeof socket.destroySoon === "function") {
      socket.destroySoon();
    } else if (!socket.writableEnded) {
      socket.end();
    }
    return;
  }
  // The 'close' of a dead socket aborts the responses that wait.
  const next = socket.destroyed ? undefined : connection.outgoing?.peek();
  if (next === undefined) return;
  if (next.destroyed) {
    // Node assigns the destroyed response and the connection stalls until requestTimeout.
    // An HTTP/1.1 connection cannot skip a response, so reset it. The response stays queued for the 'close' of the socket.
    socket.destroy();
    return;
  }
  connection.outgoing!.shift();
  next.assignSocket(socket);
}

// HTTP/1.1 fallback for Http2SecureServer `allowHTTP1: true`: parse the TLS socket and emit
// 'request' with http.IncomingMessage/ServerResponse, like Node's httpConnectionListener routing.
function connectionListenerHTTP1(server, socket, options) {
  const http = require("node:http");
  const {
    HTTPParser,
    prepareError,
    calculateLenientFlags,
    continueExpression,
    MAX_HEADER_PAIRS,
  } = require("node:_http_common");
  const { kUniqueHeaders } = require("node:_http_outgoing");
  const { ConnResetException } = require("internal/shared");
  const { allMethods } = process.binding("http_parser");

  const http1Options = options.http1Options || {};
  const IncomingMessageClass: new (socket) => Http1FallbackRequest =
    http1Options.IncomingMessage || http.IncomingMessage;
  const ServerResponseClass = http1Options.ServerResponse || http.ServerResponse;
  const keepAliveTimeout = typeof server.keepAliveTimeout === "number" ? server.keepAliveTimeout : 5000;

  // Node's connectionListenerInternal sets this so handlers can reach the server
  // through req.socket.server (nodejs/node#13435).
  socket.server = server;

  const connections = (server[kHttp1Connections] ??= new SafeSet());
  connections.add(socket);
  socket[kHttp1MessageOpen] = false;

  const connection: Http1Connection = {
    outgoing: undefined,
    lastOutgoing: undefined,
    outgoingData: 0,
    requestsCount: 0,
    onPendingData: undefined!,
  };
  connection.onPendingData = updateOutgoingData.bind(undefined, socket, connection);
  socket[kHttp1Connection] = connection;

  const kOnHeaders = HTTPParser.kOnHeaders | 0;
  const kOnMessageBegin = HTTPParser.kOnMessageBegin | 0;
  const kOnHeadersComplete = HTTPParser.kOnHeadersComplete | 0;
  const kOnBody = HTTPParser.kOnBody | 0;
  const kOnMessageComplete = HTTPParser.kOnMessageComplete | 0;

  // Mirror Node's connectionListenerInternal: carry maxHeaderSize / leniency / maxHeadersCount
  // into the parser. https://github.com/nodejs/node/blob/main/lib/_http_server.js
  const lenientFlags = calculateLenientFlags(server.httpValidation, server.insecureHTTPParser);
  const parser = new HTTPParser();
  parser.initialize(HTTPParser.REQUEST, {}, server.maxHeaderSize || 0, lenientFlags);
  parser.socket = socket;
  socket.parser = parser;
  // Node takes its parser from the node:_http_common freelist, which seeds MAX_HEADER_PAIRS.
  const { maxHeadersCount } = server;
  parser.maxHeaderPairs = typeof maxHeadersCount === "number" ? maxHeadersCount << 1 : MAX_HEADER_PAIRS;

  let req: Http1FallbackRequest | null = null;
  let pendingUpgrade: Http1FallbackRequest | null = null;

  // Like node:_http_common: after the parser's first kOnHeaders flush (32 fields, or trailers), kOnHeadersComplete gets no headers and no url.
  let flushedHeaders = [];
  let flushedUrl = "";
  parser[kOnMessageBegin] = function onHttp1MessageBegin() {
    socket[kHttp1MessageOpen] = true;
  };

  parser[kOnHeaders] = function onHttp1Headers(headers, url) {
    for (let i = 0; i < headers.length; i++) $arrayPush(flushedHeaders, headers[i]);
    flushedUrl += url;
  };

  parser[kOnHeadersComplete] = function onHttp1HeadersComplete(
    versionMajor,
    versionMinor,
    rawHeaders,
    methodNum,
    url,
    _statusCode,
    _statusMessage,
    upgrade,
    shouldKeepAlive,
  ) {
    if (rawHeaders === undefined) {
      rawHeaders = flushedHeaders;
      flushedHeaders = [];
    }
    if (url === undefined) {
      url = flushedUrl;
      flushedUrl = "";
    }

    req = new IncomingMessageClass(socket);
    req.socket = socket;
    req.httpVersionMajor = versionMajor;
    req.httpVersionMinor = versionMinor;
    req.httpVersion = `${versionMajor}.${versionMinor}`;
    req.url = url;
    req.method = typeof methodNum === "number" ? allMethods[methodNum] : methodNum;
    req.upgrade = upgrade;
    // _addHeaderLine reads this off the request (Node's parserOnHeadersComplete copies it the same way).
    if (server.joinDuplicateHeaders) {
      req.joinDuplicateHeaders = true;
    }
    req._addHeaderLines(rawHeaders, rawHeaders.length);

    // Node's parserOnIncoming: upgrade only sticks for CONNECT or when an 'upgrade' listener
    // exists; otherwise fall through to normal dispatch. Returning 2 makes llhttp stop after
    // this message so tunnel bytes are never parsed as HTTP.
    if (upgrade) {
      req.upgrade =
        req.method === "CONNECT" ||
        (typeof server.shouldUpgradeCallback === "function"
          ? !!server.shouldUpgradeCallback(req)
          : server.listenerCount("upgrade") > 0);
      if (req.upgrade) {
        pendingUpgrade = req;
        return 2;
      }
    }
    // The body is fed by the parser callbacks below; reading just resumes the
    // socket - unless the pipelining read gate paused it (the gate's release
    // resumes it instead).
    req._read = function (_size) {
      this._consuming = true;
      if (!socket._paused && socket.readable) socket.resume();
    };

    // Node's parserOnIncoming read gate: stop reading once the connection's
    // outgoing side is backed up, so pipelined requests cannot flood it.
    if (
      !socket._paused &&
      (socket._writableState?.needDrain || connection.outgoingData >= socket.writableHighWaterMark)
    ) {
      socket._paused = true;
      socket.pause();
    }

    const res = new ServerResponseClass(req, {
      highWaterMark: socket.writableHighWaterMark,
      rejectNonStandardBodyWrites: server.rejectNonStandardBodyWrites,
    });
    res._keepAliveTimeout = keepAliveTimeout;
    const { maxRequestsPerSocket } = server;
    res._maxRequestsPerSocket = maxRequestsPerSocket;
    res._onPendingData = connection.onPendingData;
    res.shouldKeepAlive = shouldKeepAlive;
    const uniqueHeaders = server[kUniqueHeaders];
    if (uniqueHeaders != null) res[kUniqueHeaders] = uniqueHeaders;
    res[kHttp1Connection] = connection;
    // Node's parserOnIncoming outgoing queue: a pipelined request parses while the
    // previous response still has the socket, so its response waits for its turn.
    if (socket._httpMessage) {
      (connection.outgoing ??= $createFIFO() as ResponseQueue).push(res);
      connection.lastOutgoing = res;
    } else {
      res.assignSocket(socket);
    }
    res.on("finish", resOnFinish.bind(undefined, req, res, socket, connection));

    // Like Node's parserOnIncoming: upgrades (handed off above) are not counted, and the socket is never closed here.
    if (
      versionMajor === 1 &&
      versionMinor === 1 &&
      typeof maxRequestsPerSocket === "number" &&
      maxRequestsPerSocket > 0
    ) {
      const requestsCount = ++connection.requestsCount;
      res.maxRequestsOnConnectionReached = maxRequestsPerSocket <= requestsCount;
      if (maxRequestsPerSocket < requestsCount) {
        server.emit("dropRequest", req, socket);
        res.writeHead(503);
        res.end();
        return 0;
      }
    }

    // Node's parserOnIncoming Expect routing (the native dispatcher applies the
    // same at _http_server.ts's DISPATCH_HAS_EXPECT branch).
    const expect = req.headers.expect;
    if (expect !== undefined && versionMajor === 1 && versionMinor === 1) {
      if (continueExpression.test(String(expect))) {
        if (server.listenerCount("checkContinue") > 0) {
          server.emit("checkContinue", req, res);
        } else {
          res.writeContinue();
          server.emit("request", req, res);
        }
      } else if (server.listenerCount("checkExpectation") > 0) {
        server.emit("checkExpectation", req, res);
      } else {
        res.writeHead(417);
        res.end();
      }
      return 0;
    }
    server.emit("request", req, res);
    return 0;
  };
  parser[kOnBody] = function onHttp1Body(chunk) {
    if (req && !req._dumped) req.push(chunk);
  };
  parser[kOnMessageComplete] = function onHttp1MessageComplete() {
    socket[kHttp1MessageOpen] = false;
    // Fields flushed after the header section are the trailers.
    const rawTrailers = flushedHeaders;
    if (rawTrailers.length !== 0) flushedHeaders = [];
    flushedUrl = "";
    if (req) {
      req.complete = true;
      req._addHeaderLines(rawTrailers, rawTrailers.length);
      req.push(null);
    }
  };

  function onHttp1SocketError(err, rawPacket) {
    // Match Node's http _connectionListener: attach err.rawPacket and, when no
    // 'clientError' listener is present, write the same raw error response
    // Node's socketOnError does before destroying.
    prepareError(err, parser, rawPacket);
    if (!server.emit("clientError", err, socket)) {
      if (socket.writable && !socket.destroyed) {
        const code = err?.code;
        socket.write(
          code === "HPE_HEADER_OVERFLOW"
            ? "HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n"
            : code === "HPE_CHUNK_EXTENSIONS_OVERFLOW"
              ? "HTTP/1.1 413 Payload Too Large\r\nConnection: close\r\n\r\n"
              : "HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n",
          "latin1",
        );
      }
      socket.destroy(err);
    }
  }
  function onHttp1SocketData(data) {
    const ret = parser.execute(data);
    if (ret instanceof Error) {
      onHttp1SocketError(ret, data);
      return;
    }
    if (pendingUpgrade) {
      // Node's onParserExecuteCommon: connection stops being HTTP here. Free parser, hand the
      // socket over with the first tunnel bytes, destroy when nobody is listening (only CONNECT
      // reaches here listener-less; Upgrade already fell through above).
      const upgradeReq = pendingUpgrade;
      pendingUpgrade = null;
      socket.removeListener("data", onHttp1SocketData);
      socket.removeListener("error", onHttp1SocketErrorListener);
      socket.removeListener("end", onHttp1SocketEnd);
      socket.removeListener("drain", onHttp1SocketDrain);
      socket.removeListener("close", onHttp1SocketClose);
      connections.delete(socket);
      try {
        parser.close();
      } catch {}
      socket.parser = null;
      const eventName = upgradeReq.method === "CONNECT" ? "connect" : "upgrade";
      const bodyHead = typeof ret === "number" ? data.slice(ret) : Buffer.alloc(0);
      if (server.listenerCount(eventName) > 0) {
        socket.readableFlowing = null;
        server.emit(eventName, upgradeReq, socket, bodyHead);
      } else {
        socket.destroy();
      }
    }
  }
  function onHttp1SocketErrorListener(err) {
    onHttp1SocketError(err, undefined);
  }
  // Node's socketOnEnd: let llhttp detect a message cut short by EOF, then end
  // the connection the way Node does (httpAllowHalfOpen / _last / idle end).
  function onHttp1SocketEnd() {
    const ret = parser.finish();
    if (ret instanceof Error) {
      onHttp1SocketError(ret, undefined);
      return;
    }
    if (!server.httpAllowHalfOpen) {
      if (req && !req.complete) req.destroy();
      if (socket.writable) socket.end();
      return;
    }
    const httpMessage = connection.outgoing?.isNotEmpty() ? connection.lastOutgoing : socket._httpMessage;
    if (httpMessage) {
      httpMessage._last = true;
    } else if (socket.writable) {
      socket.end();
    }
  }
  function onHttp1SocketDrain() {
    socketOnDrain(socket, connection);
  }
  function abortRequest(abortedReq) {
    if (!abortedReq || abortedReq.destroyed) return;
    if (abortedReq.listenerCount("error") > 0) {
      abortedReq.destroy(new ConnResetException("aborted"));
    } else {
      abortedReq.destroy();
    }
  }
  // Node's socketOnClose (abortIncoming, abortOutgoing): abort the request of the response that has the socket,
  // then the responses that still wait and their requests, so they all emit 'close'. The response that has the
  // socket emits its own 'close' from the listener that assignSocket() installed.
  function onHttp1SocketClose() {
    connections.delete(socket);
    abortRequest(socket._httpMessage?.req);
    const outgoing = connection.outgoing;
    if (outgoing !== undefined) {
      for (let queued = outgoing.shift(); queued !== undefined; queued = outgoing.shift()) {
        abortRequest(queued.req);
        queued.destroy();
      }
    }
    try {
      parser.close();
    } catch {}
  }
  socket.on("data", onHttp1SocketData);
  socket.on("error", onHttp1SocketErrorListener);
  socket.once("end", onHttp1SocketEnd);
  socket.on("drain", onHttp1SocketDrain);
  socket.once("close", onHttp1SocketClose);
}

function closeIdleHttp1Connections(server) {
  const connections = server[kHttp1Connections];
  if (!connections) return;
  for (const socket of connections) {
    // Idle: no request is arriving, and every response has been ended.
    if (
      !socket[kHttp1MessageOpen] &&
      !socket.destroyed &&
      !socket[kHttp1Connection].outgoing?.isNotEmpty() &&
      socket._httpMessage?.finished !== false
    ) {
      socket.destroy();
    }
  }
}

function closeAllHttp1Connections(server) {
  const connections = server[kHttp1Connections];
  if (!connections) return;
  for (const socket of connections) {
    if (!socket.destroyed) socket.destroy();
  }
}

export default {
  connectionListenerHTTP1,
  closeIdleHttp1Connections,
  closeAllHttp1Connections,
  kHttp1Connections,
};
