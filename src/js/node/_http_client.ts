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
} = require("internal/http");

const { globalAgent } = require("node:_http_agent");
const { IncomingMessage } = require("node:_http_incoming");
const { OutgoingMessage } = require("node:_http_outgoing");

// Symbols for internal state (closure variable replacements)
const kFetching = Symbol("fetching");
const kWriteCount = Symbol("writeCount");
const kResolveNextChunk = Symbol("resolveNextChunk");
const kHandleResponse = Symbol("handleResponse");
const kOnEnd = Symbol("onEnd");

// Symbols for internal prototype methods (non-observable)
const kWriteInternal = Symbol("writeInternal");
const kPushChunk = Symbol("pushChunk");
const kEnsureTls = Symbol("ensureTls");
const kSocketCloseListener = Symbol("socketCloseListener");
const kOnAbort = Symbol("onAbort");
const kMaybeEmitSocket = Symbol("maybeEmitSocket");
const kMaybeEmitPrefinish = Symbol("maybeEmitPrefinish");
const kMaybeEmitFinish = Symbol("maybeEmitFinish");
const kMaybeEmitClose = Symbol("maybeEmitClose");
const kSend = Symbol("send");
const kStartFetch = Symbol("startFetch");
const kDoFetch = Symbol("doFetch");
const kKeepOpen = Symbol("keepOpen");
const kResponse = Symbol("response");
const kResTimer = Symbol("resTimer");

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

function emitAbortNextTick(self) {
  self.emit("abort");
}

// Module-scope helper: builds URL and proxy from host for a given request
function getURL(self, host) {
  if (isIPv6(host)) {
    host = `[${host}]`;
  }

  const protocol = self[kProtocol];
  const path = self[kPath];

  if (path.startsWith("http://") || path.startsWith("https://")) {
    return [path, `${protocol}//${host}${self[kUseDefaultPort] ? "" : ":" + self[kPort]}`];
  } else {
    let proxy: string | undefined;
    const url = `${protocol}//${host}${self[kUseDefaultPort] ? "" : ":" + self[kPort]}${path}`;
    // support agent proxy url/string for http/https
    try {
      // getters can throw
      const agentProxy = self[kAgent]?.proxy;
      // this should work for URL like objects and strings
      proxy = agentProxy?.href || agentProxy;
    } catch {}
    return [url, proxy];
  }
}

// Module-scope helper: called from process.nextTick to emit response
function emitResponseNT(self, res, maybeEmitCloseFn) {
  // If the user did not listen for the 'response' event, then they
  // can't possibly read the data, so we ._dump() it into the void
  // so that the socket doesn't hang there in a paused state.
  const contentLength = res.headers["content-length"];
  if (contentLength && isNaN(Number(contentLength))) {
    emitErrorEventNT(self, $HPE_UNEXPECTED_CONTENT_LENGTH("Parse Error"));

    res.complete = true;
    maybeEmitCloseFn.$call(self);
    return;
  }
  try {
    if (self.aborted || !self.emit("response", res)) {
      res._dump();
    }
  } finally {
    maybeEmitCloseFn.$call(self);
    if (res.statusCode === 304) {
      res.complete = true;
      maybeEmitCloseFn.$call(self);
      return;
    }
  }
}

function emitMaybeFinishNT(self) {
  self[kMaybeEmitFinish]();
}

// Module-scope helper for _send's onEnd assignment — avoids creating a closure
function onEndCallHandleResponse() {
  this[kHandleResponse]?.();
}

// Module-scope helper for signal abort — avoids creating a closure
function onSignalAbort() {
  this[kAbortController]?.abort();
}

// Shared no-op function — avoids creating per-instance closures
function noop() {}

function emitErrorNT(self, err) {
  self.emit("error", err);
}

function emitLookupError(self, message, name, code, syscall) {
  const error = new Error(message);
  error.name = name;
  error.code = code;
  error.syscall = syscall;
  if (!!$debug) globalReportError(error);
  process.nextTick(emitErrorNT, self, error);
}

// Module-scope handler for fetch .then() — called with `this` bound to the ClientRequest
function onFetchResponse(response) {
  if (this.aborted) {
    this[kMaybeEmitClose]();
    return;
  }

  this[kResponse] = response;
  this[kHandleResponse] = handleFetchResponse.bind(this);

  if (!this[kKeepOpen]) {
    this[kHandleResponse]();
  }

  this[kOnEnd]();
}

// Module-scope handler for processing a fetch response
function handleFetchResponse() {
  const response = this[kResponse];
  this[kFetchRequest] = null;
  this[kClearTimeout]();
  this[kHandleResponse] = undefined;
  this[kResponse] = undefined;

  const prevIsHTTPS = getIsNextIncomingMessageHTTPS();
  setIsNextIncomingMessageHTTPS(response.url.startsWith("https:"));
  var res = (this.res = new IncomingMessage(response, {
    [typeSymbol]: NodeHTTPIncomingRequestType.FetchResponse,
    [reqSymbol]: this,
  }));
  setIsNextIncomingMessageHTTPS(prevIsHTTPS);
  res.req = this;
  res[kResTimer] = undefined;
  res.setTimeout = resSetTimeout;
  process.nextTick(emitResponseNT, this, res, this[kMaybeEmitClose]);
}

// Module-scope res.setTimeout — avoids per-response closure
function resSetTimeout(msecs, callback) {
  if (this[kResTimer]) {
    clearTimeout(this[kResTimer]);
  }
  this[kResTimer] = setTimeout(resTimeoutFired, msecs, this, callback);
}

function resTimeoutFired(res, callback) {
  res[kResTimer] = undefined;
  if (res.complete) {
    return;
  }
  res.emit("timeout");
  callback?.();
}

// Module-scope handler for fetch .catch()
function onFetchError(err) {
  if (err.code === "ConnectionRefused") {
    err = new Error("ECONNREFUSED");
    err.code = "ECONNREFUSED";
  }
  // Node treats AbortError separately.
  if (isAbortError(err)) {
    return;
  }

  if (!!$debug) globalReportError(err);

  try {
    this.emit("error", err);
  } catch (_err) {
    void _err;
  }
}

// Module-scope handler for fetch .finally()
function onFetchFinally() {
  if (!this[kKeepOpen]) {
    this[kFetching] = false;
    this[kFetchRequest] = null;
    this[kClearTimeout]();
  }
}

// Module-scope handler for prototype setTimeout timer
function onRequestTimeout() {
  this[kTimeoutTimer] = undefined;
  this[kAbortController]?.abort();
  this.emit("timeout");
}

const MAX_FAKE_BACKPRESSURE_SIZE = 1024 * 1024;

function ClientRequest(input, options, cb) {
  if (!(this instanceof ClientRequest)) {
    return new (ClientRequest as any)(input, options, cb);
  }

  // Initialize state that was previously closure variables
  this[kFetching] = false;
  this[kWriteCount] = 0;
  this[kResolveNextChunk] = noop;
  this[kHandleResponse] = noop;
  this[kOnEnd] = noop;

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
  this[kPort] = options.port || defaultPort || 80;
  this[kUseDefaultPort] = this[kPort] === defaultPort;
  const host =
    (this[kHost] =
    options.host =
      validateHost(options.hostname, "hostname") || validateHost(options.host, "host") || "localhost");

  this[kSocketPath] = options.socketPath;

  const signal = options.signal;
  if (signal) {
    //We still want to control abort function and timeout so signal call our AbortController
    signal.addEventListener("abort", onSignalAbort.bind(this), { once: true });
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
    this[kEnsureTls]().rejectUnauthorized = mergedTlsOptions.rejectUnauthorized;
  }
  if (mergedTlsOptions.ca) {
    throwOnInvalidTLSArray("options.ca", mergedTlsOptions.ca);
    this[kEnsureTls]().ca = mergedTlsOptions.ca;
  }
  if (mergedTlsOptions.cert) {
    throwOnInvalidTLSArray("options.cert", mergedTlsOptions.cert);
    this[kEnsureTls]().cert = mergedTlsOptions.cert;
  }
  if (mergedTlsOptions.key) {
    throwOnInvalidTLSArray("options.key", mergedTlsOptions.key);
    this[kEnsureTls]().key = mergedTlsOptions.key;
  }
  if (mergedTlsOptions.passphrase) {
    validateString(mergedTlsOptions.passphrase, "options.passphrase");
    this[kEnsureTls]().passphrase = mergedTlsOptions.passphrase;
  }
  if (mergedTlsOptions.ciphers) {
    validateString(mergedTlsOptions.ciphers, "options.ciphers");
    this[kEnsureTls]().ciphers = mergedTlsOptions.ciphers;
  }
  if (mergedTlsOptions.servername) {
    validateString(mergedTlsOptions.servername, "options.servername");
    this[kEnsureTls]().servername = mergedTlsOptions.servername;
  }
  if (mergedTlsOptions.secureOptions) {
    validateInteger(mergedTlsOptions.secureOptions, "options.secureOptions");
    this[kEnsureTls]().secureOptions = mergedTlsOptions.secureOptions;
  }
  this[kPath] = options.path || "/";
  if (cb) {
    this.once("response", cb);
  }

  $debug(`new ClientRequest: ${this[kMethod]} ${this[kProtocol]}//${this[kHost]}:${this[kPort]}${this[kPath]}`);

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

    var auth = options.auth;
    if (auth && !this.getHeader("Authorization")) {
      this.setHeader("Authorization", "Basic " + Buffer.from(auth).toString("base64"));
    }
  }

  // this[kUniqueHeaders] = parseUniqueHeadersOption(options.uniqueHeaders);

  const { signal: _signal, ...optsWithoutSignal } = options;
  this[kOptions] = optsWithoutSignal;

  this._httpMessage = this;

  process.nextTick(emitContinueAndSocketNT, this);

  this[kEmitState] = 0;
}

const ClientRequestPrototype = {
  constructor: ClientRequest,
  __proto__: OutgoingMessage.prototype,

  write(chunk, encoding, callback) {
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

    return this[kWriteInternal](chunk, encoding, callback);
  },

  [kWriteInternal](chunk, encoding, callback) {
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
    this[kWriteCount]++;

    if (!this[kBodyChunks]) {
      this[kBodyChunks] = [];
      this[kPushChunk](chunk);

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
    this[kPushChunk](chunk);

    if (callback) callback();
    return bodySize < MAX_FAKE_BACKPRESSURE_SIZE;
  },

  [kPushChunk](chunk) {
    this[kBodyChunks].push(chunk);
    if (this[kWriteCount] > 1) {
      this[kStartFetch]();
    }
    this[kResolveNextChunk]?.(false);
  },

  end(chunk, encoding, callback) {
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

      this[kWriteInternal](chunk, encoding, null);
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
      this[kSend]();
      this[kResolveNextChunk]?.(true);
    }

    return this;
  },

  flushHeaders() {
    if (!this[kFetching]) {
      this[kAbortController] ??= new AbortController();
      this[kAbortController].signal.addEventListener("abort", this[kOnAbort].bind(this), {
        once: true,
      });
      this[kStartFetch]();
    }
  },

  destroy(err?: Error) {
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
  },

  [kEnsureTls]() {
    if (this[kTls] === null) this[kTls] = {};
    return this[kTls];
  },

  [kSocketCloseListener]() {
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
  },

  [kOnAbort](_err?: Error) {
    this[kClearTimeout]?.();
    this[kSocketCloseListener]();
    if (!this[abortedSymbol] && !this?.res?.complete) {
      process.nextTick(emitAbortNextTick, this);
      this[abortedSymbol] = true;
    }
  },

  [kMaybeEmitSocket]() {
    if (this.destroyed) return;
    if (!(this[kEmitState] & (1 << ClientRequestEmitState.socket))) {
      this[kEmitState] |= 1 << ClientRequestEmitState.socket;
      this.emit("socket", this.socket);
    }
  },

  [kMaybeEmitPrefinish]() {
    this[kMaybeEmitSocket]();

    if (!(this[kEmitState] & (1 << ClientRequestEmitState.prefinish))) {
      this[kEmitState] |= 1 << ClientRequestEmitState.prefinish;
      this.emit("prefinish");
    }
  },

  [kMaybeEmitFinish]() {
    this[kMaybeEmitPrefinish]();

    if (!(this[kEmitState] & (1 << ClientRequestEmitState.finish))) {
      this[kEmitState] |= 1 << ClientRequestEmitState.finish;
      this.emit("finish");
    }
  },

  [kMaybeEmitClose]() {
    this[kMaybeEmitPrefinish]();

    if (!this._closed) {
      process.nextTick(emitCloseNTAndComplete, this);
    }
  },

  abort() {
    if (this.aborted) return;
    this[abortedSymbol] = true;
    process.nextTick(emitAbortNextTick, this);
    this[kAbortController]?.abort?.();
    this.destroy();
  },

  [kSend]() {
    this.finished = true;
    this[kAbortController] ??= new AbortController();
    this[kAbortController].signal.addEventListener("abort", this[kOnAbort].bind(this), { once: true });

    var body = this[kBodyChunks] && this[kBodyChunks].length > 1 ? new Blob(this[kBodyChunks]) : this[kBodyChunks]?.[0];

    try {
      this[kStartFetch](body);
      this[kOnEnd] = onEndCallHandleResponse.bind(this);
    } catch (err) {
      if (!!$debug) globalReportError(err);
      this.emit("error", err);
    } finally {
      process.nextTick(emitMaybeFinishNT, this);
    }
  },

  [kStartFetch](customBody?) {
    if (this[kFetching]) {
      return false;
    }

    this[kFetching] = true;

    const method = this[kMethod];

    let keepalive = true;
    const agentKeepalive = this[kAgent]?.keepAlive;
    if (agentKeepalive !== undefined) {
      keepalive = agentKeepalive;
    }

    const host = this[kHost];
    const options = this[kOptions];

    if (isIP(host) || !options.lookup) {
      // Don't need to bother with lookup if it's already an IP address or no lookup function is provided.
      const [url, proxy] = getURL(this, host);
      this[kDoFetch](url, proxy, false, method, keepalive, customBody);
      return true;
    }

    const self = this;

    try {
      options.lookup(host, { all: true }, (err, results) => {
        if (err) {
          if (!!$debug) globalReportError(err);
          process.nextTick(emitErrorNT, self, err);
          return;
        }

        let candidates = results.sort((a, b) => b.family - a.family); // prefer IPv6

        if (candidates.length === 0) {
          emitLookupError(self, "No records found", "DNSException", "ENOTFOUND", "getaddrinfo");
          return;
        }

        const port = self[kPort];
        if (!self.hasHeader("Host")) {
          self.setHeader("Host", `${host}:${port}`);
        }

        // We want to try all possible addresses, beginning with the IPv6 ones, until one succeeds.
        // All addresses except for the last are allowed to "soft fail" -- instead of reporting
        // an error to the user, we'll just skip to the next address.
        // The last address is required to work, and if it fails we'll throw an error.

        const iterate = () => {
          if (candidates.length === 0) {
            // If we get to this point, it means that none of the addresses could be connected to.
            emitLookupError(self, `connect ECONNREFUSED ${host}:${port}`, "Error", "ECONNREFUSED", "connect");
            return;
          }

          const [url, proxy] = getURL(self, candidates.shift().address);
          self[kDoFetch](url, proxy, candidates.length > 0, method, keepalive, customBody).catch(iterate);
        };

        iterate();
      });

      return true;
    } catch (err) {
      if (!!$debug) globalReportError(err);
      process.nextTick(emitErrorNT, this, err);
      return false;
    }
  },

  [kDoFetch](url, proxy, softFail, method, keepalive, customBody) {
    const protocol = this[kProtocol];
    const tls = protocol === "https:" && this[kTls] ? { ...this[kTls], serverName: this[kTls].servername } : undefined;

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
    // no body and not finished
    const isDuplex = customBody === undefined && !this.finished;

    this[kKeepOpen] = false;
    if (isDuplex) {
      fetchOptions.duplex = "half";
      this[kKeepOpen] = true;
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
      // Async generators have their own `this`, so capture self here
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
            self[kResolveNextChunk] = end => {
              self[kResolveNextChunk] = undefined;
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

        self[kHandleResponse]?.();
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
    this[kFetchRequest] = nodeHttpClient(url, fetchOptions).then(onFetchResponse.bind(this));

    if (!softFail) {
      // Don't emit an error if we're iterating over multiple possible addresses and we haven't reached the end yet.
      // This is for the happy eyeballs implementation.
      this[kFetchRequest].catch(onFetchError.bind(this)).finally(onFetchFinally.bind(this));
    }

    return this[kFetchRequest];
  },

  setSocketKeepAlive(_enable = true, _initialDelay = 0) {},

  setNoDelay(_noDelay = true) {},

  [kClearTimeout]() {
    const timeoutTimer = this[kTimeoutTimer];
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      this[kTimeoutTimer] = undefined;
      this.removeAllListeners("timeout");
    }
  },

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
      this[kTimeoutTimer] = setTimeout(onRequestTimeout.bind(this), msecs).unref();

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

export default {
  ClientRequest,
  kBodyChunks,
  abortedSymbol,
};
