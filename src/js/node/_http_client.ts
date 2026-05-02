const { isIP, isIPv6 } = require("internal/net/isIP");

const {
  checkIsHttpToken,
  validateFunction,
  validateInteger,
  validateBoolean,
  validateString,
} = require("internal/validators");

// Internal fetch that allows body on GET/HEAD/OPTIONS for Node.js compatibility
const nodeHttpClient = $newZigFunction("fetch.zig", "nodeHttpClient", 2);
const { urlToHttpOptions } = require("internal/url");
const { throwOnInvalidTLSArray } = require("internal/tls");
const { validateHeaderName } = require("node:_http_common");
const { getTimerDuration } = require("internal/timers");
const { ConnResetException } = require("internal/shared");
const {
  kBodyChunks,
  abortedSymbol,
  kClearTimeout,
  emitErrorNextTickIfErrorListenerNT,
  isAbortError,
  kTls,
  kAbortController,
  kMethod,
  kAgent,
  kProtocol,
  kPath,
  kUseDefaultPort,
  kHost,
  kPort,
  kSocketPath,
  kFetchRequest,
  kRes,
  kUpgradeOrConnect,
  kParser,
  kMaxHeaderSize,
  kMaxHeadersCount,
  kReusedSocket,
  kOptions,
  kTimeoutTimer,
  kEmitState,
  ClientRequestEmitState,
  kSignal,
  kEmptyObject,
  getIsNextIncomingMessageHTTPS,
  setIsNextIncomingMessageHTTPS,
  typeSymbol,
  NodeHTTPIncomingRequestType,
  reqSymbol,
  callCloseCallback,
  emitCloseNTAndComplete,
  bodyStreamSymbol,
  statusCodeSymbol,
  statusMessageSymbol,
} = require("internal/http");

const { HTTPParser, freeParser } = require("node:_http_common");

const { globalAgent } = require("node:_http_agent");
const { getLazy } = require("internal/shared");
const tls = getLazy(() => require("node:tls"));
const { IncomingMessage } = require("node:_http_incoming");
const { OutgoingMessage } = require("node:_http_outgoing");

const globalReportError = globalThis.reportError;
const setTimeout = globalThis.setTimeout;
const INVALID_PATH_REGEX = /[^\u0021-\u00ff]/;

const { URL } = globalThis;

// Primordials
const ObjectAssign = Object.assign;
const RegExpPrototypeExec = RegExp.prototype.exec;
const StringPrototypeToUpperCase = String.prototype.toUpperCase;

function emitErrorEventNT(self, err) {
  if (self.destroyed) return;
  if (self.listenerCount("error") > 0) {
    self.emit("error", err);
  }
}

function ClientRequest(input, options, cb) {
  if (!(this instanceof ClientRequest)) {
    return new (ClientRequest as any)(input, options, cb);
  }

  this.write = (chunk, encoding, callback) => {
    if (this.destroyed) return false;
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

    return write_(chunk, encoding, callback);
  };

  let writeCount = 0;
  let resolveNextChunk: ((end: boolean) => void) | undefined = _end => {};

  const pushChunk = chunk => {
    this[kBodyChunks].push(chunk);
    if (writeCount > 1) {
      startFetch();
    }
    resolveNextChunk?.(false);
  };

  const write_ = (chunk, encoding, callback) => {
    const MAX_FAKE_BACKPRESSURE_SIZE = 1024 * 1024;
    const canSkipReEncodingData =
      // UTF-8 string:
      (typeof chunk === "string" && (encoding === "utf-8" || encoding === "utf8" || !encoding)) ||
      // Buffer
      ($isTypedArrayView(chunk) && (!encoding || encoding === "buffer" || encoding === "utf-8"));
    let bodySize = 0;
    if (!canSkipReEncodingData) {
      chunk = Buffer.from(chunk, encoding);
    }
    bodySize = chunk.length;
    writeCount++;

    if (!this[kBodyChunks]) {
      this[kBodyChunks] = [];
      pushChunk(chunk);

      if (callback) callback();
      return true;
    }

    // Signal fake backpressure if the body size is > 1024 * 1024
    // So that code which loops forever until backpressure is signaled
    // will eventually exit.

    for (let chunk of this[kBodyChunks]) {
      bodySize += chunk.length;
      if (bodySize >= MAX_FAKE_BACKPRESSURE_SIZE) {
        break;
      }
    }
    pushChunk(chunk);

    if (callback) callback();
    return bodySize < MAX_FAKE_BACKPRESSURE_SIZE;
  };

  const oldEnd = this.end;

  this.end = function (chunk, encoding, callback) {
    oldEnd?.$call(this, chunk, encoding, callback);

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

    if (chunk) {
      if (this.finished) {
        emitErrorNextTickIfErrorListenerNT(this, $ERR_STREAM_WRITE_AFTER_END(), callback);
        return this;
      }

      write_(chunk, encoding, null);
    } else if (this.finished) {
      if (callback) {
        if (!this.writableFinished) {
          this.on("finish", callback);
        } else {
          callback($ERR_STREAM_ALREADY_FINISHED("end"));
        }
      }
    }

    if (callback) {
      this.once("finish", callback);
    }

    if (!this.finished) {
      send();
      resolveNextChunk?.(true);
    }

    return this;
  };

  this.flushHeaders = function () {
    if (!fetching) {
      this[kAbortController] ??= new AbortController();
      this[kAbortController].signal.addEventListener("abort", onAbort, {
        once: true,
      });
      startFetch();
    }
  };

  this.destroy = function (err?: Error) {
    if (this.destroyed) return this;
    this.destroyed = true;

    const res = this.res;

    // If we're aborting, we don't care about any more response data.
    if (res) {
      res._dump();
    }

    this.finished = true;

    if (this.res && !this.res.complete) {
      this.res.emit("end");
    }

    // If request is destroyed we abort the current response
    this[kAbortController]?.abort?.();
    this.socket.destroy(err);

    return this;
  };

  this._ensureTls = () => {
    if (this[kTls] === null) this[kTls] = {};
    return this[kTls];
  };

  const socketCloseListener = () => {
    this.destroyed = true;

    const res = this.res;
    if (res) {
      // Socket closed before we emitted 'end' below.
      if (!res.complete) {
        res.destroy(new ConnResetException("aborted"));
      }
      if (!this._closed) {
        this._closed = true;
        callCloseCallback(this);
        this.emit("close");
        this.socket?.emit?.("close");
      }
      if (!res.aborted && res.readable) {
        res.push(null);
      }
    } else if (!this._closed) {
      this._closed = true;
      callCloseCallback(this);
      this.emit("close");
      this.socket?.emit?.("close");
    }
  };

  const onAbort = (_err?: Error) => {
    this[kClearTimeout]?.();
    socketCloseListener();
    if (!this[abortedSymbol] && !this?.res?.complete) {
      process.nextTick(emitAbortNextTick, this);
      this[abortedSymbol] = true;
    }
  };

  let fetching = false;

  const startFetchViaSocket = () => {
    fetching = true;

    const method = this[kMethod];
    const path = this[kPath];
    const host = this[kHost];
    const port = this[kPort];
    const protocol = this[kProtocol];
    const socketPath = this[kSocketPath];

    // Pass full options to createConnection, matching Node.js behavior.
    // The options object is compatible with net.connect() / tls.connect().
    const connectOptions = { ...options, host, port, path: socketPath || undefined };

    let socket;
    try {
      socket = createConnection(connectOptions);
    } catch (err) {
      process.nextTick((self, e) => self.emit("error", e), this, err);
      return false;
    }

    this.socket = socket;
    this[kAbortController]?.signal?.addEventListener("abort", () => socket.destroy(), { once: true });

    // --- Write HTTP/1.1 request ---
    const writeRequest = () => {
      const headers = this.getHeaders();
      let head = `${method} ${path} HTTP/1.1\r\n`;

      if (!headers.host && !headers.Host) {
        const dp = protocol === "https:" ? 443 : 80;
        const hostStr = isIPv6(host) ? `[${host}]` : host;
        head += port && port !== dp ? `Host: ${hostStr}:${port}\r\n` : `Host: ${hostStr}\r\n`;
      }

      const chunks = this[kBodyChunks];
      let body;
      if (chunks?.length > 0) {
        const bufs = chunks.map(c => (typeof c === "string" ? Buffer.from(c) : c));
        body = bufs.length === 1 ? bufs[0] : Buffer.concat(bufs);
      }

      // Check if caller already set framing headers
      let hasContentLength = false;
      let hasTransferEncoding = false;
      for (const key of Object.keys(headers)) {
        const lk = key.toLowerCase();
        if (lk === "content-length") hasContentLength = true;
        else if (lk === "transfer-encoding") hasTransferEncoding = true;
        const val = headers[key];
        if (val === undefined) continue;
        if ($isJSArray(val)) {
          for (const v of val) head += `${key}: ${v}\r\n`;
        } else {
          head += `${key}: ${val}\r\n`;
        }
      }

      // Only add Content-Length if caller didn't set framing headers
      if (body && !hasContentLength && !hasTransferEncoding) {
        head += `Content-Length: ${body.byteLength}\r\n`;
      }
      head += "\r\n";
      socket.write(head);
      if (body) socket.write(body);
    };

    // --- Parse HTTP/1.1 response using llhttp (via HTTPParser) ---
    const parser = new HTTPParser();
    parser._headers = [];
    parser._url = "";
    parser.maxHeaderPairs = 2000;
    parser.socket = socket;
    parser.initialize(HTTPParser.RESPONSE, {});

    let res: any = null;
    let parserFreed = false;
    let upgraded = false;
    let pendingUpgrade: { res: any; event: string } | null = null;

    const safelyFreeParser = () => {
      if (!parserFreed) {
        parserFreed = true;
        freeParser(parser, this, socket);
      }
    };

    const responseComplete = () => {
      if (res && !res.complete) {
        res.push(null);
        res.complete = true;
      }
      this[kClearTimeout]();
      fetching = false;
      this[kFetchRequest] = null;
      safelyFreeParser();
      maybeEmitClose();
    };

    // Build headers object from the flat [key, val, key, val, ...] array llhttp produces.
    // Duplicates are joined with ", " (matching Node.js), except set-cookie which is an array.
    const buildHeaders = (rawHeaders: string[]) => {
      const headers: any = Object.create(null);
      for (let i = 0; i < rawHeaders.length; i += 2) {
        const lk = rawHeaders[i].toLowerCase();
        const v = rawHeaders[i + 1];
        if (lk === "set-cookie") {
          headers[lk] = headers[lk] ? [...headers[lk], v] : [v];
        } else if (headers[lk] !== undefined) {
          headers[lk] += ", " + v;
        } else {
          headers[lk] = v;
        }
      }
      return headers;
    };

    parser[HTTPParser.kOnHeadersComplete] = (
      vMaj,
      vMin,
      headers,
      _method,
      _url,
      statusCode,
      statusMessage,
      upgrade,
      shouldKeepAlive,
    ) => {
      if (headers === undefined) {
        headers = parser._headers;
        parser._headers = [];
      }

      // 1xx informational responses (100 Continue, 103 Early Hints, etc.)
      // are not terminal — emit "information" and let the parser continue
      // waiting for the final response. Note: 101 Switching Protocols is
      // handled below as an upgrade, not here.
      if (statusCode >= 100 && statusCode < 200 && statusCode !== 101) {
        this.emit("information", {
          statusCode,
          statusMessage,
          httpVersion: `${vMaj}.${vMin}`,
          headers: buildHeaders(headers),
          rawHeaders: headers,
        });
        return 1; // skip body, parser stays active for next response
      }

      // Upgrade (101 Switching Protocols) or CONNECT tunnel (200) —
      // surface the live socket and stop HTTP parsing.
      // The emit is deferred: we store the upgrade info and return 2 (skip body).
      // The "data" handler captures leftover bytes via chunk.slice(ret) after
      // parser.execute() returns, so we don't lose pipelined data.
      if (upgrade || (method === "CONNECT" && statusCode === 200)) {
        upgraded = true;
        const builtHeaders = buildHeaders(headers);

        const prevIsHTTPS = getIsNextIncomingMessageHTTPS();
        setIsNextIncomingMessageHTTPS(protocol === "https:");
        const upgradeRes = new IncomingMessage(null, {});
        setIsNextIncomingMessageHTTPS(prevIsHTTPS);

        upgradeRes[statusCodeSymbol] = statusCode;
        upgradeRes[statusMessageSymbol] = statusMessage;
        upgradeRes.httpVersion = `${vMaj}.${vMin}`;
        upgradeRes.headers = builtHeaders;
        upgradeRes.rawHeaders = headers;
        upgradeRes.socket = socket;

        // Store for deferred emit in the "data" handler
        pendingUpgrade = { res: upgradeRes, event: upgrade ? "upgrade" : "connect" };
        safelyFreeParser();
        socket.removeListener("data", onData);
        socket.removeListener("end", onEnd);
        return 1; // skip body
      }

      const prevIsHTTPS = getIsNextIncomingMessageHTTPS();
      setIsNextIncomingMessageHTTPS(protocol === "https:");
      res = new IncomingMessage(null, {});
      setIsNextIncomingMessageHTTPS(prevIsHTTPS);

      res[statusCodeSymbol] = statusCode;
      res[statusMessageSymbol] = statusMessage;
      res.httpVersion = `${vMaj}.${vMin}`;
      res.headers = buildHeaders(headers);
      res.rawHeaders = headers;
      res[bodyStreamSymbol] = true; // Prevent _read from accessing fetch APIs
      res.socket = socket;
      this.res = res;
      res.req = this;
      this[kClearTimeout]();

      if (this.aborted) {
        maybeEmitClose();
        return 1;
      }
      if (!this.emit("response", res)) res._dump();
      maybeEmitClose();

      // Return value: 0 = parse body, 1 = skip body (HEAD)
      return method === "HEAD" ? 1 : 0;
    };

    parser[HTTPParser.kOnBody] = chunk => {
      if (res && !res._dumped) res.push(chunk);
    };

    parser[HTTPParser.kOnMessageComplete] = () => {
      // For 1xx informational responses, res is not set — don't free the parser,
      // just let it continue parsing the next (final) response.
      if (!res) return;

      // Handle trailing headers — override the noop prototype getter/setter
      if (parser._headers.length) {
        const trailers = buildHeaders(parser._headers);
        const rawTrailers = parser._headers.slice();
        Object.defineProperty(res, "trailers", {
          value: trailers,
          writable: true,
          enumerable: true,
          configurable: true,
        });
        Object.defineProperty(res, "rawTrailers", {
          value: rawTrailers,
          writable: true,
          enumerable: true,
          configurable: true,
        });
        parser._headers = [];
      }
      responseComplete();
    };

    parser[HTTPParser.kOnHeaders] = headers => {
      // Accumulate trailing headers (called when headers arrive in fragments or as trailers)
      parser._headers.push(...headers);
    };

    // Named handlers so they can be removed after upgrade to prevent use-after-free.
    const onData = chunk => {
      if (parserFreed) {
        // After upgrade, if there's a pending upgrade emit, capture leftover bytes
        // from the same TCP segment and emit the upgrade event now.
        if (pendingUpgrade) {
          const { res: upgradeRes, event } = pendingUpgrade;
          pendingUpgrade = null;
          this.emit(event, upgradeRes, socket, chunk);
        }
        return;
      }
      const ret = parser.execute(chunk);
      if (ret instanceof Error) {
        socket.destroy();
        this.emit("error", ret);
        return;
      }
      // After parser.execute(), check if an upgrade was detected. If so,
      // emit the upgrade event with any leftover bytes from this chunk.
      if (pendingUpgrade) {
        const { res: upgradeRes, event } = pendingUpgrade;
        pendingUpgrade = null;
        const head = typeof ret === "number" && ret < chunk.length ? chunk.slice(ret) : Buffer.alloc(0);
        this.emit(event, upgradeRes, socket, head);
      }
    };
    const onEnd = () => {
      if (parserFreed) return;
      parser.finish();
      // If the response is still incomplete after parser.finish(), the connection
      // was closed prematurely — surface an error instead of silently completing.
      if (res && !res.complete) {
        res.destroy(new ConnResetException("aborted"));
      }
    };
    socket.on("data", onData);
    socket.on("error", err => {
      if (isAbortError(err)) return;
      try {
        this.emit("error", err);
      } catch (e) {
        if (!!$debug) globalReportError(e);
      }
    });
    socket.on("end", onEnd);
    socket.on("close", () => {
      // Handle premature close — but not after a successful upgrade,
      // where res is null and the socket close is expected.
      if (res && !res.complete) {
        res.destroy(new ConnResetException("aborted"));
      } else if (!res && !upgraded) {
        // EOF before headers — emit error on the request
        this.emit("error", new ConnResetException("aborted"));
      }
      // Free parser resources on any close to avoid leaks
      safelyFreeParser();
      // Mark the request as closed/destroyed without calling socketCloseListener(),
      // which would re-emit "close" on this.socket (the real socket) causing duplicates.
      this.destroyed = true;
      if (!this._closed) {
        this._closed = true;
        callCloseCallback(this);
        this.emit("close");
      }
    });

    // Ensure socket is connected before writing.
    // Use instanceof for deterministic TLS detection, matching http2.ts pattern.
    const isTLSSocket = socket instanceof tls().TLSSocket;
    let connected = !socket.connecting && !(isTLSSocket && socket.secureConnecting);
    if (!connected) {
      const connectEvent = isTLSSocket ? "secureConnect" : "connect";
      socket.once(connectEvent, () => {
        connected = true;
        if (this.finished) writeRequest();
      });
    }

    // Write request when both connected and body is ready.
    // If end() was already called (this.finished), write immediately.
    // Otherwise, the send() function will trigger writing via resolveNextChunk.
    if (this.finished && connected) {
      process.nextTick(writeRequest);
    } else if (!this.finished) {
      // Override resolveNextChunk so that when end() signals completion,
      // we write the request to the socket.
      const origResolve = resolveNextChunk;
      resolveNextChunk = end => {
        origResolve?.(end);
        if (end && connected) writeRequest();
      };
    }

    return true;
  };

  const startFetch = (customBody?) => {
    if (fetching) {
      return false;
    }

    // Socket-based path: when createConnection is provided, bypass the fetch
    // infrastructure and use raw HTTP/1.1 over the user-provided socket.
    if (typeof createConnection === "function") {
      return startFetchViaSocket();
    }

    fetching = true;

    const method = this[kMethod];

    let keepalive = true;
    const agentKeepalive = this[kAgent]?.keepAlive;
    if (agentKeepalive !== undefined) {
      keepalive = agentKeepalive;
    }

    const protocol = this[kProtocol];
    const path = this[kPath];
    let host = this[kHost];

    const getURL = host => {
      if (isIPv6(host)) {
        host = `[${host}]`;
      }

      if (path.startsWith("http://") || path.startsWith("https://")) {
        return [path, `${protocol}//${host}${this[kUseDefaultPort] ? "" : ":" + this[kPort]}`];
      } else {
        let proxy: string | undefined;
        const url = `${protocol}//${host}${this[kUseDefaultPort] ? "" : ":" + this[kPort]}${path}`;
        // support agent proxy url/string for http/https
        try {
          // getters can throw
          const agentProxy = this[kAgent]?.proxy;
          // this should work for URL like objects and strings
          proxy = agentProxy?.href || agentProxy;
        } catch {}
        return [url, proxy];
      }
    };

    const go = (url, proxy, softFail = false) => {
      const tls =
        protocol === "https:" && this[kTls] ? { ...this[kTls], serverName: this[kTls].servername } : undefined;

      const fetchOptions: any = {
        method,
        headers: this.getHeaders(),
        redirect: "manual",
        signal: this[kAbortController]?.signal,
        // Timeouts are handled via this.setTimeout.
        timeout: false,
        // Disable auto gzip/deflate
        decompress: false,
        keepalive,
      };
      let keepOpen = false;
      // no body and not finished
      const isDuplex = customBody === undefined && !this.finished;

      if (isDuplex) {
        fetchOptions.duplex = "half";
        keepOpen = true;
      }

      // Allow body for all methods when explicitly provided via req.write()/req.end()
      // This is needed for Node.js compatibility - Node allows GET requests with bodies
      if (customBody !== undefined) {
        fetchOptions.body = customBody;
      } else if (
        isDuplex &&
        // Normal case: non-GET/HEAD/OPTIONS can use streaming
        ((method !== "GET" && method !== "HEAD" && method !== "OPTIONS") ||
          // Special case: GET/HEAD/OPTIONS with already-queued chunks should also stream
          this[kBodyChunks]?.length > 0)
      ) {
        const self = this;
        fetchOptions.body = async function* () {
          while (self[kBodyChunks]?.length > 0) {
            yield self[kBodyChunks].shift();
          }

          if (self[kBodyChunks]?.length === 0) {
            self.emit("drain");
          }

          while (!self.finished) {
            yield await new Promise(resolve => {
              resolveNextChunk = end => {
                resolveNextChunk = undefined;
                if (end) {
                  resolve(undefined);
                } else {
                  resolve(self[kBodyChunks].shift());
                }
              };
            });

            if (self[kBodyChunks]?.length === 0) {
              self.emit("drain");
            }
          }

          handleResponse?.();
        };
      }

      if (tls) {
        fetchOptions.tls = tls;
      }

      if (!!$debug) {
        fetchOptions.verbose = true;
      }

      if (proxy) {
        fetchOptions.proxy = proxy;
      }

      const socketPath = this[kSocketPath];

      if (socketPath) {
        fetchOptions.unix = socketPath;
      }

      //@ts-ignore
      this[kFetchRequest] = nodeHttpClient(url, fetchOptions).then(response => {
        if (this.aborted) {
          maybeEmitClose();
          return;
        }

        handleResponse = () => {
          this[kFetchRequest] = null;
          this[kClearTimeout]();
          handleResponse = undefined;

          const prevIsHTTPS = getIsNextIncomingMessageHTTPS();
          setIsNextIncomingMessageHTTPS(response.url.startsWith("https:"));
          var res = (this.res = new IncomingMessage(response, {
            [typeSymbol]: NodeHTTPIncomingRequestType.FetchResponse,
            [reqSymbol]: this,
          }));
          setIsNextIncomingMessageHTTPS(prevIsHTTPS);
          res.req = this;
          res.setTimeout = clientResponseSetTimeout;
          process.nextTick(
            (self, res) => {
              // If the user did not listen for the 'response' event, then they
              // can't possibly read the data, so we ._dump() it into the void
              // so that the socket doesn't hang there in a paused state.
              const contentLength = res.headers["content-length"];
              if (contentLength && isNaN(Number(contentLength))) {
                emitErrorEventNT(self, $HPE_UNEXPECTED_CONTENT_LENGTH("Parse Error"));

                res.complete = true;
                maybeEmitClose();
                return;
              }
              try {
                if (self.aborted || !self.emit("response", res)) {
                  res._dump();
                }
              } finally {
                maybeEmitClose();
                if (res.statusCode === 304) {
                  res.complete = true;
                  maybeEmitClose();
                  return;
                }
              }
            },
            this,
            res,
          );
        };

        if (!keepOpen) {
          handleResponse();
        }

        onEnd();
      });

      if (!softFail) {
        // Don't emit an error if we're iterating over multiple possible addresses and we haven't reached the end yet.
        // This is for the happy eyeballs implementation.
        this[kFetchRequest]
          .catch(err => {
            if (err.code === "ConnectionRefused") {
              err = new Error("ECONNREFUSED");
              err.code = "ECONNREFUSED";
            }
            // Node treats AbortError separately.
            // The "abort" listener on the abort controller should have called this
            if (isAbortError(err)) {
              return;
            }

            if (!!$debug) globalReportError(err);

            try {
              this.emit("error", err);
            } catch (_err) {
              void _err;
            }
          })
          .finally(() => {
            if (!keepOpen) {
              fetching = false;
              this[kFetchRequest] = null;
              this[kClearTimeout]();
            }
          });
      }

      return this[kFetchRequest];
    };

    if (isIP(host) || !options.lookup) {
      // Don't need to bother with lookup if it's already an IP address or no lookup function is provided.
      const [url, proxy] = getURL(host);
      go(url, proxy, false);
      return true;
    }

    try {
      options.lookup(host, { all: true }, (err, results) => {
        if (err) {
          if (!!$debug) globalReportError(err);
          process.nextTick((self, err) => self.emit("error", err), this, err);
          return;
        }

        let candidates = results.sort((a, b) => b.family - a.family); // prefer IPv6

        const fail = (message, name, code, syscall) => {
          const error = new Error(message);
          error.name = name;
          error.code = code;
          error.syscall = syscall;
          if (!!$debug) globalReportError(error);
          process.nextTick((self, err) => self.emit("error", err), this, error);
        };

        if (candidates.length === 0) {
          fail("No records found", "DNSException", "ENOTFOUND", "getaddrinfo");
          return;
        }

        if (!this.hasHeader("Host")) {
          this.setHeader("Host", `${host}${this[kUseDefaultPort] ? "" : ":" + this[kPort]}`);
        }

        // When custom lookup resolves hostname to IP, preserve the original
        // hostname for TLS SNI and certificate verification.
        if (protocol === "https:" && !this[kTls]?.servername) {
          this._ensureTls().servername = host;
        }

        // We want to try all possible addresses, beginning with the IPv6 ones, until one succeeds.
        // All addresses except for the last are allowed to "soft fail" -- instead of reporting
        // an error to the user, we'll just skip to the next address.
        // The last address is required to work, and if it fails we'll throw an error.

        const iterate = () => {
          if (candidates.length === 0) {
            // If we get to this point, it means that none of the addresses could be connected to.
            fail(`connect ECONNREFUSED ${host}:${port}`, "Error", "ECONNREFUSED", "connect");
            return;
          }

          const [url, proxy] = getURL(candidates.shift().address);
          go(url, proxy, candidates.length > 0).catch(iterate);
        };

        iterate();
      });

      return true;
    } catch (err) {
      if (!!$debug) globalReportError(err);
      process.nextTick((self, err) => self.emit("error", err), this, err);
      return false;
    }
  };

  let onEnd = () => {};
  let handleResponse: (() => void) | undefined = () => {};

  const send = () => {
    this.finished = true;
    this[kAbortController] ??= new AbortController();
    this[kAbortController].signal.addEventListener("abort", onAbort, { once: true });

    var body = this[kBodyChunks] && this[kBodyChunks].length > 1 ? new Blob(this[kBodyChunks]) : this[kBodyChunks]?.[0];

    try {
      startFetch(body);
      onEnd = () => {
        handleResponse?.();
      };
    } catch (err) {
      if (!!$debug) globalReportError(err);
      this.emit("error", err);
    } finally {
      process.nextTick(maybeEmitFinish.bind(this));
    }
  };

  // --- For faking the events in the right order ---
  const maybeEmitSocket = () => {
    if (this.destroyed) return;
    if (!(this[kEmitState] & (1 << ClientRequestEmitState.socket))) {
      this[kEmitState] |= 1 << ClientRequestEmitState.socket;
      this.emit("socket", this.socket);
    }
  };

  const maybeEmitPrefinish = () => {
    maybeEmitSocket();

    if (!(this[kEmitState] & (1 << ClientRequestEmitState.prefinish))) {
      this[kEmitState] |= 1 << ClientRequestEmitState.prefinish;
      this.emit("prefinish");
    }
  };

  const maybeEmitFinish = () => {
    maybeEmitPrefinish();

    if (!(this[kEmitState] & (1 << ClientRequestEmitState.finish))) {
      this[kEmitState] |= 1 << ClientRequestEmitState.finish;
      this.emit("finish");
    }
  };

  const maybeEmitClose = () => {
    maybeEmitPrefinish();

    if (!this._closed) {
      process.nextTick(emitCloseNTAndComplete, this);
    }
  };

  this.abort = () => {
    if (this.aborted) return;
    this[abortedSymbol] = true;
    process.nextTick(emitAbortNextTick, this);
    this[kAbortController]?.abort?.();
    this.destroy();
  };

  if (typeof input === "string") {
    const urlStr = input;
    try {
      var urlObject = new URL(urlStr);
    } catch (_err) {
      void _err;
      throw $ERR_INVALID_URL(`Invalid URL: ${urlStr}`);
    }
    input = urlToHttpOptions(urlObject);
  } else if (input && typeof input === "object" && input instanceof URL) {
    // url.URL instance
    input = urlToHttpOptions(input);
  } else {
    cb = options;
    options = input;
    input = null;
  }

  if (typeof options === "function") {
    cb = options;
    options = input || kEmptyObject;
  } else {
    options = ObjectAssign(input || {}, options);
  }

  this[kTls] = null;
  this[kAbortController] = null;

  let agent = options.agent;
  const defaultAgent = options._defaultAgent || globalAgent;
  if (agent === false) {
    agent = new defaultAgent.constructor();
  } else if (agent == null) {
    agent = defaultAgent;
  } else if (typeof agent.addRequest !== "function") {
    throw $ERR_INVALID_ARG_TYPE("options.agent", "Agent-like Object, undefined, or false", agent);
  }
  this[kAgent] = agent;
  this.destroyed = false;

  const protocol = options.protocol || defaultAgent.protocol;
  let expectedProtocol = defaultAgent.protocol;
  if (this.agent.protocol) {
    expectedProtocol = this.agent.protocol;
  }
  if (protocol !== expectedProtocol) {
    throw $ERR_INVALID_PROTOCOL(protocol, expectedProtocol);
  }
  this[kProtocol] = protocol;

  if (options.path) {
    const path = String(options.path);
    if (RegExpPrototypeExec.$call(INVALID_PATH_REGEX, path) !== null) {
      throw $ERR_UNESCAPED_CHARACTERS("Request path");
    }
  }

  const defaultPort = options.defaultPort || this[kAgent].defaultPort;
  const port = (this[kPort] = options.port || defaultPort || 80);
  this[kUseDefaultPort] = this[kPort] === defaultPort;
  const host =
    (this[kHost] =
    options.host =
      validateHost(options.hostname, "hostname") || validateHost(options.host, "host") || "localhost");

  this[kSocketPath] = options.socketPath;

  const signal = options.signal;
  if (signal) {
    //We still want to control abort function and timeout so signal call our AbortController
    signal.addEventListener(
      "abort",
      () => {
        this[kAbortController]?.abort();
      },
      { once: true },
    );
    this[kSignal] = signal;
  }
  let method = options.method;
  const methodIsString = typeof method === "string";
  if (method !== null && method !== undefined && !methodIsString) {
    throw $ERR_INVALID_ARG_TYPE("options.method", "string", method);
  }

  if (methodIsString && method) {
    if (!checkIsHttpToken(method)) {
      throw $ERR_INVALID_HTTP_TOKEN("Method", method);
    }
    method = this[kMethod] = StringPrototypeToUpperCase.$call(method);
  } else {
    method = this[kMethod] = "GET";
  }

  const _maxHeaderSize = options.maxHeaderSize;
  const maxHeaderSize = options.maxHeaderSize;
  if (maxHeaderSize !== undefined) validateInteger(maxHeaderSize, "maxHeaderSize", 0);
  this.maxHeaderSize = maxHeaderSize;

  this[kMaxHeaderSize] = _maxHeaderSize;

  const insecureHTTPParser = options.insecureHTTPParser;
  if (insecureHTTPParser !== undefined) {
    validateBoolean(insecureHTTPParser, "options.insecureHTTPParser");
  }

  this.insecureHTTPParser = insecureHTTPParser;
  const joinDuplicateHeaders = options.joinDuplicateHeaders;

  if (joinDuplicateHeaders !== undefined) {
    validateBoolean(joinDuplicateHeaders, "options.joinDuplicateHeaders");
  }
  this.joinDuplicateHeaders = joinDuplicateHeaders;

  if (options.pfx) {
    throw new Error("pfx is not supported");
  }

  // Merge TLS options using spread operator, matching Node.js behavior in createSocket:
  //   options = { __proto__: null, ...options, ...this.options };
  // https://github.com/nodejs/node/blob/v23.6.0/lib/_http_agent.js#L242
  // With spread, the last one wins, so agent.options overwrites request options.
  //
  // agent.options: Stored by Node.js Agent constructor
  // https://github.com/nodejs/node/blob/v23.6.0/lib/_http_agent.js#L96
  //
  // agent.connectOpts: Used by https-proxy-agent for TLS connection options (lowest priority)
  // https://github.com/TooTallNate/proxy-agents/blob/main/packages/https-proxy-agent/src/index.ts#L110-L117
  const mergedTlsOptions = { __proto__: null, ...agent?.connectOpts, ...options, ...agent?.options };

  if (mergedTlsOptions.rejectUnauthorized !== undefined) {
    this._ensureTls().rejectUnauthorized = mergedTlsOptions.rejectUnauthorized;
  }
  if (mergedTlsOptions.ca) {
    throwOnInvalidTLSArray("options.ca", mergedTlsOptions.ca);
    this._ensureTls().ca = mergedTlsOptions.ca;
  }
  if (mergedTlsOptions.cert) {
    throwOnInvalidTLSArray("options.cert", mergedTlsOptions.cert);
    this._ensureTls().cert = mergedTlsOptions.cert;
  }
  if (mergedTlsOptions.key) {
    throwOnInvalidTLSArray("options.key", mergedTlsOptions.key);
    this._ensureTls().key = mergedTlsOptions.key;
  }
  if (mergedTlsOptions.passphrase) {
    validateString(mergedTlsOptions.passphrase, "options.passphrase");
    this._ensureTls().passphrase = mergedTlsOptions.passphrase;
  }
  if (mergedTlsOptions.ciphers) {
    validateString(mergedTlsOptions.ciphers, "options.ciphers");
    this._ensureTls().ciphers = mergedTlsOptions.ciphers;
  }
  if (mergedTlsOptions.servername) {
    validateString(mergedTlsOptions.servername, "options.servername");
    this._ensureTls().servername = mergedTlsOptions.servername;
  }
  if (mergedTlsOptions.secureOptions) {
    validateInteger(mergedTlsOptions.secureOptions, "options.secureOptions");
    this._ensureTls().secureOptions = mergedTlsOptions.secureOptions;
  }
  if (mergedTlsOptions.checkServerIdentity !== undefined) {
    validateFunction(mergedTlsOptions.checkServerIdentity, "options.checkServerIdentity");
    this._ensureTls().checkServerIdentity = mergedTlsOptions.checkServerIdentity;
  }
  this[kPath] = options.path || "/";
  if (cb) {
    this.once("response", cb);
  }

  $debug(`new ClientRequest: ${this[kMethod]} ${this[kProtocol]}//${this[kHost]}:${this[kPort]}${this[kPath]}`);

  // if (
  //   method === "GET" ||
  //   method === "HEAD" ||
  //   method === "DELETE" ||
  //   method === "OPTIONS" ||
  //   method === "TRACE" ||
  //   method === "CONNECT"
  // ) {
  //   this.useChunkedEncodingByDefault = false;
  // } else {
  //   this.useChunkedEncodingByDefault = true;
  // }

  this.finished = false;
  this[kRes] = null;
  this[kUpgradeOrConnect] = false;
  this[kParser] = null;
  this[kMaxHeadersCount] = null;
  this[kReusedSocket] = false;
  this[kHost] = host;
  this[kProtocol] = protocol;

  if (options.timeout !== undefined) {
    const timeout = getTimerDuration(options.timeout, "timeout");
    this.timeout = timeout;
    this.setTimeout(timeout, undefined);
  }

  const { headers } = options;
  const headersArray = $isJSArray(headers);
  if (headersArray) {
    const length = headers.length;
    if ($isJSArray(headers[0])) {
      // [[key, value], [key, value], ...]
      for (let i = 0; i < length; i++) {
        const actualHeader = headers[i];
        if (actualHeader.length !== 2) {
          throw $ERR_INVALID_ARG_VALUE("options.headers", "expected array of [key, value]");
        }
        const key = actualHeader[0];
        validateHeaderName(key);
        const lowerKey = key?.toLowerCase();
        if (lowerKey === "host") {
          if (!this.getHeader(key)) {
            this.setHeader(key, actualHeader[1]);
          }
        } else {
          this.appendHeader(key, actualHeader[1]);
        }
      }
    } else {
      // [key, value, key, value, ...]
      if (length % 2 !== 0) {
        throw $ERR_INVALID_ARG_VALUE("options.headers", "expected [key, value, key, value, ...]");
      }
      for (let i = 0; i < length; ) {
        this.appendHeader(headers[i++], headers[i++]);
      }
    }
  } else {
    if (headers) {
      for (let key in headers) {
        const value = headers[key];
        if (key === "host" || key === "hostname") {
          if (value !== null && value !== undefined && typeof value !== "string") {
            throw $ERR_INVALID_ARG_TYPE(`options.${key}`, ["string", "undefined", "null"], value);
          }
        }
        this.setHeader(key, value);
      }
    }

    // if (host && !this.getHeader("host") && setHost) {
    //   let hostHeader = host;

    //   // For the Host header, ensure that IPv6 addresses are enclosed
    //   // in square brackets, as defined by URI formatting
    //   // https://tools.ietf.org/html/rfc3986#section-3.2.2
    //   const posColon = StringPrototypeIndexOf.$call(hostHeader, ":");
    //   if (
    //     posColon !== -1 &&
    //     StringPrototypeIncludes.$call(hostHeader, ":", posColon + 1) &&
    //     StringPrototypeCharCodeAt.$call(hostHeader, 0) !== 91 /* '[' */
    //   ) {
    //     hostHeader = `[${hostHeader}]`;
    //   }

    //   if (port && +port !== defaultPort) {
    //     hostHeader += ":" + port;
    //   }
    //   this.setHeader("Host", hostHeader);
    // }

    var auth = options.auth;
    if (auth && !this.getHeader("Authorization")) {
      this.setHeader("Authorization", "Basic " + Buffer.from(auth).toString("base64"));
    }

    //   if (this.getHeader("expect")) {
    //     if (this._header) {
    //       throw new ERR_HTTP_HEADERS_SENT("render");
    //     }

    //     this._storeHeader(
    //       this.method + " " + this.path + " HTTP/1.1\r\n",
    //       this[kOutHeaders],
    //     );
    //   }
    // } else {
    //   this._storeHeader(
    //     this.method + " " + this.path + " HTTP/1.1\r\n",
    //     options.headers,
    //   );
  }

  // this[kUniqueHeaders] = parseUniqueHeadersOption(options.uniqueHeaders);

  const { signal: _signal, ...optsWithoutSignal } = options;
  this[kOptions] = optsWithoutSignal;

  const createConnection = options.createConnection;

  this._httpMessage = this;

  process.nextTick(emitContinueAndSocketNT, this);

  this[kEmitState] = 0;

  this.setSocketKeepAlive = (_enable = true, _initialDelay = 0) => {};

  this.setNoDelay = (_noDelay = true) => {};

  this[kClearTimeout] = () => {
    const timeoutTimer = this[kTimeoutTimer];
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      this[kTimeoutTimer] = undefined;
      this.removeAllListeners("timeout");
    }
  };
}

const ClientRequestPrototype = {
  constructor: ClientRequest,
  __proto__: OutgoingMessage.prototype,

  setTimeout(msecs, callback) {
    if (this.destroyed) {
      return this;
    }

    this.timeout = msecs = getTimerDuration(msecs, "msecs");

    // Attempt to clear an existing timer in both cases -
    //  even if it will be rescheduled we don't want to leak an existing timer.
    clearTimeout(this[kTimeoutTimer]!);

    if (msecs === 0) {
      if (callback !== undefined) {
        validateFunction(callback, "callback");
        this.removeListener("timeout", callback);
      }

      this[kTimeoutTimer] = undefined;
    } else {
      this[kTimeoutTimer] = setTimeout(() => {
        this[kTimeoutTimer] = undefined;
        this[kAbortController]?.abort();
        this.emit("timeout");
      }, msecs).unref();

      if (callback !== undefined) {
        validateFunction(callback, "callback");
        this.once("timeout", callback);
      }
    }

    return this;
  },

  clearTimeout(cb) {
    this.setTimeout(0, cb);
  },

  get path() {
    return this[kPath];
  },

  get port() {
    return this[kPort];
  },

  get method() {
    return this[kMethod];
  },

  get host() {
    return this[kHost];
  },

  get protocol() {
    return this[kProtocol];
  },

  get agent() {
    return this[kAgent];
  },

  set agent(value) {
    this[kAgent] = value;
  },

  get aborted() {
    return this[abortedSymbol] || this[kSignal]?.aborted || !!this[kAbortController]?.signal.aborted;
  },

  set aborted(value) {
    this[abortedSymbol] = value;
  },

  get writable() {
    return true;
  },
};

ClientRequest.prototype = ClientRequestPrototype;
$setPrototypeDirect.$call(ClientRequest, OutgoingMessage);

function validateHost(host, name) {
  if (host !== null && host !== undefined && typeof host !== "string") {
    throw $ERR_INVALID_ARG_TYPE(`options.${name}`, ["string", "undefined", "null"], host);
  }
  return host;
}

function emitContinueAndSocketNT(self) {
  if (self.destroyed) return;
  // Ref: https://github.com/nodejs/node/blob/f63e8b7fa7a4b5e041ddec67307609ec8837154f/lib/_http_client.js#L803-L839
  if (!(self[kEmitState] & (1 << ClientRequestEmitState.socket))) {
    self[kEmitState] |= 1 << ClientRequestEmitState.socket;
    self.emit("socket", self.socket);
  }

  // Emit continue event for the client (internally we auto handle it)
  if (!self._closed && self.getHeader("expect") === "100-continue") {
    self.emit("continue");
  }
}

function emitAbortNextTick(self) {
  self.emit("abort");
}

const kResTimeoutTimer = Symbol("kResTimeoutTimer");

function onClientResponseTimeout(res) {
  res[kResTimeoutTimer] = undefined;
  if (res.complete) {
    return;
  }
  res.emit("timeout");
}

// Assigned as res.setTimeout on client-side IncomingMessage instances. Kept at
// module scope so it doesn't close over ClientRequest locals and keep them
// alive for the lifetime of the response.
function clientResponseSetTimeout(msecs, callback) {
  if (callback) {
    this.on("timeout", callback);
  }
  const existing = this[kResTimeoutTimer];
  if (existing) {
    clearTimeout(existing);
    this[kResTimeoutTimer] = undefined;
  }
  if (msecs > 0) {
    // Use an unref'd timer so an idle response timeout does not keep the
    // event loop alive (matches Node's socket.setTimeout semantics).
    this[kResTimeoutTimer] = setTimeout(onClientResponseTimeout, msecs, this).unref();
  }
  return this;
}

export default {
  ClientRequest,
  kBodyChunks,
  abortedSymbol,
};
