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
const { Duplex } = require("node:stream");

// Local hook set by `ClientRequest` on itself when it owns an upgrade-aware
// body generator. `createUpgradeSocket._final()`/`_destroy()` call this to
// terminate the upload half of a hijacked connection without tripping the
// normal `req.end()` path (which for the WebSocket/CDP pattern already ran
// synchronously before the 101 response arrived).
const kEndUpgradeBody = Symbol("kEndUpgradeBody");

// Matches a `Connection: Upgrade` + `Upgrade: <proto>` pair that turns the
// request into an HTTP/1.1 upgrade handshake. `h2`/`h2c` are excluded to
// match `Bun__fetch_` in fetch.zig, which also ignores h2/h2c upgrades.
function hasUpgradeHeaders(req): boolean {
  const upgrade = req.getHeader("upgrade");
  if (!upgrade) return false;
  const upgradeStr = String(upgrade).toLowerCase();
  if (upgradeStr === "h2" || upgradeStr === "h2c") return false;
  const connection = req.getHeader("connection");
  if (!connection) return false;
  const cs = Array.isArray(connection) ? connection.join(",") : String(connection);
  return /(?:^|[\s,])upgrade(?:[\s,]|$)/i.test(cs);
}

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

// Creates a Duplex stream that represents the hijacked socket for a
// `Connection: Upgrade` response. The readable side is fed from the
// IncomingMessage `res` (which owns the fetch response body reader); the
// writable side routes back through `req.write()` so the upload half of
// the HTTP/1.1 connection keeps flowing. After the server sends `101`,
// FetchTasklet.skipChunkedFraming() flips on `signals.upgraded`, so any
// post-upgrade writes bypass chunked framing and the terminating 0-chunk —
// matching the raw-bytes semantics of a real hijacked TCP socket.
//
// Used for dockerode-style hijacked `docker exec` sessions and similar
// `Upgrade: tcp` patterns.
function createUpgradeSocket(req, res) {
  let socketDestroyed = false;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutMs = 0;

  const armTimeout = () => {
    if (timeoutTimer !== undefined) {
      clearTimeout(timeoutTimer);
      timeoutTimer = undefined;
    }
    if (timeoutMs > 0 && !socketDestroyed) {
      timeoutTimer = setTimeout(() => {
        timeoutTimer = undefined;
        if (!socketDestroyed) duplex.emit("timeout");
      }, timeoutMs);
      (timeoutTimer as any).unref?.();
    }
  };

  let dataBridged = false;
  const bridgeResData = () => {
    if (dataBridged) return;
    dataBridged = true;
    // Bridge the IncomingMessage's decoded body into the Duplex. The
    // IncomingMessage is the single consumer of the fetch response body
    // reader — avoiding a second `getReader()` call that would otherwise
    // throw "ReadableStream is already locked" on the next read.
    res.on("data", (chunk: Buffer) => {
      armTimeout();
      if (!duplex.push(chunk)) res.pause();
    });
    res.once("end", () => {
      duplex.push(null);
    });
  };

  const duplex: any = new Duplex({
    allowHalfOpen: true,
    read() {
      // If the underlying IncomingMessage was already destroyed (e.g. the
      // request aborted before the user attached a 'data' listener), push
      // EOF immediately so the readable side doesn't hang forever.
      if (res.destroyed || res.readableEnded) {
        duplex.push(null);
        return;
      }
      bridgeResData();
      res.resume();
    },
    write(chunk, encoding, callback) {
      // Only gate on `req.destroyed`, NOT `req.finished` — for the
      // WebSocket/CDP pattern the caller has already called `req.end()`
      // before the 101, which sets `req.finished = true` synchronously.
      // The upgrade-aware body generator stays alive past that point and
      // still accepts writes until the hijacked socket tears down. Since
      // the only way into this branch is destruction, use
      // `ERR_STREAM_DESTROYED` (matches net.Socket/Writable semantics)
      // rather than `ERR_STREAM_WRITE_AFTER_END` (reserved for writes
      // after `.end()` on a stream that ended normally).
      if (req.destroyed) {
        callback($ERR_STREAM_DESTROYED("write"));
        return;
      }
      armTimeout();
      // Honor backpressure: only ack this write once `req` reports that it
      // actually has room for more. `req.write()` returns false when its
      // internal body queue has crossed the fake-backpressure threshold; the
      // `'drain'` event fires when the queued chunks have been consumed by
      // the underlying fetch body generator. Post-upgrade, FetchTasklet
      // writes the raw bytes directly (no chunk framing).
      const ok = req.write(chunk, encoding);
      if (ok) {
        callback();
        return;
      }
      // Backpressure: wait for 'drain', but also tear down cleanly if `req`
      // errors or closes before drain fires — otherwise the callback is
      // orphaned and the writable side stays stuck in kWriting.
      //
      // A `'close'` before `'drain'` is a failure: the in-flight chunk is
      // still buffered inside `req` and gets discarded when `req` tears
      // down. We MUST surface this as an error so the Duplex consumer knows
      // the write was lost (unlike `_final()` where a clean close after
      // `req.end()` legitimately signals completion).
      let settled = false;
      const settle = (err?: Error) => {
        if (settled) return;
        settled = true;
        req.removeListener("drain", onDrain);
        req.removeListener("error", onError);
        req.removeListener("close", onClose);
        callback(err);
      };
      const onDrain = () => settle();
      const onError = (err: Error) => settle(err);
      const onClose = () => settle(new ConnResetException("socket hang up"));
      req.once("drain", onDrain);
      req.once("error", onError);
      req.once("close", onClose);
    },
    final(callback) {
      if (req.destroyed) {
        callback();
        return;
      }
      // The ClientRequest unconditionally installs the upgrade-aware body
      // terminator, so `kEndUpgradeBody` is always present — close the
      // upload half through it. This covers both the WebSocket/CDP pattern
      // (req.end() before 101, req.finished already true) and the
      // dockerode pattern (only req.write(), never req.end()).
      req[kEndUpgradeBody]();
      callback();
    },
    destroy(err, callback) {
      socketDestroyed = true;
      if (timeoutTimer !== undefined) {
        clearTimeout(timeoutTimer);
        timeoutTimer = undefined;
      }
      try {
        res.destroy?.(err || undefined);
      } catch (_err) {
        void _err;
      }
      // Release the upgrade-aware body generator so `fetch` can finalize
      // the request; otherwise the generator would hang forever waiting
      // for more chunks (or the `finished` signal that never comes for
      // the WebSocket pattern).
      try {
        req[kEndUpgradeBody]?.();
      } catch (_err) {
        void _err;
      }
      if (!req.destroyed) {
        req.destroy(err || undefined);
      }
      callback(err);
    },
  });

  // Surface common net.Socket fields so consumers that inspect the socket
  // (e.g. dockerode-modem) see a sane shape.
  duplex.setKeepAlive = () => duplex;
  duplex.setNoDelay = () => duplex;
  duplex.setTimeout = (msecs: number, callback?: () => void) => {
    timeoutMs = msecs | 0;
    if (callback) {
      // Match `net.Socket.setTimeout(0, cb)` semantics: passing 0 with a
      // callback de-registers that specific listener rather than adding
      // another one. Mirrors `ClientRequestPrototype.setTimeout` below.
      if (timeoutMs === 0) {
        duplex.removeListener("timeout", callback);
      } else {
        duplex.once("timeout", callback);
      }
    }
    armTimeout();
    return duplex;
  };
  duplex.ref = () => duplex;
  duplex.unref = () => duplex;

  // Eagerly wire `res` error/close propagation — NOT inside the lazy
  // `bridgeResData()` closure. Attaching these only on the first `_read()`
  // leaves a race window between the `'upgrade'` event firing (scheduled on
  // `process.nextTick`) and the user's handler subscribing to `'data'`: if
  // the request aborts during that gap, `res` is destroyed with no listener
  // and the duplex never learns about it. We also hook into req's error
  // path for the same reason — network errors on the upload half should
  // surface on the hijacked socket immediately.
  res.once("error", (err: Error) => {
    if (!duplex.destroyed) duplex.destroy(err);
  });
  res.once("close", () => {
    if (!duplex.destroyed && !duplex.readableEnded) {
      // Push EOF if nothing else has — ensures the readable side finishes
      // even if no 'end' was emitted before the close (abort, reset, etc.).
      duplex.push(null);
    }
  });
  req.once("error", (err: Error) => {
    if (!duplex.destroyed) duplex.destroy(err);
  });

  return duplex;
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
  // Upgrade-aware body generator's exit flag. For upgrade requests the
  // generator ignores `self.finished` (which gets set synchronously by
  // `req.end()` in the WebSocket pattern) and instead waits until the
  // hijacked duplex socket explicitly closes the upload half via
  // `this[kEndUpgradeBody]`.
  let upgradeBodyEnded = false;

  // Exposed on `this` so `createUpgradeSocket`'s `_final`/`_destroy` can
  // release the upload half. Safe to call multiple times.
  this[kEndUpgradeBody] = () => {
    upgradeBodyEnded = true;
    resolveNextChunk?.(true);
  };

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
      // For upgrade requests the upload half must stay open for post-101
      // writes. WebSocket/CDP clients call `req.end()` before the 101
      // arrives (and reach this guard); dockerode's hijacked exec never
      // calls `req.end()` at all (flushHeaders + write only). The
      // generator keeps running until the hijacked socket's
      // `_final`/`_destroy` signals via `kEndUpgradeBody`.
      //
      // Read the cached `isUpgrade` (populated by `send()` → `startFetch`
      // a few lines above) instead of re-running `hasUpgradeHeaders()`.
      if (!isUpgrade) {
        resolveNextChunk?.(true);
      }
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
  // Precomputed once by the first `startFetch()` call so `this.end`, `go()`,
  // and the `.then` leak-fix guard all share the same answer to "did the
  // request carry `Connection: Upgrade` + `Upgrade: <proto>`?" — instead of
  // each re-running `hasUpgradeHeaders()` (two `getHeader()` calls + regex).
  // `this.end` reads this after `send()` returns, by which point startFetch
  // has run synchronously and the flag is populated.
  let isUpgrade = false;

  const startFetch = (customBody?) => {
    if (fetching) {
      return false;
    }

    fetching = true;
    isUpgrade = hasUpgradeHeaders(this);

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
      // `isUpgrade` (closure var, set above in `startFetch`) tells us
      // whether the request carried `Connection: Upgrade` + `Upgrade:
      // <proto>`. Upgrade requests need a long-lived streaming body so
      // the upload half of the hijacked connection stays open for
      // post-101 writes — covers the dockerode pattern (POST +
      // req.write()) and the WebSocket/CDP pattern (GET + req.end()
      // before the 101).

      // For upgrade requests always funnel the body through the generator
      // so the write side stays live; any pre-assembled body is already in
      // kBodyChunks (send() reads from there without clearing it). Clear
      // it BEFORE computing isDuplex so `keepOpen` goes true — otherwise
      // the `.finally()` below resets `fetching`, and the first
      // post-upgrade `socket.write()` would fire a second nodeHttpClient
      // request to the same URL.
      if (isUpgrade && customBody !== undefined) {
        customBody = undefined;
      }

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
        (isDuplex || isUpgrade) &&
        // Upgrade: always stream — even GET/HEAD/OPTIONS with no pre-body
        // need a live body channel for post-upgrade socket.write().
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

          // Exit condition diverges: upgrade requests stay alive until the
          // hijacked socket calls `req[kEndUpgradeBody]()`; non-upgrade
          // requests end at `req.end()` as before.
          while (isUpgrade ? !upgradeBodyEnded : !self.finished) {
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

        // A `HTTP/1.1 101 Switching Protocols` response indicates the server
        // has accepted an `Upgrade:` request (WebSocket, `docker exec` hijack,
        // etc.). The ClientRequest must dispatch `'upgrade'` with the hijacked
        // socket regardless of whether the caller ever calls `req.end()` — the
        // upload half of the connection is deliberately left open for the
        // hijacked protocol.
        //
        // Named `is101` rather than `isUpgrade` to avoid shadowing the
        // outer closure `isUpgrade` (set by `startFetch` from the request
        // headers — a different question; the two diverge when the
        // server rejects).
        const is101 = response.status === 101;

        // Server rejected the upgrade (e.g. 400 Bad Request, 404, auth
        // failure) — release the upgrade-aware body generator so the
        // ResumableSink/FetchTasklet can finalize. Otherwise the generator
        // parks at `yield await new Promise(...)` forever (upgradeBodyEnded
        // is only set by the hijacked socket, which never gets constructed
        // for a non-101 response).
        //
        // Use the captured outer `isUpgrade` (same source of truth the
        // generator's loop condition closes over) so the guard can't
        // diverge from the generator if the user mutates headers mid-flight.
        if (!is101 && isUpgrade) {
          this[kEndUpgradeBody]();
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

          if (is101) {
            this[kUpgradeOrConnect] = true;
            // The hijacked socket reads via the IncomingMessage `res` (the
            // single owner of the fetch response body reader); this avoids
            // the "ReadableStream is already locked" TypeError that would
            // otherwise occur when the user touches `res`.
            const upgradeSocket = createUpgradeSocket(this, res);
            process.nextTick(
              (self, res, socket) => {
                if (self.aborted || self.listenerCount("upgrade") === 0) {
                  // No handler for 'upgrade' — drop the hijacked socket so
                  // we don't leak the underlying TCP connection. The close
                  // notification for `req` will follow from the socket
                  // destruction path below.
                  socket.destroy();
                  res._dump?.();
                  maybeEmitClose();
                } else {
                  // Do NOT call `maybeEmitClose()` here. The ClientRequest
                  // lifecycle is now owned by the hijacked socket — firing
                  // `req.emit('close')` on the very next tick would race
                  // the Duplex `_write` backpressure path, which watches
                  // `req.once('close', …)` to detect real TCP drops and
                  // would treat a routine lifecycle close as a spurious
                  // `ConnResetException('socket hang up')`. The hijacked
                  // socket's `_destroy` path calls `req.destroy()` when
                  // the user is done, which emits `'close'` on `req` at
                  // the correct time.
                  //
                  // `head` is always `Buffer.alloc(0)` here, diverging from
                  // Node.js which passes any bytes llhttp read past the 101
                  // `\r\n\r\n` in the same TCP segment. Bun's fetch-routed
                  // architecture enqueues those bytes into `response.body`
                  // before `handleResponse()` runs, so they flow through
                  // `res` (the `IncomingMessage`) → `createUpgradeSocket`'s
                  // `res.on('data', …)` bridge and arrive as the first
                  // `socket.on('data')` chunk instead. Standard upgrade
                  // consumers (`ws`, dockerode-modem, the `websocket` npm
                  // package) do `if (head.length) socket.unshift(head)` and
                  // then read from the socket, so they're unaffected — the
                  // only code that diverges is code that synchronously
                  // inspects `head` for protocol bytes before subscribing
                  // to `'data'`, which is already fragile under Node since
                  // TCP packet boundaries are not guaranteed.
                  self.emit("upgrade", res, socket, Buffer.alloc(0));
                }
              },
              this,
              res,
              upgradeSocket,
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

        if (!keepOpen || is101) {
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
