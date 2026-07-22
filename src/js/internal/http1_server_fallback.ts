// The JS HTTP/1 server path: an llhttp-driven request/response cycle over an
// arbitrary Duplex, plus a stand-in for the native NodeHTTPResponse handle that
// renders the header block to the socket itself.
//
// Two consumers: node:http2's `allowHTTP1` ALPN fallback, and node:http's
// `connectionListener`, which Node registers on every http.Server so that
// `server.emit("connection", socket)` works for a socket the native listener
// never accepted.
const { STATUS_CODES } = require("internal/http");
const { SafeSet } = require("internal/primordials");

const kHttp1Connections = Symbol("http1Connections");
const kHttp1ActiveRequests = Symbol("http1ActiveRequests");

function createHttp1FallbackResponseHandle(socket, shouldKeepAlive, keepAliveTimeout) {
  const { _checkInvalidHeaderChar: checkInvalidHeaderChar } = require("node:_http_common");
  let head = null;
  let headWritten = false;
  let chunked = false;
  let noBody = false;
  let closeDelimited = false;

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
    // Node emits the chunked Transfer-Encoding after the Connection line, so the
    // bit is rendered further down — but the framing is decided here, and it has
    // to suppress the Content-Length this block would otherwise invent. Writing
    // both is a smuggling shape (RFC 9112 6.1), not a cosmetic slip.
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
    // Mirror the native writeAutoHeaders exactly: each line is written iff its
    // bit is set, so res.sendDate = false, removeHeader("date"), a removed
    // Connection header (neither connection bit) and a suppressed Keep-Alive
    // timeout all round-trip identically through this path. A head-less write
    // (nothing called writeHead on this handle) keeps the old defaults — that
    // only happens off node:http's ServerResponse, which always renders bits.
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
    socket.write(out);
  }

  function toBuffer(chunk, encoding) {
    if (chunk == null) return null;
    if (typeof chunk === "string") return Buffer.from(chunk, encoding || "utf8");
    return chunk;
  }

  function writeBody(buf) {
    const length = buf ? (buf.byteLength ?? buf.length) : 0;
    if (length) {
      if (chunked) {
        socket.write(length.toString(16) + "\r\n");
        socket.write(buf);
        socket.write("\r\n");
      } else {
        socket.write(buf);
      }
    }
    return length;
  }

  const handle = {
    flags: 0,
    ended: false,
    finished: false,
    aborted: false,
    bufferedAmount: 0,
    shouldKeepAlive,
    onfinished: null,
    cork(callback) {
      return callback();
    },
    writeContinue() {
      socket.write("HTTP/1.1 100 Continue\r\n\r\n");
    },
    writeInformational(chunk, encoding) {
      // _writeRaw hands the fully-rendered 1xx block here (writeEarlyHints /
      // writeProcessing / writeInformation all route through it).
      socket.write(chunk, encoding);
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
    write(chunk, encoding, _callback, _strictContentLength) {
      const buf = toBuffer(chunk, encoding);
      writeHeadToSocket(null);
      return writeBody(buf);
    },
    end(chunk, encoding, _callback, _strictContentLength) {
      if (this.ended) return 0;
      const buf = toBuffer(chunk, encoding);
      const length = buf ? (buf.byteLength ?? buf.length) : 0;
      writeHeadToSocket(length);
      writeBody(buf);
      // Like Node's `_hasBody && chunkedEncoding` gate: a bodiless (HEAD)
      // response never writes the terminating chunk, even when the user set
      // Transfer-Encoding: chunked themselves.
      if (chunked && !noBody) socket.write("0\r\n\r\n");
      this.ended = true;
      this.finished = true;
      const onfinished = this.onfinished;
      if (onfinished) {
        this.onfinished = null;
        onfinished();
      }
      // A close-delimited body ends at EOF, so the response ends the connection.
      if (closeDelimited && !socket.destroyed) {
        socket.end();
      }
      return length;
    },
    abort() {
      this.aborted = true;
      if (!socket.destroyed) socket.destroy();
    },
  };
  return handle;
}

// HTTP/1.1 fallback for Http2SecureServer with `allowHTTP1: true`: parses the
// request from the (already decrypted) TLS socket and emits 'request' with
// http.IncomingMessage / http.ServerResponse objects, like node does by routing
// the socket to the HTTP/1 connection listener.
function connectionListenerHTTP1(server, socket, options) {
  const http = require("node:http");
  const { HTTPParser, prepareError, calculateLenientFlags } = require("node:_http_common");
  const { kHandle: kHttp1ResponseHandle } = require("internal/http");
  const { allMethods } = process.binding("http_parser");

  const http1Options = options.http1Options || {};
  const IncomingMessageClass = http1Options.IncomingMessage || http.IncomingMessage;
  const ServerResponseClass = http1Options.ServerResponse || http.ServerResponse;
  const keepAliveTimeout = typeof server.keepAliveTimeout === "number" ? server.keepAliveTimeout : 5000;

  // Node's connectionListenerInternal sets this so handlers can reach the server
  // through req.socket.server (nodejs/node#13435).
  socket.server = server;

  const connections = (server[kHttp1Connections] ??= new SafeSet());
  connections.add(socket);
  socket[kHttp1ActiveRequests] = 0;

  const kOnHeadersComplete = HTTPParser.kOnHeadersComplete | 0;
  const kOnBody = HTTPParser.kOnBody | 0;
  const kOnMessageComplete = HTTPParser.kOnMessageComplete | 0;

  // Mirror Node's connectionListenerInternal: the parser carries the server's
  // header-size cap, its leniency resolution and its header-count limit. Passing
  // none of these left every fallback connection on the built-in defaults, so
  // maxHeaderSize / insecureHTTPParser / httpValidation / maxHeadersCount were
  // silently ignored on this path.
  const lenientFlags = calculateLenientFlags(server.httpValidation, server.insecureHTTPParser);
  const parser = new HTTPParser();
  parser.initialize(HTTPParser.REQUEST, {}, server.maxHeaderSize || 0, lenientFlags);
  parser.socket = socket;
  socket.parser = parser;
  const { maxHeadersCount } = server;
  if (typeof maxHeadersCount === "number") {
    parser.maxHeaderPairs = maxHeadersCount << 1;
  }

  let req = null;
  let pendingUpgrade = null;

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

    // Node's parserOnIncoming: llhttp's upgrade verdict only sticks for CONNECT
    // or when someone will actually handle the 'upgrade' event; otherwise the
    // request falls through to normal dispatch with req.upgrade cleared.
    // Returning 2 makes llhttp stop at the end of this message, so the bytes
    // after it — the tunnel payload — are never parsed as HTTP.
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
    // The body is fed by the parser callbacks below; reading just resumes the socket.
    req._read = function (_size) {
      if (socket.readable) socket.resume();
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
    res[kHttp1ResponseHandle] = handle;
    res.assignSocket(socket);
    // node's resOnFinish: release the socket once the response completes so the next
    // keep-alive request's response can attach (assignSocket throws
    // ERR_HTTP_SOCKET_ASSIGNED while a previous response is still assigned).
    res.on("finish", function onFallbackResponseFinish() {
      this.detachSocket(socket);
    });

    // Node's parserOnIncoming Expect routing (the native dispatcher applies the
    // same at _http_server.ts's DISPATCH_HAS_EXPECT branch).
    const expect = req.headers.expect;
    if (expect !== undefined) {
      if (String(expect).trim().toLowerCase() === "100-continue") {
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
    if (req) {
      req.complete = true;
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
      // Node's onParserExecuteCommon: this connection stops being HTTP here.
      // Free the parser, hand the socket over with whatever followed the
      // request head (the first tunnel bytes), and destroy when nobody is
      // listening — reachable only for CONNECT, since a listener-less Upgrade
      // already fell through to normal dispatch above.
      const upgradeReq = pendingUpgrade;
      pendingUpgrade = null;
      socket.removeListener("data", onHttp1SocketData);
      socket.removeListener("error", onHttp1SocketErrorListener);
      socket.removeListener("end", onHttp1SocketEnd);
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
    const httpMessage = socket._httpMessage;
    if (httpMessage) {
      httpMessage._last = true;
    } else if (socket.writable) {
      socket.end();
    }
  }
  socket.on("data", onHttp1SocketData);
  socket.on("error", onHttp1SocketErrorListener);
  socket.once("end", onHttp1SocketEnd);
  socket.once("close", () => {
    connections.delete(socket);
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
  createHttp1FallbackResponseHandle,
  connectionListenerHTTP1,
  closeIdleHttp1Connections,
  closeAllHttp1Connections,
  kHttp1Connections,
  kHttp1ActiveRequests,
};
