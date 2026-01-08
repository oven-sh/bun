const { isIP, isIPv6 } = require("internal/net/isIP");
const Duplex = require("internal/streams/duplex");

const { checkIsHttpToken, validateFunction, validateInteger, validateBoolean } = require("internal/validators");
const { urlToHttpOptions } = require("internal/url");
const { isValidTLSArray } = require("internal/tls");
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
  kEmptyBuffer,
  kWriteCount,
  kResolveNextChunk,
  kFetching,
  kOnEnd,
  kHandleResponse,
} = require("internal/http");

const { globalAgent } = require("node:_http_agent");
const { IncomingMessage } = require("node:_http_incoming");
const { OutgoingMessage } = require("node:_http_outgoing");

const globalReportError = globalThis.reportError;
const setTimeout = globalThis.setTimeout;
const INVALID_PATH_REGEX = /[^\u0021-\u00ff]/;
const fetch = Bun.fetch;

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

// Module-scope no-ops for initial state
function noopResolveNextChunk(_end: boolean) {}
function noopCallback() {}

// Module-scope emit helper functions
function maybeEmitSocketClientRequest(self) {
  if (self.destroyed) return;
  if (!(self[kEmitState] & (1 << ClientRequestEmitState.socket))) {
    self[kEmitState] |= 1 << ClientRequestEmitState.socket;
    self.emit("socket", self.socket);
  }
}

function maybeEmitPrefinishClientRequest(self) {
  maybeEmitSocketClientRequest(self);

  if (!(self[kEmitState] & (1 << ClientRequestEmitState.prefinish))) {
    self[kEmitState] |= 1 << ClientRequestEmitState.prefinish;
    self.emit("prefinish");
  }
}

function maybeEmitFinishClientRequest(self) {
  maybeEmitPrefinishClientRequest(self);

  if (!(self[kEmitState] & (1 << ClientRequestEmitState.finish))) {
    self[kEmitState] |= 1 << ClientRequestEmitState.finish;
    self.emit("finish");
  }
}

function maybeEmitCloseClientRequest(self) {
  maybeEmitPrefinishClientRequest(self);

  if (!self._closed) {
    process.nextTick(emitCloseNTAndComplete, self);
  }
}

// Module-scope event handlers
function socketCloseListenerClientRequest(self) {
  self.destroyed = true;

  const res = self.res;
  if (res) {
    // Socket closed before we emitted 'end' below.
    if (!res.complete) {
      res.destroy(new ConnResetException("aborted"));
    }
    if (!self._closed) {
      self._closed = true;
      callCloseCallback(self);
      self.emit("close");
      self.socket?.emit?.("close");
    }
    if (!res.aborted && res.readable) {
      res.push(null);
    }
  } else if (!self._closed) {
    self._closed = true;
    callCloseCallback(self);
    self.emit("close");
    self.socket?.emit?.("close");
  }
}

function onAbortClientRequest(self, _err?: Error) {
  self[kClearTimeout]?.();
  socketCloseListenerClientRequest(self);
  if (!self[abortedSymbol] && !self?.res?.complete) {
    process.nextTick(emitAbortNextTick, self);
    self[abortedSymbol] = true;
  }
}

// Module-scope write functions
function pushChunkClientRequest(self, chunk) {
  self[kBodyChunks].push(chunk);
  if (self[kWriteCount] > 1) {
    startFetchClientRequest(self);
  }
  self[kResolveNextChunk]?.(false);
}

function writeInternalClientRequest(self, chunk, encoding, callback) {
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
  self[kWriteCount]++;

  if (!self[kBodyChunks]) {
    self[kBodyChunks] = [];
    pushChunkClientRequest(self, chunk);

    if (callback) callback();
    return true;
  }

  // Signal fake backpressure if the body size is > 1024 * 1024
  // So that code which loops forever until backpressure is signaled
  // will eventually exit.

  for (let chunk of self[kBodyChunks]) {
    bodySize += chunk.length;
    if (bodySize >= MAX_FAKE_BACKPRESSURE_SIZE) {
      break;
    }
  }
  pushChunkClientRequest(self, chunk);

  if (callback) callback();
  return bodySize < MAX_FAKE_BACKPRESSURE_SIZE;
}

function writeClientRequest(self, chunk, encoding, callback) {
  if (self.destroyed) return false;
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

  return writeInternalClientRequest(self, chunk, encoding, callback);
}

function endClientRequest(self, chunk, encoding, callback) {
  OutgoingMessage.prototype.end.$call(self, chunk, encoding, callback);

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
    if (self.finished) {
      emitErrorNextTickIfErrorListenerNT(self, $ERR_STREAM_WRITE_AFTER_END(), callback);
      return self;
    }

    writeInternalClientRequest(self, chunk, encoding, null);
  } else if (self.finished) {
    if (callback) {
      if (!self.writableFinished) {
        self.on("finish", callback);
      } else {
        callback($ERR_STREAM_ALREADY_FINISHED("end"));
      }
    }
  }

  if (callback) {
    self.once("finish", callback);
  }

  if (!self.finished) {
    sendClientRequest(self);
    self[kResolveNextChunk]?.(true);
  }

  return self;
}

function flushHeadersClientRequest(self) {
  if (!self[kFetching]) {
    self[kAbortController] ??= new AbortController();
    self[kAbortController].signal.addEventListener("abort", onAbortClientRequest.bind(null, self), {
      once: true,
    });
    startFetchClientRequest(self);
  }
}

function destroyClientRequest(self, err?: Error) {
  if (self.destroyed) return self;
  self.destroyed = true;

  const res = self.res;

  // If we're aborting, we don't care about any more response data.
  if (res) {
    res._dump();
  }

  self.finished = true;

  if (self.res && !self.res.complete) {
    self.res.emit("end");
  }

  // If request is destroyed we abort the current response
  self[kAbortController]?.abort?.();
  self.socket.destroy(err);

  return self;
}

function abortClientRequest(self) {
  if (self.aborted) return;
  self[abortedSymbol] = true;
  process.nextTick(emitAbortNextTick, self);
  self[kAbortController]?.abort?.();
  destroyClientRequest(self);
}

function ensureTlsClientRequest(self) {
  if (self[kTls] === null) self[kTls] = {};
  return self[kTls];
}

function signalAbortHandler(self) {
  self[kAbortController]?.abort();
}

function clearTimeoutClientRequest(self) {
  const timeoutTimer = self[kTimeoutTimer];
  if (timeoutTimer) {
    clearTimeout(timeoutTimer);
    self[kTimeoutTimer] = undefined;
    self.removeAllListeners("timeout");
  }
}

function setSocketKeepAliveClientRequest(_enable = true, _initialDelay = 0) {}

function setNoDelayClientRequest(_noDelay = true) {}

// Module-scope send function
function sendClientRequest(self) {
  self.finished = true;
  self[kAbortController] ??= new AbortController();
  self[kAbortController].signal.addEventListener("abort", onAbortClientRequest.bind(null, self), { once: true });

  var body = self[kBodyChunks] && self[kBodyChunks].length > 1 ? new Blob(self[kBodyChunks]) : self[kBodyChunks]?.[0];

  try {
    startFetchClientRequest(self, body);
    self[kOnEnd] = () => {
      self[kHandleResponse]?.();
    };
  } catch (err) {
    if (!!$debug) globalReportError(err);
    self.emit("error", err);
  } finally {
    process.nextTick(maybeEmitFinishClientRequest, self);
  }
}

// Promise executor for body iterator chunk resolution
function resolveNextChunkCallback(self, resolve, end: boolean) {
  self[kResolveNextChunk] = noopResolveNextChunk;
  if (end) {
    resolve(undefined);
  } else {
    resolve(self[kBodyChunks].shift());
  }
}

function setupChunkResolverExecutor(self, resolve) {
  self[kResolveNextChunk] = resolveNextChunkCallback.bind(null, self, resolve);
}

// Module-scope async body generator
async function* bodyIteratorClientRequest(self) {
  while (self[kBodyChunks]?.length > 0) {
    yield self[kBodyChunks].shift();
  }

  if (self[kBodyChunks]?.length === 0) {
    self.emit("drain");
  }

  while (!self.finished) {
    yield new Promise(setupChunkResolverExecutor.bind(null, self));

    if (self[kBodyChunks]?.length === 0) {
      self.emit("drain");
    }
  }

  self[kHandleResponse]?.();
}

// Helper functions for startFetch
function getURLClientRequest(self, host) {
  if (isIPv6(host)) {
    host = `[${host}]`;
  }

  const path = self[kPath];
  const protocol = self[kProtocol];

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

function failDNSLookupClientRequest(self, message, name, code, syscall) {
  const error = new Error(message);
  error.name = name;
  error.code = code;
  error.syscall = syscall;
  if (!!$debug) globalReportError(error);
  process.nextTick((s, err) => s.emit("error", err), self, error);
}

function goClientRequest(
  self,
  url,
  proxy,
  softFail,
  method,
  keepalive,
  protocol,
  customBody,
  isUpgrade,
  isDuplex,
  upgradedResponse?,
) {
  const tls = protocol === "https:" && self[kTls] ? { ...self[kTls], serverName: self[kTls].servername } : undefined;

  const fetchOptions: any = {
    method,
    headers: self.getHeaders(),
    redirect: "manual",
    signal: self[kAbortController]?.signal,
    // Timeouts are handled via this.setTimeout.
    timeout: false,
    // Disable auto gzip/deflate
    decompress: false,
    keepalive,
  };
  const upgradeHeader = fetchOptions?.headers?.upgrade;
  const isUpgradeFromHeader = typeof upgradeHeader === "string" && upgradeHeader !== "h2" && upgradeHeader !== "h2c";
  let keepOpen = false;

  if (isDuplex) {
    fetchOptions.duplex = "half";
    keepOpen = true;
  }

  if (isUpgradeFromHeader) {
    const { promise: upgradedPromise, resolve } = Promise.withResolvers<WrappedSocket | null>();
    upgradedResponse = resolve;
    fetchOptions.body = async function* () {
      const socket = await upgradedPromise;
      if (socket) {
        const iter = socket[kWrappedSocketWritable]();
        for await (const value of iter) {
          yield value;
        }
      }
    };
  } else if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    if (customBody !== undefined) {
      fetchOptions.body = customBody;
    } else if (isDuplex) {
      // Must use inline generator because fetch requires calling a generator function.
      // This closure only captures `self`, not the entire constructor scope.
      // All mutable state is stored in symbol properties on `self`.
      fetchOptions.body = async function* () {
        yield* bodyIteratorClientRequest(self);
      };
    }
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

  const socketPath = self[kSocketPath];

  if (socketPath) {
    fetchOptions.unix = socketPath;
  }

  //@ts-ignore
  self[kFetchRequest] = fetch(url, fetchOptions).then(response => {
    if (self.aborted) {
      upgradedResponse?.(null);
      maybeEmitCloseClientRequest(self);
      return;
    }

    self[kHandleResponse] = () => {
      self[kFetchRequest] = null;
      self[kClearTimeout]();
      self[kHandleResponse] = noopCallback;

      const prevIsHTTPS = getIsNextIncomingMessageHTTPS();
      setIsNextIncomingMessageHTTPS(response.url.startsWith("https:"));
      var res = (self.res = new IncomingMessage(response, {
        [typeSymbol]: NodeHTTPIncomingRequestType.FetchResponse,
        [reqSymbol]: self,
      }));
      setIsNextIncomingMessageHTTPS(prevIsHTTPS);
      res.req = self;
      let timer;
      res.setTimeout = (msecs, callback) => {
        if (timer) {
          clearTimeout(timer);
        }
        timer = setTimeout(() => {
          if (res.complete) {
            return;
          }
          res.emit("timeout");
          callback?.();
        }, msecs);
      };
      process.nextTick(
        (s, r) => {
          // If the user did not listen for the 'response' event, then they
          // can't possibly read the data, so we ._dump() it into the void
          // so that the socket doesn't hang there in a paused state.
          const contentLength = r.headers["content-length"];
          if (contentLength && isNaN(Number(contentLength))) {
            emitErrorEventNT(s, $HPE_UNEXPECTED_CONTENT_LENGTH("Parse Error"));

            r.complete = true;
            maybeEmitCloseClientRequest(s);
            return;
          }
          try {
            if (isUpgradeFromHeader) {
              if (response.status === 101) {
                const socket = new WrappedSocket(response.body, r, maybeEmitCloseClientRequest.bind(null, s));
                upgradedResponse(socket);
                s.socket = socket;
                s.emit("upgrade", r, socket, kEmptyBuffer);
                return;
              }
              upgradedResponse(null);
            }
            if (s.aborted || !s.emit("response", r)) {
              r._dump();
            }
          } finally {
            maybeEmitCloseClientRequest(s);
            if (r.statusCode === 304) {
              r.complete = true;
              maybeEmitCloseClientRequest(s);
              return;
            }
          }
        },
        self,
        res,
      );
    };

    if (!keepOpen) {
      self[kHandleResponse]();
    }

    self[kOnEnd]();
  });

  if (!softFail) {
    // Don't emit an error if we're iterating over multiple possible addresses and we haven't reached the end yet.
    // This is for the happy eyeballs implementation.
    self[kFetchRequest]
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
          self.emit("error", err);
        } catch (_err) {
          void _err;
        }
      })
      .finally(() => {
        if (!keepOpen) {
          self[kFetching] = false;
          self[kFetchRequest] = null;
          self[kClearTimeout]();
        }
      });
  }

  return self[kFetchRequest];
}

function iterateCandidatesClientRequest(self, candidates, host, port, method, keepalive, protocol, customBody) {
  if (candidates.length === 0) {
    // If we get to this point, it means that none of the addresses could be connected to.
    failDNSLookupClientRequest(self, `connect ECONNREFUSED ${host}:${port}`, "Error", "ECONNREFUSED", "connect");
    return;
  }

  const [url, proxy] = getURLClientRequest(self, candidates.shift().address);
  const upgradeHeader = self.getHeader("upgrade");
  const isUpgrade = typeof upgradeHeader === "string" && upgradeHeader !== "h2" && upgradeHeader !== "h2c";
  const isDuplex = isUpgrade || (customBody === undefined && !self.finished);

  goClientRequest(
    self,
    url,
    proxy,
    candidates.length > 0,
    method,
    keepalive,
    protocol,
    customBody,
    isUpgrade,
    isDuplex,
  )?.catch(() => iterateCandidatesClientRequest(self, candidates, host, port, method, keepalive, protocol, customBody));
}

function startFetchClientRequest(self, customBody?) {
  if (self[kFetching]) {
    return false;
  }

  self[kFetching] = true;

  const method = self[kMethod];

  let keepalive = true;
  const agentKeepalive = self[kAgent]?.keepAlive;
  if (agentKeepalive !== undefined) {
    keepalive = agentKeepalive;
  }

  const protocol = self[kProtocol];
  const host = self[kHost];
  const options = self[kOptions];
  const port = self[kPort];

  const upgradeHeader = self.getHeader("upgrade");
  const isUpgrade = typeof upgradeHeader === "string" && upgradeHeader !== "h2" && upgradeHeader !== "h2c";
  const isDuplex = isUpgrade || (customBody === undefined && !self.finished);

  if (isIP(host) || !options.lookup) {
    // Don't need to bother with lookup if it's already an IP address or no lookup function is provided.
    const [url, proxy] = getURLClientRequest(self, host);
    goClientRequest(self, url, proxy, false, method, keepalive, protocol, customBody, isUpgrade, isDuplex);
    return true;
  }

  try {
    options.lookup(host, { all: true }, (err, results) => {
      if (err) {
        if (!!$debug) globalReportError(err);
        process.nextTick((s, e) => s.emit("error", e), self, err);
        return;
      }

      let candidates = results.sort((a, b) => b.family - a.family); // prefer IPv6

      if (candidates.length === 0) {
        failDNSLookupClientRequest(self, "No records found", "DNSException", "ENOTFOUND", "getaddrinfo");
        return;
      }

      if (!self.hasHeader("Host")) {
        self.setHeader("Host", `${host}:${port}`);
      }

      // We want to try all possible addresses, beginning with the IPv6 ones, until one succeeds.
      // All addresses except for the last are allowed to "soft fail" -- instead of reporting
      // an error to the user, we'll just skip to the next address.
      // The last address is required to work, and if it fails we'll throw an error.
      iterateCandidatesClientRequest(self, candidates, host, port, method, keepalive, protocol, customBody);
    });

    return true;
  } catch (err) {
    if (!!$debug) globalReportError(err);
    process.nextTick((s, e) => s.emit("error", e), self, err);
    return false;
  }
}
const kWrappedSocketWritable = Symbol("WrappedSocketWritable");
class WrappedSocket extends Duplex {
  #fetchBody: ReadableStream<Uint8Array> | null = null;
  #resolveNextRead: ((value: Uint8Array | null) => void) | null = null;
  #queue: { value: Buffer | null; cb: () => void }[] = [];
  #ended: boolean = false;
  #res: IncomingMessage;
  #emitClose: () => void;
  constructor(fetchBody: ReadableStream<Uint8Array> | null, res: IncomingMessage, emitClose: () => void) {
    super();
    this.#fetchBody = fetchBody;
    this.#res = res;
    this.#emitClose = emitClose;
  }

  #write(value, cb) {
    if (this.#ended) {
      cb();
      return;
    }
    if (this.#resolveNextRead) {
      this.#resolveNextRead(value);
      this.#resolveNextRead = null;
      cb();
    } else {
      this.#queue.push({ value, cb });
    }
  }

  setNoDelay() {
    return this;
  }

  setKeepAlive() {
    return this;
  }

  setTimeout() {
    return this;
  }

  #end() {
    if (this.#ended) return;
    this.#ended = true;
    this.#res.complete = true;
    this.#res._dump();
    this.#emitClose();
  }

  async *[kWrappedSocketWritable]() {
    while (true) {
      if (this.#queue.length === 0) {
        if (this.listenerCount("drain") > 0) {
          this.emit("drain");
        }
        const { promise, resolve } = Promise.withResolvers();
        this.#resolveNextRead = resolve;
        const value = await promise;
        if (value === null) {
          this.#end();
          break;
        }
        yield value;
      }
      if (this.#queue.length > 0) {
        const { value, cb } = this.#queue.shift();
        if (value !== null) {
          yield value;
          cb();
        } else {
          this.#end();
          cb();
          break;
        }
      }
    }
  }

  async #consumeBody() {
    try {
      if (this.#fetchBody) {
        const reader = await this.#fetchBody.getReader();
        this.#fetchBody = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          this.push(value);
        }
        this.push(null);
      }
    } catch (e) {
      if (e.code === "ECONNRESET") {
        // end the readable side gracefully because the server closed the connection
        this.push(null);
      } else {
        this.destroy(e);
      }
    }
  }

  // Writable side proxies to inner writable
  _write(chunk, enc, cb) {
    let buffer = chunk;
    if (!Buffer.isBuffer(buffer)) {
      buffer = Buffer.from(buffer, enc);
    }
    this.#write(buffer, cb);
  }

  _final(cb) {
    this.#write(null, cb);
    this.#ended = true;
  }

  _read(_size) {
    this.#consumeBody();
  }

  _destroy(err, cb) {
    if (!this.readableEnded) {
      this.push(null);
    }
    this.#write(null, cb);
    cb(err);
  }
}

function ClientRequest(input, options, cb) {
  if (!(this instanceof ClientRequest)) {
    return new (ClientRequest as any)(input, options, cb);
  }

  // Initialize symbol-keyed state
  this[kWriteCount] = 0;
  this[kResolveNextChunk] = noopResolveNextChunk;
  this[kFetching] = false;
  this[kOnEnd] = noopCallback;
  this[kHandleResponse] = noopCallback;

  // Bind module-scope functions to this instance
  this.write = (chunk, encoding, callback) => writeClientRequest(this, chunk, encoding, callback);
  this.end = (chunk, encoding, callback) => endClientRequest(this, chunk, encoding, callback);
  this.flushHeaders = () => flushHeadersClientRequest(this);
  this.destroy = (err?: Error) => destroyClientRequest(this, err);
  this.abort = () => abortClientRequest(this);
  this._ensureTls = () => ensureTlsClientRequest(this);

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
    signal.addEventListener("abort", signalAbortHandler.bind(null, this), { once: true });
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

  this.setSocketKeepAlive = setSocketKeepAliveClientRequest;
  this.setNoDelay = setNoDelayClientRequest;
  this[kClearTimeout] = clearTimeoutClientRequest.bind(null, this);
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
