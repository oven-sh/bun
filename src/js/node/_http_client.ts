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
    send();
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

  const startFetch = (customBody?) => {
    if (fetching) {
      return false;
    }

    fetching = true;

    const method = this[kMethod];

    let keepalive = true;
    const agentKeepalive = this[kAgent]?.keepalive;
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

      if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
        const self = this;
        if (customBody !== undefined) {
          fetchOptions.body = customBody;
        } else if (isDuplex) {
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
      this[kFetchRequest] = fetch(url, fetchOptions).then(response => {
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
          this.setHeader("Host", `${host}:${port}`);
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
    this[kAbortController] = new AbortController();
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
