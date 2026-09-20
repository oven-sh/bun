// JS HTTP/1 server path over an arbitrary Duplex with a JS stand-in for NodeHTTPResponse.
// Used by http2's `allowHTTP1` ALPN fallback and http's `server.emit("connection", socket)`.
// See https://github.com/nodejs/node/blob/main/lib/_http_server.js connectionListener.
const { STATUS_CODES, kPendingCallbacks } = require("internal/http");
const { SafeSet } = require("internal/primordials");
const AsyncContextFrame = require("internal/async_context_frame");

const kHttp1Connections = Symbol("http1Connections");
const kHttp1ActiveRequests = Symbol("http1ActiveRequests");
const reportError = globalThis.reportError;

function rethrowUncaught(err) {
  throw err;
}

// Node fails the write callbacks that a destroyed socket still holds before it emits 'close' (Writable's errorBuffer).
function failPendingWriteCallbacks(res, err) {
  const callbacks = res[kPendingCallbacks];
  res[kPendingCallbacks] = [];
  for (let i = 0; i < callbacks.length; i++) {
    try {
      callbacks[i](err);
    } catch (e) {
      // An uncaught exception, as in Node. It must not cut the socket's 'close' listeners short.
      process.nextTick(rethrowUncaught, e);
    }
  }
}

function createHttp1FallbackResponseHandle(socket, shouldKeepAlive, keepAliveTimeout) {
  const { _checkInvalidHeaderChar: checkInvalidHeaderChar } = require("node:_http_common");
  let head: Http1FallbackResponseHead | null = null;
  let headWritten = false;
  let chunked = false;
  let noBody = false;
  let closeDelimited = false;
  // The drain callback of a write() that reported backpressure, and its async context (native's onwritable slot).
  let onwritable = null;
  let onwritableFrame;

  function writeHeadToSocket(contentLength) {
    if (headWritten) return;
    headWritten = true;
    const statusCode = head?.statusCode ?? 200;
    let statusMessage = head?.statusMessage;
    if (typeof statusMessage !== "string" || statusMessage === "") {
      statusMessage = STATUS_CODES[statusCode] || "unknown";
    }
    let out = `HTTP/1.1 ${statusCode} ${statusMessage}\r\n`;
    let hasContentLength = false;
    let hasTransferEncoding = false;
    let hasDate = false;
    let hasConnection = false;
    let hasKeepAlive = false;
    const headers = head?.headers;
    if (headers) {
      // ServerResponse drives this handle with renderNativeHeaders(): a flat
      // [name, value, name, value, ...] array with original-case names.
      for (let i = 0, end = headers.length - 1; i < end; i += 2) {
        const name = headers[i];
        const value = headers[i + 1];
        if (name.length === 1 && name.charCodeAt(0) === 0) {
          // node:http's NUL-named framing sentinel pair (see NodeHTTP.cpp):
          // value "2" = no body (HEAD), anything else = close-delimited.
          if (value === "2") noBody = true;
          else closeDelimited = true;
          continue;
        }
        switch (name.toLowerCase()) {
          case "content-length":
            hasContentLength = true;
            break;
          case "transfer-encoding":
            hasTransferEncoding = true;
            if (String(value).toLowerCase().includes("chunked")) chunked = true;
            break;
          case "date":
            hasDate = true;
            break;
          case "connection":
            hasConnection = true;
            break;
          case "keep-alive":
            hasKeepAlive = true;
            break;
        }
        out += `${name}: ${value}\r\n`;
      }
    }
    // renderNativeHeaders carries its framing and Connection decisions in the
    // auto-header bits (AUTO_HEADER_* in _http_server.ts / kAutoHeader* in
    // NodeHTTP.cpp) rather than the flat array.
    const autoBits = head?.autoHeaderBits ?? 0;
    // Framing decided here but Transfer-Encoding rendered after Connection (Node _storeHeader
    // order); suppress the Content-Length it would otherwise invent (RFC 9112 §6.1 smuggling).
    const chunkedFromAutoBits = (autoBits & 16) !== 0;
    // Decide the framing here, but write it after Date/Connection/Keep-Alive:
    // Node's _storeHeader emits Content-Length and the chunked Transfer-Encoding
    // after its automatic connection block.
    let autoContentLength = null;
    let autoChunked = false;
    if (!hasContentLength && !hasTransferEncoding && !noBody && !closeDelimited) {
      if (chunkedFromAutoBits || contentLength === null) {
        chunked = true;
        autoChunked = !chunkedFromAutoBits;
      } else {
        autoContentLength = contentLength;
      }
    }
    // Mirror native writeAutoHeaders: each line written iff its bit is set, so sendDate=false /
    // removeHeader / suppressed Keep-Alive round-trip identically. A head-less write (no writeHead
    // on this handle — only off node:http's ServerResponse) keeps the old defaults.
    if (head === null) {
      if (!hasDate) {
        out += `Date: ${new Date().toUTCString()}\r\n`;
      }
      if (!hasConnection && !closeDelimited) {
        if (shouldKeepAlive) {
          out += "Connection: keep-alive\r\n";
          if (!hasKeepAlive) {
            out += `Keep-Alive: timeout=${Math.floor((keepAliveTimeout || 5000) / 1000)}\r\n`;
          }
        } else {
          out += "Connection: close\r\n";
        }
      }
    } else {
      if (!hasDate && (autoBits & 1) !== 0) {
        out += `Date: ${new Date().toUTCString()}\r\n`;
      }
      if (!hasConnection) {
        if ((autoBits & 2) !== 0) {
          out += "Connection: keep-alive\r\n";
          if (!hasKeepAlive && (autoBits & 8) !== 0) {
            out += `Keep-Alive: timeout=${head.keepAliveTimeoutSecs}\r\n`;
          }
        } else if ((autoBits & 4) !== 0) {
          out += "Connection: close\r\n";
        }
      }
    }
    // Last, where Node's _storeHeader puts them — after Connection/Keep-Alive.
    if (autoContentLength !== null) {
      out += `Content-Length: ${autoContentLength}\r\n`;
    } else if (autoChunked || (chunkedFromAutoBits && chunked)) {
      out += "Transfer-Encoding: chunked\r\n";
    }
    out += "\r\n";
    writeToSocket(out);
  }

  function toBuffer(chunk, encoding) {
    if (chunk == null) return null;
    if (typeof chunk === "string") return Buffer.from(chunk, encoding || "utf8");
    return chunk;
  }

  // Like the `conn.writable` gate of Node's _writeRaw: a write to a socket that was ended (after the client's FIN) would destroy it.
  function writeToSocket(data, callback) {
    if (!socket.writableEnded) socket.write(data, callback);
  }

  function writeBody(buf, callback) {
    const length = buf ? (buf.byteLength ?? buf.length) : 0;
    if (length) {
      if (chunked) {
        writeToSocket(length.toString(16) + "\r\n");
        writeToSocket(buf);
        writeToSocket("\r\n", callback);
      } else {
        writeToSocket(buf, callback);
      }
    }
    return length;
  }

  // Runs `fn` once in the place of the waiting callback, in that callback's async context.
  function settleWaiting(fn) {
    const frame = onwritableFrame;
    onwritable = null;
    onwritableFrame = undefined;
    AsyncContextFrame.run(frame, fn);
  }

  // The bytes end() left in the socket are out, or the socket closed with them.
  function flushed() {
    if (!handle.ended || handle.finished) return;
    handle.finished = true;
    try {
      handle.onflushed?.();
    } catch (err) {
      // A 'finish' listener that throws must not unwind into the socket's write callbacks or 'close' listeners.
      reportError(err);
    }
  }

  // A failed write or a destroyed socket leaves 'finish' to the socket's 'close': streams fail writes inside destroy(), or just before it.
  function onEndWritten(err) {
    if (!err && !socket.destroyed) flushed();
  }

  const handle = {
    flags: 0,
    ended: false,
    // True once the bytes end() wrote have left the socket, like the native handle's.
    finished: false,
    aborted: false,
    shouldKeepAlive,
    onfinished: null,
    // Like the native getter: an empty slot reads as undefined.
    get onwritable() {
      return onwritable ?? undefined;
    },
    set onwritable(callback) {
      onwritable = callback;
      onwritableFrame = callback ? AsyncContextFrame.current() : undefined;
    },
    // The socket's bytes while a write waits for 'drain' or an ended response is still flushing; a socket under its high water mark emits no 'drain'.
    get bufferedAmount() {
      return onwritable || (this.ended && !this.finished) ? socket.writableLength : 0;
    },
    // Native on_drain: the socket drained, so the waiting callback runs.
    socketDrained() {
      if (onwritable) settleWaiting(onwritable);
    },
    // The socket finished or closed, so no 'drain' comes: `fn` runs, and the waiting callback never does.
    socketEnded(fn) {
      if (onwritable) settleWaiting(fn);
    },
    // Runs once, from flushed(). ServerResponse#end()'s `onwritable` stays unused: its 'finish' comes a tick later, after a closing socket's 'close'.
    onflushed: null,
    cork(callback) {
      return callback();
    },
    writeContinue() {
      writeToSocket("HTTP/1.1 100 Continue\r\n\r\n");
    },
    writeInformational(chunk, encoding) {
      // _writeRaw hands the fully-rendered 1xx block here (writeEarlyHints /
      // writeProcessing / writeInformation all route through it).
      if (!socket.writableEnded) socket.write(chunk, encoding);
    },
    writeHead(statusCode, statusMessage, headers, autoHeaderBits, keepAliveTimeoutSecs) {
      const originalStatusCode = statusCode;
      statusCode |= 0;
      if (statusCode < 100 || statusCode > 999) {
        throw $ERR_HTTP_INVALID_STATUS_CODE(`${originalStatusCode}`);
      }
      if (typeof statusMessage === "string" && checkInvalidHeaderChar(statusMessage)) {
        throw $ERR_INVALID_CHAR("statusMessage");
      }
      head = { statusCode, statusMessage, headers, autoHeaderBits, keepAliveTimeoutSecs };
    },
    flushHeaders() {
      writeHeadToSocket(null);
    },
    writeHeadAndEnd(
      statusCode,
      statusMessage,
      headers,
      chunk,
      encoding,
      strictContentLength,
      autoHeaderBits,
      keepAliveTimeoutSecs,
    ) {
      // The native NodeHTTPResponse batches writeHead + end into one call;
      // this fallback composes the same two steps.
      this.writeHead(statusCode, statusMessage, headers, autoHeaderBits, keepAliveTimeoutSecs);
      return this.end(chunk, encoding, undefined, strictContentLength);
    },
    write(chunk, encoding, callback, _strictContentLength) {
      const buf = toBuffer(chunk, encoding);
      writeHeadToSocket(null);
      const length = writeBody(buf);
      // Node's rule: the socket's own write() reports the backpressure. A discarded chunk (HEAD, 204, 304) is null.
      if (buf === null || !socket.writableNeedDrain) return length;
      // Like native write_or_end: a negative result, and the callback waits for the drain.
      if (callback) this.onwritable = callback;
      // An empty write has no length to negate.
      return length > 0 ? -length : -1;
    },
    end(chunk, encoding, _callback, _strictContentLength) {
      if (this.ended) return 0;
      // A finished response emits no 'drain': native disarms its drain callback in end() too.
      this.onwritable = null;
      const buf = toBuffer(chunk, encoding);
      const length = buf ? (buf.byteLength ?? buf.length) : 0;
      writeHeadToSocket(length);
      // Like Node's `_hasBody && chunkedEncoding` gate: a bodiless (HEAD)
      // response never writes the terminating chunk, even when the user set
      // Transfer-Encoding: chunked themselves.
      const terminated = chunked && !noBody;
      writeBody(buf, terminated ? undefined : onEndWritten);
      if (terminated) writeToSocket("0\r\n\r\n", onEndWritten);
      this.ended = true;
      // Like Node's OutgoingMessage#end(): while the socket holds bytes, the response has finished when its last write completes.
      if (socket.writableLength > 0 && !socket.destroyed) {
        // An ended socket took no write, so its own 'finish' tells. The empty write is for an end() that wrote nothing: behind a body, _writev would copy that body.
        if (socket.writableEnded) socket.once("finish", onEndWritten);
        else if (!length && !terminated) socket.write("", "latin1", onEndWritten);
      } else {
        this.finished = true;
      }
      const onfinished = this.onfinished;
      if (onfinished) {
        this.onfinished = null;
        onfinished();
      }
      // A close-delimited body ends at EOF, so the response ends the connection.
      if (closeDelimited && !socket.destroyed) {
        socket.end();
      }
      // The native handle's contract: -(length + 1) while bytes still drain, so that ServerResponse#end() holds 'finish' back.
      return this.finished ? length : -(length + 1);
    },
    flushed,
    abort() {
      this.aborted = true;
      if (!socket.destroyed) socket.destroy();
    },
  };
  return handle;
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
  const { ConnResetException } = require("internal/shared");
  const { kHandle: kHttp1ResponseHandle, http1ServerPipeline } = require("internal/http");
  // Populated by node:_http_server, which the require("node:http") above loads.
  const {
    queuePipelinedResponse,
    advanceResponsePipeline,
    abortQueuedPipelinedResponses,
    lastPipelinedResponse,
    maybePauseFallbackReads,
    resumeFallbackReadsOnDrain,
    finishDrainedResponse,
    kMustCloseConnection,
  } = http1ServerPipeline;
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
  socket[kHttp1ActiveRequests] = 0;

  const kOnHeaders = HTTPParser.kOnHeaders | 0;
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

  // Like node:_http_common: the parser hands fields to kOnHeaders when its 32-field buffer is
  // full, and all trailers. After the first such flush on a connection, kOnHeadersComplete
  // gets no headers and no url for any later message.
  let flushedHeaders = [];
  let flushedUrl = "";
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

    socket[kHttp1ActiveRequests]++;

    req = new IncomingMessageClass(socket);
    req.socket = socket;
    req.httpVersionMajor = versionMajor;
    req.httpVersionMinor = versionMinor;
    req.httpVersion = `${versionMajor}.${versionMinor}`;
    req.url = url;
    req.method = typeof methodNum === "number" ? allMethods[methodNum] : methodNum;
    req.upgrade = upgrade;
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
      if (!socket._paused && socket.readable) socket.resume();
    };

    const res = new ServerResponseClass(req);
    // The native dispatcher seeds these from the server; renderNativeHeaders
    // reads them to decide the Keep-Alive auto-header bits, so the fallback
    // path must carry them too or keep-alive responses lose their timeout line.
    res._keepAliveTimeout = keepAliveTimeout;
    res._maxRequestsPerSocket = server.maxRequestsPerSocket;
    const handle = createHttp1FallbackResponseHandle(socket, shouldKeepAlive, keepAliveTimeout);
    handle.onfinished = function () {
      socket[kHttp1ActiveRequests] = Math.max(0, (socket[kHttp1ActiveRequests] || 1) - 1);
      if (!shouldKeepAlive && !socket.destroyed) {
        socket.end();
      }
    };
    handle.onflushed = function () {
      finishDrainedResponse(res);
    };
    res[kHttp1ResponseHandle] = handle;
    // Node's parserOnIncoming outgoing queue: pipelined requests parse while
    // the previous response is still assigned (its 'finish' detach is a tick
    // away), so queue this response instead of letting assignSocket throw
    // ERR_HTTP_SOCKET_ASSIGNED.
    if (socket._httpMessage) {
      queuePipelinedResponse(socket, res, versionMajor < 1 || versionMinor < 1);
    } else {
      res.assignSocket(socket);
    }
    // node's resOnFinish: release the socket once the response completes,
    // then either end the connection (a response that advertised Connection:
    // close must not be followed by another one - the close path aborts the
    // queued responses) or hand the socket to the next queued pipelined
    // response, replaying whatever it buffered.
    res.on("finish", function onFallbackResponseFinish() {
      this.detachSocket(socket);
      // `_last`: onHttp1SocketEnd saw the client's FIN while this response owned the socket.
      if (this[kMustCloseConnection] || this._last) {
        if (typeof socket.destroySoon === "function") {
          socket.destroySoon();
        } else if (!socket.writableEnded) {
          socket.end();
        }
        return;
      }
      advanceResponsePipeline(server, socket);
    });

    // Node's parserOnIncoming read gate: stop reading once the connection's
    // outgoing side is backed up, so pipelined requests cannot flood it.
    maybePauseFallbackReads(socket);

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
    const httpMessage = lastPipelinedResponse(socket) ?? socket._httpMessage;
    if (httpMessage) {
      httpMessage._last = true;
    } else if (socket.writable) {
      socket.end();
    }
  }
  // Node's socketOnDrain: a transport-backpressure pause lifts when the
  // socket drains (a queued-bytes pause lifts from the pipeline advance).
  function onHttp1SocketDrain() {
    resumeFallbackReadsOnDrain(socket);
    // Node's socketOnDrain then emits 'drain' on the response that waits for it.
    socket._httpMessage?.[kHttp1ResponseHandle]?.socketDrained();
  }
  socket.on("data", onHttp1SocketData);
  socket.on("error", onHttp1SocketErrorListener);
  socket.once("end", onHttp1SocketEnd);
  socket.on("drain", onHttp1SocketDrain);
  socket.once("finish", () => {
    const inflight = socket._httpMessage;
    // An ended socket emits no 'drain', and all that the response wrote is out: the write callbacks that wait succeed.
    inflight?.[kHttp1ResponseHandle]?.socketEnded(() => inflight._callPendingCallbacks());
  });
  // Prepended: like Node's 'finish' after a failed last write, a draining response finishes (and detaches) before the other 'close' listeners run.
  socket.prependOnceListener("close", () => {
    socket._httpMessage?.[kHttp1ResponseHandle]?.flushed();
  });
  socket.once("close", () => {
    connections.delete(socket);
    const inflight = socket._httpMessage;
    // The write callbacks that still wait fail, before the response's 'close', as in Node.
    inflight?.[kHttp1ResponseHandle]?.socketEnded(() =>
      failPendingWriteCallbacks(inflight, socket.errored ?? inflight.errored ?? $ERR_STREAM_DESTROYED("write")),
    );
    // Like the native socket's close path (Node's socketOnClose ->
    // abortIncoming): abort the in-flight request, then the responses (and
    // requests) still queued behind it, so they all emit 'close'. The
    // in-flight response's own 'close' comes from onServerResponseClose,
    // installed by assignSocket.
    const inflightReq = inflight?.req;
    if (inflightReq && !inflightReq.destroyed) {
      if (inflightReq.listenerCount("error") > 0) {
        inflightReq.destroy(new ConnResetException("aborted"));
      } else {
        inflightReq.destroy();
      }
    }
    abortQueuedPipelinedResponses(socket);
    try {
      parser.close();
    } catch {}
  });
}

function closeIdleHttp1Connections(server) {
  const connections = server[kHttp1Connections];
  if (!connections) return;
  for (const socket of connections) {
    if (!socket[kHttp1ActiveRequests] && !socket.destroyed) {
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
