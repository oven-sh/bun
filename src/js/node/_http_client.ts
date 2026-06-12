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
  noBodySymbol,
} = require("internal/http");
const { Duplex } = require("internal/stream");

const { globalAgent } = require("node:_http_agent");
const { IncomingMessage } = require("node:_http_incoming");
const { OutgoingMessage } = require("node:_http_outgoing");

const globalReportError = globalThis.reportError;
const setTimeout = globalThis.setTimeout;
const INVALID_PATH_REGEX = /[^\u0021-\u00ff]/;
const INVALID_HOST_CHAR_REGEX = /[/\\?#@\t\n\r]/;
const kEmptyBuffer = Buffer.alloc(0);
const nop = () => {};

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

// The socket handed to 'upgrade' listeners after a 101 Switching Protocols
// response. The readable side drains the fetch response body, which carries
// the raw post-upgrade bytes (the native client stops HTTP-parsing once the
// upgrade completes; see HTTPUpgradeState in src/http/lib.rs). The writable
// side feeds the request's streaming body generator, whose bytes
// FetchTasklet writes to the connection unframed after the 101 (see
// skip_chunked_framing in src/runtime/webcore/fetch/FetchTasklet.rs).
// Socket-shaped the same way FakeSocket is.
class UpgradeSocket extends Duplex {
  #reader;
  #channel;
  #pulling = false;
  #ended = false;
  #timer;
  #timeoutMs = 0;

  constructor(reader, channel) {
    // allowHalfOpen: false matches net.Socket's default: when the peer
    // closes its half, the writable side is ended automatically.
    super({ allowHalfOpen: false });
    this.#reader = reader;
    this.#channel = channel;
  }

  // Idle timer, re-armed on read/write activity like net.Socket's.
  #armTimeout() {
    const timer = this.#timer;
    if (timer) {
      clearTimeout(timer);
      this.#timer = undefined;
    }
    const msecs = this.#timeoutMs;
    if (msecs > 0 && !this.destroyed) {
      this.#timer = setTimeout(emitTimeoutNT, msecs, this);
      this.#timer.unref();
    }
  }

  setTimeout(msecs, callback) {
    msecs = getTimerDuration(msecs, "msecs");
    if (callback !== undefined) {
      validateFunction(callback, "callback");
      if (msecs === 0) {
        this.removeListener("timeout", callback);
      } else {
        this.once("timeout", callback);
      }
    }
    this.#timeoutMs = msecs;
    this.#armTimeout();
    return this;
  }

  async #pull() {
    const reader = this.#reader;
    if (!reader) {
      this.#ended = true;
      this.push(null);
      return;
    }
    this.#pulling = true;
    try {
      while (!this.destroyed) {
        let result = reader.readMany();
        if ($isPromise(result)) {
          result = await result;
        }
        if (this.destroyed || this.#ended) return;
        const { done, value } = result;
        let wantMore = true;
        for (const chunk of value) {
          if (this.#timeoutMs > 0) this.#armTimeout();
          wantMore = this.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        }
        if (done) {
          this.#ended = true;
          this.push(null);
          return;
        }
        if (!wantMore) return;
      }
    } catch (err) {
      if (!this.destroyed) this.destroy(err);
    } finally {
      this.#pulling = false;
    }
  }

  _read(_size) {
    if (!this.#pulling && !this.#ended) {
      this.#pull();
    }
  }

  _write(chunk, _encoding, callback) {
    if (this.#timeoutMs > 0) this.#armTimeout();
    this.#channel.write(chunk, callback);
  }

  _final(callback) {
    this.#channel.end();
    callback();
  }

  _destroy(err, callback) {
    const timer = this.#timer;
    if (timer) {
      clearTimeout(timer);
      this.#timer = undefined;
    }
    this.#channel.destroy(err);
    const reader = this.#reader;
    this.#reader = undefined;
    reader?.cancel?.().catch(nop);
    callback(err);
  }

  ref() {
    return this;
  }

  unref() {
    return this;
  }

  setNoDelay(_noDelay = true) {
    return this;
  }

  setKeepAlive(_enable = false, _initialDelay = 0) {
    return this;
  }
}

Object.defineProperty(UpgradeSocket, "name", { value: "Socket" });

function emitTimeoutNT(socket) {
  socket.emit("timeout");
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

  // Channel between the upgrade socket's writable side and the request body
  // generator: after a 101 the generator is the only way to push raw bytes
  // into the native connection. Writable calls _write one chunk at a time,
  // so a single pending slot suffices; the generator invokes the callback
  // only once the sink pulled the next chunk, which propagates the native
  // socket's backpressure into the upgrade socket.
  let upgradeWriteChunk;
  let upgradeWriteCallback;
  let upgradeWake;
  let upgradeAccepted = false;
  let upgradeBodyEnded = false;

  const wakeUpgradeBody = () => {
    const wake = upgradeWake;
    upgradeWake = undefined;
    wake?.();
  };

  const endUpgradeBody = () => {
    if (upgradeBodyEnded) return;
    upgradeBodyEnded = true;
    wakeUpgradeBody();
    // The generator may still be parked in the pre-upgrade loop when the
    // server rejects the upgrade on a request that was never end()ed.
    resolveNextChunk?.(true);
  };

  const createUpgradeSocket = response => {
    const socket = new UpgradeSocket(response.body?.getReader?.(), {
      write: (chunk, callback) => {
        if (upgradeBodyEnded) {
          callback($ERR_STREAM_DESTROYED("write"));
          return;
        }
        upgradeWriteChunk = chunk;
        upgradeWriteCallback = callback;
        wakeUpgradeBody();
      },
      end: endUpgradeBody,
      destroy: err => {
        endUpgradeBody();
        const callback = upgradeWriteCallback;
        upgradeWriteChunk = upgradeWriteCallback = undefined;
        callback?.(err);
      },
    });
    if (response.url.startsWith("https:")) {
      socket.encrypted = true;
    }
    // req.abort()/req.destroy()/timeouts/options.signal abort the underlying
    // fetch; tear the hijacked socket down with it.
    const signal = this[kAbortController]?.signal;
    if (signal) {
      if (signal.aborted) {
        socket.destroy();
      } else {
        signal.addEventListener("abort", () => socket.destroy(), { once: true });
      }
    }
    return socket;
  };

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
  let isUpgrade = false;

  const startFetch = (customBody?) => {
    if (fetching) {
      return false;
    }

    fetching = true;

    // An Upgrade header other than h2/h2c makes the native client treat the
    // request as an upgrade handshake and accept a 101 response (see
    // upgraded_connection in src/runtime/webcore/fetch.rs and
    // HTTPUpgradeState in src/http/lib.rs); mirror that check here so the JS
    // side agrees on which requests can get hijacked.
    const upgradeHeader = this.getHeader("upgrade");
    isUpgrade = upgradeHeader !== undefined && !/^h2c?$/i.test(upgradeHeader);

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
      if (isUpgrade && customBody !== undefined) {
        // Upgrade requests always stream the body through the generator so
        // the connection keeps a writable channel for the post-101 socket.
        // send() leaves the chunks in kBodyChunks, so the generator still
        // delivers them (the native client holds request body bytes back
        // until the 101; see write_to_stream in src/http/lib.rs).
        customBody = undefined;
      }

      // no body and not finished
      const isDuplex = customBody === undefined && (!this.finished || isUpgrade);

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
        // Upgrade requests always stream so the post-101 socket can write
        (isUpgrade ||
          // Normal case: non-GET/HEAD/OPTIONS can use streaming
          (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") ||
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

          while (!self.finished && !upgradeAccepted && !upgradeBodyEnded) {
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

          if (isUpgrade) {
            // Keep the upload half of the connection open past req.end():
            // bytes written to the upgrade socket flow through here and are
            // written to the connection unframed once the server answered
            // with a 101.
            while (true) {
              if (upgradeWriteCallback) {
                const chunk = upgradeWriteChunk;
                const callback = upgradeWriteCallback;
                upgradeWriteChunk = upgradeWriteCallback = undefined;
                yield chunk;
                // Resumed on the sink's next pull, i.e. after it consumed
                // the chunk; ack the socket write only now so native
                // backpressure reaches the Writable side.
                callback();
                continue;
              }
              if (upgradeBodyEnded) break;
              await new Promise(resolve => {
                upgradeWake = resolve;
              });
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

        const isUpgradeResponse = isUpgrade && response.status === 101;
        if (isUpgrade) {
          if (isUpgradeResponse) {
            // The upgrade socket owns the upload half now; move the
            // generator out of the pre-upgrade loop (where it parks when
            // the request was started by flushHeaders()/write() without
            // end()) into the upgrade channel loop.
            upgradeAccepted = true;
            resolveNextChunk?.(true);
          } else {
            // The server rejected the upgrade; release the body generator
            // so the request side of the connection can finish (it would
            // otherwise stay open forever waiting for post-upgrade writes).
            endUpgradeBody();
          }
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

          if (isUpgradeResponse) {
            // A 101 response emits 'upgrade' instead of 'response', handing
            // the connection over to the listener; with no listener the
            // connection is destroyed, matching
            // https://github.com/nodejs/node/blob/v24.3.0/lib/_http_client.js#L617-L657
            // The IncomingMessage carries only the status line and headers;
            // post-upgrade bytes flow through the hijacked socket.
            res[noBodySymbol] = true;
            res.complete = true;
            process.nextTick(
              (self, res) => {
                if (self.aborted || self.listenerCount("upgrade") === 0) {
                  endUpgradeBody();
                  response.body?.cancel?.().catch(nop);
                  self.destroyed = true;
                  maybeEmitClose();
                  return;
                }
                self[kUpgradeOrConnect] = true;
                const socket = createUpgradeSocket(response);
                self.socket = socket;
                res.socket = socket;
                // Node passes any bytes that followed the 101 in the same
                // packet as `head`; here they are always delivered through
                // the socket instead, so `head` is always empty. Upgrade
                // consumers unshift `head` back onto the socket before
                // reading, so both shapes behave the same.
                self.emit("upgrade", res, socket, kEmptyBuffer);
                self.destroyed = true;
                maybeEmitClose();
              },
              this,
              res,
            );
            return;
          }

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
