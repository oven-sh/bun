const { isIP, isIPv6 } = require("internal/net/isIP");

const {
  checkIsHttpToken,
  validateFunction,
  validateInteger,
  validateBoolean,
  validateString,
  validatePort,
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
} = require("internal/http");

const { globalAgent } = require("node:_http_agent");
const { IncomingMessage } = require("node:_http_incoming");
const { OutgoingMessage } = require("node:_http_outgoing");

const { getLazy } = require("internal/shared");
const net = getLazy(() => require("node:net"));
const tls = getLazy(() => require("node:tls"));
const { getMaxHTTPHeaderSize, statusCodeSymbol, statusMessageSymbol, noBodySymbol } = require("internal/http");

const globalReportError = globalThis.reportError;
const setTimeout = globalThis.setTimeout;
const INVALID_PATH_REGEX = /[^\u0021-\u00ff]/;
const INVALID_HOST_CHAR_REGEX = /[/\\?#@\t\n\r]/;
const CONNECT_STATUS_LINE_REGEX = /^HTTP\/(\d)\.(\d) (\d{3})(?: (.*))?$/;
const kEmptyBuffer = Buffer.alloc(0);
// Headers Node's IncomingMessage._addHeaderLine treats as singletons: the first
// occurrence wins and later duplicates are discarded (set-cookie is handled
// separately as an array). Used when folding parsed CONNECT response headers.
const kConnectSingletonHeaders = new Set([
  "age",
  "authorization",
  "content-length",
  "content-type",
  "etag",
  "expires",
  "from",
  "host",
  "if-modified-since",
  "if-unmodified-since",
  "last-modified",
  "location",
  "max-forwards",
  "proxy-authorization",
  "referer",
  "retry-after",
  "server",
  "user-agent",
]);

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

  // Node sends headers + first chunk immediately on the first write(). We
  // defer by a tick so that `write(chunk); end();` in the same tick still
  // takes the non-duplex fast path via send(). If end() hasn't been called by
  // then, start the request in duplex mode so the server can respond while
  // the body stream stays open (docker-modem relies on this for
  // `container.exec` with stdin: true).
  function startFetchAfterFirstWriteNT(self) {
    if (!fetching && !self.destroyed && !self.finished) {
      startFetch();
    }
  }

  const pushChunk = chunk => {
    this[kBodyChunks].push(chunk);
    if (writeCount > 1) {
      startFetch();
    } else if (writeCount === 1) {
      process.nextTick(startFetchAfterFirstWriteNT, this);
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

  const startFetch = (customBody?) => {
    if (fetching) {
      return false;
    }

    // CONNECT tunnels (HTTP proxies) have no representation in fetch(): the
    // request target is a `host:port` authority, not a URL, and the response
    // is a raw socket rather than a message body. Dispatch it over a raw TCP
    // socket instead and emit the 'connect' event, matching Node.
    if (this[kMethod] === "CONNECT") {
      fetching = true;
      startConnect();
      return true;
    }

    fetching = true;

    // Every entry point that dispatches the request (send(), flushHeaders(),
    // and the write() → pushChunk paths) must have an AbortController wired
    // up before the fetch starts so that req.abort()/req.destroy()/timeouts
    // and options.signal can cancel the in-flight request. Centralise that
    // here so new callers cannot forget it.
    if (!this[kAbortController]) {
      this[kAbortController] = new AbortController();
      this[kAbortController].signal.addEventListener("abort", onAbort, { once: true });
    }

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
        const pathname = path.startsWith("/") ? path : "/" + path;
        const url = `${protocol}//${host}${this[kUseDefaultPort] ? "" : ":" + this[kPort]}${pathname}`;
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
                if (self.finished) {
                  maybeEmitClose();
                } else {
                  // Request body is still streaming (duplex); emitting
                  // 'prefinish'/'close' now would fire before 'finish' (or
                  // with no 'finish' at all). Defer until req.end() runs
                  // and send() schedules maybeEmitFinish().
                  deferredRequestClose = true;
                }
                if (res.statusCode === 304) {
                  res.complete = true;
                  // maybeEmitClose() already ran above (finished) or is
                  // deferred via deferredRequestClose (duplex) — no need to
                  // call it again and bypass the self.finished gate.
                  return;
                }
              }
            },
            this,
            res,
          );
        };

        // Emit the response as soon as headers arrive, even when the request
        // body is still being streamed (duplex mode). Node.js emits 'response'
        // independently of whether req.end() has been called.
        handleResponse();

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
            } else if (err.code === "InvalidContentLength") {
              // The native client refuses to deliver a response with a
              // malformed or conflicting Content-Length. Node surfaces this
              // as an llhttp parse error on the request object.
              err = $HPE_UNEXPECTED_CONTENT_LENGTH("Parse Error");
            } else if (err.code === "InvalidHTTPResponse") {
              // Unparseable status line or header structure.
              err = $HPE_INVALID_HEADER_TOKEN("Parse Error: Invalid header token encountered");
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
      if (RegExpPrototypeExec.$call(INVALID_HOST_CHAR_REGEX, host) !== null) {
        const error = new Error(`getaddrinfo ENOTFOUND ${host}`);
        error.name = "DNSException";
        error.code = "ENOTFOUND";
        error.syscall = "getaddrinfo";
        error.hostname = host;
        process.nextTick((self, err) => self.emit("error", err), this, error);
        return false;
      }
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

  // Dispatch a CONNECT request over a raw TCP (or TLS) socket and emit the
  // 'connect' event once the proxy's response status line + headers arrive.
  // This mirrors Node's http.ClientRequest CONNECT handling so HTTP proxy
  // clients (e.g. @grpc/grpc-js proxy support) work.
  const startConnect = () => {
    if (!this[kAbortController]) {
      this[kAbortController] = new AbortController();
      this[kAbortController].signal.addEventListener("abort", onAbort, { once: true });
    }

    this[kUpgradeOrConnect] = true;

    let keepalive = true;
    const agentKeepalive = this[kAgent]?.keepAlive;
    if (agentKeepalive !== undefined) {
      keepalive = agentKeepalive;
    }

    const connectOptions: any = {
      signal: this[kAbortController].signal,
    };
    const socketPath = this[kSocketPath];
    if (socketPath) {
      connectOptions.path = socketPath;
    } else {
      connectOptions.host = this[kHost];
      connectOptions.port = this[kPort];
      // Forward the socket-level options Node honors when connecting to the
      // proxy authority, so a custom DNS resolver (split-horizon DNS, service
      // discovery) and address selection work the same as the normal path.
      // net.connect() implements the resolution itself, so no manual loop.
      if (options.lookup !== undefined) connectOptions.lookup = options.lookup;
      if (options.family !== undefined) connectOptions.family = options.family;
      if (options.hints !== undefined) connectOptions.hints = options.hints;
      if (options.localAddress !== undefined) connectOptions.localAddress = options.localAddress;
      if (options.localPort !== undefined) connectOptions.localPort = options.localPort;
    }

    const isTLS = this[kProtocol] === "https:";
    if (isTLS && this[kTls]) {
      ObjectAssign(connectOptions, this[kTls]);
      connectOptions.servername = this[kTls].servername;
    }

    let socket;
    try {
      socket = isTLS ? tls().connect(connectOptions) : net().connect(connectOptions);
    } catch (err) {
      fetching = false;
      process.nextTick((self, err) => self.emit("error", err), this, err);
      // Keep this terminal path consistent with onError below: emit 'close'
      // after 'error' so a req.on('close') cleanup listener still runs.
      maybeEmitClose();
      return;
    }

    this.socket = socket;

    // Default Host/Connection headers, matching Node. A CONNECT request with no
    // Host header is rejected by many proxies (and by Bun's own server parser),
    // so add one pointing at the proxy authority unless the caller set it.
    if (!this.hasHeader("host") && !socketPath) {
      let hostHeader = this[kHost];
      if (isIPv6(hostHeader)) {
        hostHeader = `[${hostHeader}]`;
      }
      if (!this[kUseDefaultPort]) {
        hostHeader += ":" + this[kPort];
      }
      this.setHeader("Host", hostHeader);
    }
    if (!this.hasHeader("connection")) {
      this.setHeader("Connection", keepalive ? "keep-alive" : "close");
    }

    // Write the CONNECT request line + headers. The request target is the
    // `host:port` authority from options.path, not a URL path, so it must be
    // written verbatim (no leading slash). Use the raw (original-case) header
    // names so the wire bytes match what the caller set, like Node.
    const headerLines = [`CONNECT ${this[kPath]} HTTP/1.1`];
    const rawNames = this.getRawHeaderNames();
    for (let i = 0; i < rawNames.length; i++) {
      const name = rawNames[i];
      const value = this.getHeader(name);
      if (value === undefined) continue;
      if ($isJSArray(value)) {
        for (let j = 0; j < value.length; j++) {
          headerLines.push(`${name}: ${value[j]}`);
        }
      } else {
        headerLines.push(`${name}: ${value}`);
      }
    }
    const requestHead = headerLines.join("\r\n") + "\r\n\r\n";

    let connected = false;
    let buffer: Buffer | null = null;
    const maxHeaderSize = this[kMaxHeaderSize] || getMaxHTTPHeaderSize();

    const swallowTeardownError = () => {};

    const onError = err => {
      if (connected) return;
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
      // Keep swallowTeardownError attached here: on a pre-tunnel failure/abort
      // the AbortController can still emit an AbortError on the socket after
      // this runs, and it must not surface as an unhandled 'error'.
      this[kClearTimeout]?.();
      // Abort/destroy is handled by onAbort → socketCloseListener, which emits
      // 'close' and also synthesizes a socket 'close' that lands here; don't
      // surface a spurious 'error' for a user-initiated teardown (Node doesn't).
      if (isAbortError(err) || this.destroyed || this[abortedSymbol]) return;
      // net/tls already produce a Node-shaped error (code/syscall/address/port),
      // so propagate it verbatim like Node rather than flattening it.
      fetching = false;
      try {
        this.emit("error", err);
      } catch {}
      // The request is done: emit 'close' like Node does after a failed request.
      maybeEmitClose();
    };

    const onClose = () => {
      if (connected) return;
      onError(new ConnResetException("socket hang up"));
    };

    const onData = chunk => {
      buffer = buffer ? Buffer.concat([buffer, chunk]) : chunk;

      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        if (buffer.length > maxHeaderSize) {
          socket.destroy();
          onError($HPE_HEADER_OVERFLOW("Header overflow"));
        }
        return;
      }
      // Reject an oversized header block even when it arrives complete (with its
      // terminator) in a single read, so maxHeaderSize is honored the way Node's
      // llhttp counts header bytes regardless of where \r\n\r\n lands.
      if (headerEnd > maxHeaderSize) {
        socket.destroy();
        onError($HPE_HEADER_OVERFLOW("Header overflow"));
        return;
      }

      const headerText = buffer.toString("latin1", 0, headerEnd);

      const lines = headerText.split("\r\n");
      const statusLine = lines.shift() || "";
      // "HTTP/1.1 200 Connection established"
      const statusMatch = RegExpPrototypeExec.$call(CONNECT_STATUS_LINE_REGEX, statusLine);
      if (!statusMatch) {
        // A proxy that answers with an unparseable status line isn't a tunnel;
        // fail the request instead of emitting 'connect' with no statusCode.
        // onError runs before `connected` flips, so it still fires.
        socket.destroy();
        onError($HPE_INVALID_HEADER_TOKEN("Parse Error: Invalid header token encountered"));
        return;
      }

      connected = true;
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
      // Hand the tunnel socket to the user with no internal listeners, like Node.
      socket.removeListener("error", swallowTeardownError);
      this[kClearTimeout]?.();
      fetching = false;

      const head = headerEnd + 4 < buffer.length ? buffer.subarray(headerEnd + 4) : kEmptyBuffer;
      buffer = null;

      const res = new IncomingMessage(null, kEmptyObject);
      res.httpVersion = `${statusMatch[1]}.${statusMatch[2]}`;
      res[statusCodeSymbol] = Number(statusMatch[3]);
      // Deliver the reason phrase verbatim, "" when omitted, matching llhttp/Node.
      res[statusMessageSymbol] = statusMatch[4] ?? "";

      const rawHeaders: string[] = [];
      // Null prototype so a proxy header literally named "constructor"/"__proto__"
      // folds against an absent own property instead of an inherited one.
      const parsedHeaders: Record<string, string | string[]> = { __proto__: null } as any;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const colon = line.indexOf(":");
        if (colon === -1) continue;
        const key = line.slice(0, colon);
        // Strip OWS = *(SP / HTAB) on both sides of the value, matching llhttp
        // (RFC 7230 §3.2.4), so padded proxy headers parse like they do in Node.
        let start = colon + 1;
        let end = line.length;
        while (start < end && (line.charCodeAt(start) === 32 || line.charCodeAt(start) === 9)) start++;
        while (end > start && (line.charCodeAt(end - 1) === 32 || line.charCodeAt(end - 1) === 9)) end--;
        const val = line.slice(start, end);
        $putByValDirect(rawHeaders, rawHeaders.length, key);
        $putByValDirect(rawHeaders, rawHeaders.length, val);
        // Fold into headers with Node's _addHeaderLine rules: set-cookie is
        // always an array, singleton headers keep the first value, everything
        // else is comma-joined.
        const lowerKey = key.toLowerCase();
        const existing = parsedHeaders[lowerKey];
        if (lowerKey === "set-cookie") {
          if (existing === undefined) parsedHeaders[lowerKey] = [val];
          else (existing as string[]).push(val);
        } else if (existing === undefined) {
          parsedHeaders[lowerKey] = val;
        } else if (!kConnectSingletonHeaders.has(lowerKey)) {
          parsedHeaders[lowerKey] = `${existing}, ${val}`;
        }
      }
      res.headers = parsedHeaders;
      res.rawHeaders = rawHeaders;
      // The CONNECT response has no body; mark it complete so reads emit EOF
      // instead of touching the (absent) fetch Response backing store.
      res[noBodySymbol] = true;
      res.complete = true;
      res.push(null);

      // Point res.socket at the real tunnel socket and back-reference the
      // response from the request, matching Node (res.socket === socket,
      // req.res === res, res.upgrade === true). Node leaves res.req undefined
      // for CONNECT, so we do too.
      res.upgrade = true;
      res.socket = socket;
      this.res = res;

      // The request is finished from the writable side's perspective.
      if (!this.finished) {
        this.finished = true;
      }
      process.nextTick(emitFinishAndDeferredCloseNT);

      // Once the tunnel socket goes away, the request is done too: emit 'close'
      // on the ClientRequest the way Node does when the CONNECT socket closes.
      socket.once("close", () => {
        maybeEmitClose();
      });

      if (this.listenerCount("connect") > 0) {
        this.emit("connect", res, socket, head);
      } else {
        // Node destroys the socket when nobody is listening for 'connect'.
        socket.destroy();
      }
    };

    // Swallow a late error that fires during pre-tunnel teardown (e.g. the
    // AbortController's AbortError when the request is aborted/destroyed before
    // the tunnel is established) so it doesn't surface as an unhandled 'error'.
    // Removed once the tunnel is handed to the user so the socket is delivered
    // with no internal listeners, like Node.
    socket.on("error", swallowTeardownError);
    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);

    const writeHead = () => {
      socket.write(requestHead);
    };
    if (socket.connecting) {
      socket.once(isTLS ? "secureConnect" : "connect", writeHead);
    } else {
      writeHead();
    }

    return true;
  };

  let onEnd = () => {};
  let handleResponse: (() => void) | undefined = () => {};
  // Set once handleResponse()'s nextTick has run and found the writable side
  // still open; send() uses this to emit 'close' in the correct order after
  // 'finish' once req.end() is eventually called.
  let deferredRequestClose = false;

  function emitFinishAndDeferredCloseNT() {
    maybeEmitFinish();
    if (deferredRequestClose) {
      deferredRequestClose = false;
      maybeEmitClose();
    }
  }

  const send = () => {
    this.finished = true;

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
      process.nextTick(emitFinishAndDeferredCloseNT);
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
  if (typeof port !== "number" && typeof port !== "string") {
    throw $ERR_INVALID_ARG_TYPE("options.port", ["number", "string"], port);
  }
  validatePort(port);
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
