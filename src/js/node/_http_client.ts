const { isIP, isIPv6 } = require("node:net");

const { checkIsHttpToken, validateFunction, validateInteger, validateBoolean } = require("internal/validators");
const { urlToHttpOptions } = require("internal/url");
const { isValidTLSArray } = require("internal/tls");
const { validateHeaderName } = require("node:_http_common");
const { getTimerDuration } = require("internal/timers");
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
  ConnResetException,
} = require("internal/http");

const { Agent, NODE_HTTP_WARNING } = require("node:_http_agent");
const { IncomingMessage } = require("node:_http_incoming");
const { OutgoingMessage } = require("node:_http_outgoing");
const { freeParser, parsers, HTTPParser, isLenient, prepareError } = require("node:_http_common");

const globalReportError = globalThis.reportError;
const setTimeout = globalThis.setTimeout;
const INVALID_PATH_REGEX = /[^\u0021-\u00ff]/;
const fetch = Bun.fetch;

const { URL } = globalThis;

// HTTP parser constants for lenient parsing
const kLenientNone = 0;
const kLenientHeaders = 1 << 0;
const kLenientChunkedLength = 1 << 1;
const kLenientTransferEncoding = 1 << 2;
const kLenientVersion = 1 << 3;
const kLenientDataAfterClose = 1 << 4;
const kLenientOptionalLFAfterCR = 1 << 5;
const kLenientOptionalCRLFAfterChunk = 1 << 6;
const kLenientOptionalCRBeforeLF = 1 << 7;
const kLenientSpacesAfterChunkSize = 1 << 8;

const kLenientAll =
  kLenientHeaders |
  kLenientChunkedLength |
  kLenientTransferEncoding |
  kLenientVersion |
  kLenientDataAfterClose |
  kLenientOptionalLFAfterCR |
  kLenientOptionalCRLFAfterChunk |
  kLenientOptionalCRBeforeLF |
  kLenientSpacesAfterChunkSize;

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

function statusIsInformational(status) {
  return status >= 100 && status < 200;
}

// Parser callback for handling incoming responses (from Node.js implementation)
function parserOnIncomingClient(res, shouldKeepAlive) {
  const socket = this.socket;
  const req = socket._httpMessage;

  if (req.res) {
    // We already have a response object, something is wrong
    socket.destroy();
    return 0;
  }
  req.res = res;

  // Handle upgrade responses
  if (res.upgrade) {
    return 2; // Skip body and treat as Upgrade
  }

  // Handle CONNECT method responses
  if (req.method === "CONNECT") {
    res.upgrade = true;
    return 2; // Skip body and treat as Upgrade
  }

  // Handle informational responses (1xx status codes)
  if (statusIsInformational(res.statusCode)) {
    req.res = null; // Clear res so we can handle the final response
    if (res.statusCode === 100) {
      req.emit("continue");
    }
    req.emit("information", {
      statusCode: res.statusCode,
      statusMessage: res.statusMessage,
      httpVersion: res.httpVersion,
      httpVersionMajor: res.httpVersionMajor,
      httpVersionMinor: res.httpVersionMinor,
      headers: res.headers,
      rawHeaders: res.rawHeaders,
    });
    return 1; // Skip body but don't treat as Upgrade
  }

  return 0; // No special treatment
}

// Socket event handlers (from Node.js implementation)
function socketOnData(d) {
  const socket = this;
  const req = socket._httpMessage;
  const parser = socket.parser;

  if (!parser) return;

  const ret = parser.execute(d);
  if (ret instanceof Error) {
    prepareError(ret, parser, d);
    freeParser(parser, req, socket);
    socket.destroy();
    return;
  }

  // Handle upgrades/CONNECT
  if (parser.incoming && parser.incoming.upgrade) {
    return;
  }
}

function socketOnEnd() {
  const socket = this;
  const req = socket._httpMessage;
  const parser = socket.parser;

  if (!req.res && !req.socket._hadError) {
    req.socket._hadError = true;
    emitErrorEventNT(req, new ConnResetException("socket hang up"));
  }
  if (parser) {
    parser.finish();
    freeParser(parser, req, socket);
  }
  socket.destroy();
}

function socketOnError(err) {
  const socket = this;
  const req = socket._httpMessage;

  if (req) {
    req.emit("error", err);
  }
}

function socketOnClose() {
  const socket = this;
  const req = socket._httpMessage;
  const parser = socket.parser;

  if (parser) {
    freeParser(parser, req, socket);
  }

  if (req) {
    if (!req.res || !req.res.complete) {
      req.emit("error", new ConnResetException("socket hang up"));
    }
    req.emit("close");
  }
}

// Initialize parser on socket connection (from Node.js implementation)
function tickOnSocket(req, socket) {
  const parser = parsers.alloc();
  const lenient = req.insecureHTTPParser === undefined ? isLenient() : req.insecureHTTPParser;

  // Initialize parser for response parsing
  parser.initialize(
    HTTPParser.RESPONSE,
    undefined, // asyncResource - not implemented
    req.maxHeaderSize || 0,
    lenient ? kLenientAll : kLenientNone,
  );

  parser.socket = socket;
  parser.outgoing = req;
  req.parser = parser;
  socket.parser = parser;
  socket._httpMessage = req;

  if (typeof req.maxHeadersCount === "number") {
    parser.maxHeaderPairs = req.maxHeadersCount << 1;
  }
  parser.joinDuplicateHeaders = req.joinDuplicateHeaders;
  parser.onIncoming = parserOnIncomingClient;

  // Set up socket event handlers
  socket.on("data", socketOnData);
  socket.on("end", socketOnEnd);
  socket.on("error", socketOnError);
  socket.on("close", socketOnClose);

  // Emit socket event
  process.nextTick(() => {
    req.emit("socket", socket);
  });
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
      connectToServer().catch(err => {
        this.emit("error", err);
      });
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
      connectToServer().catch(err => {
        this.emit("error", err);
      });
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
    if (!this[abortedSymbol]) {
      process.nextTick(emitAbortNextTick, this);
      this[abortedSymbol] = true;
    }
  };

  let fetching = false;

  const connectToServer = async () => {
    if (fetching) {
      return false;
    }

    fetching = true;

    const method = this[kMethod];
    const protocol = this[kProtocol];
    const path = this[kPath];
    const host = this[kHost];
    const port = this[kPort];
    const socketPath = this[kSocketPath];

    // Create connection options for Bun.connect()
    let connectionOptions;
    if (socketPath) {
      connectionOptions = { unix: socketPath };
    } else {
      connectionOptions = {
        hostname: host,
        port: port,
      };

      // Add TLS options for HTTPS
      if (protocol === "https:" && this[kTls]) {
        connectionOptions.tls = { ...this[kTls], serverName: this[kTls].servername };
      }
    }

    // Use Bun.connect() to create a real TCP socket
    try {
      const socket = await Bun.connect({
        ...connectionOptions,
        socket: {
          open: socket => {
            // Initialize the HTTP parser
            tickOnSocket(this, socket);

            // Send the HTTP request
            const requestLine = `${method} ${path} HTTP/1.1\r\n`;
            const headers = this.getHeaders();
            let headerString = "";

            for (const [key, value] of Object.entries(headers)) {
              headerString += `${key}: ${value}\r\n`;
            }

            // Add Host header if not present
            if (!this.hasHeader("Host")) {
              headerString += `Host: ${host}${port !== 80 && port !== 443 ? `:${port}` : ""}\r\n`;
            }

            headerString += "\r\n";

            const requestHeader = requestLine + headerString;
            socket.write(requestHeader);

            // Send request body if present
            if (this[kBodyChunks] && this[kBodyChunks].length > 0) {
              for (const chunk of this[kBodyChunks]) {
                socket.write(chunk);
              }
            }

            // Store socket reference
            this.socket = socket;
            socket._httpMessage = this;
          },

          data: socketOnData,
          end: socketOnEnd,
          error: socketOnError,
          close: socketOnClose,
        },
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

    connectToServer()
      .catch(err => {
        if (!!$debug) globalReportError(err);
        this.emit("error", err);
      })
      .finally(() => {
        process.nextTick(maybeEmitFinish.bind(this));
      });
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
  const defaultAgent = options._defaultAgent || Agent.globalAgent;
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

  if (options.rejectUnauthorized !== undefined) this._ensureTls().rejectUnauthorized = options.rejectUnauthorized;
  else {
    let agentRejectUnauthorized = agent?.options?.rejectUnauthorized;
    if (agentRejectUnauthorized !== undefined) this._ensureTls().rejectUnauthorized = agentRejectUnauthorized;
    else {
      // popular https-proxy-agent uses connectOpts
      agentRejectUnauthorized = agent?.connectOpts?.rejectUnauthorized;
      if (agentRejectUnauthorized !== undefined) this._ensureTls().rejectUnauthorized = agentRejectUnauthorized;
    }
  }
  if (options.ca) {
    if (!isValidTLSArray(options.ca))
      throw new TypeError(
        "ca argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
      );
    this._ensureTls().ca = options.ca;
  }
  if (options.cert) {
    if (!isValidTLSArray(options.cert))
      throw new TypeError(
        "cert argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
      );
    this._ensureTls().cert = options.cert;
  }
  if (options.key) {
    if (!isValidTLSArray(options.key))
      throw new TypeError(
        "key argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile",
      );
    this._ensureTls().key = options.key;
  }
  if (options.passphrase) {
    if (typeof options.passphrase !== "string") throw new TypeError("passphrase argument must be a string");
    this._ensureTls().passphrase = options.passphrase;
  }
  if (options.ciphers) {
    if (typeof options.ciphers !== "string") throw new TypeError("ciphers argument must be a string");
    this._ensureTls().ciphers = options.ciphers;
  }
  if (options.servername) {
    if (typeof options.servername !== "string") throw new TypeError("servername argument must be a string");
    this._ensureTls().servername = options.servername;
  }

  if (options.secureOptions) {
    if (typeof options.secureOptions !== "number") throw new TypeError("secureOptions argument must be a string");
    this._ensureTls().secureOptions = options.secureOptions;
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

  this.setSocketKeepAlive = (_enable = true, _initialDelay = 0) => {
    $debug(`${NODE_HTTP_WARNING}\n`, "WARN: ClientRequest.setSocketKeepAlive is a no-op");
  };

  this.setNoDelay = (_noDelay = true) => {
    $debug(`${NODE_HTTP_WARNING}\n`, "WARN: ClientRequest.setNoDelay is a no-op");
  };

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

export default {
  ClientRequest,
  kBodyChunks,
  abortedSymbol,
};
