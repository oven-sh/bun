// Hardcoded module "node:_http_client"
// This is a port of Node.js's lib/_http_client.js built on top of node:net /
// node:tls sockets and the llhttp HTTPParser binding, matching the upstream
// implementation as closely as possible.
// https://github.com/nodejs/node/blob/v26.3.0/lib/_http_client.js
const net = require("node:net");
const { kEmptyObject, once, ConnResetException, hasObserver, startPerf, stopPerf } = require("internal/shared");
const kClientRequestStatistics = Symbol("ClientRequestStatistics");
const {
  _checkIsHttpToken: checkIsHttpToken,
  freeParser,
  parsers,
  HTTPParser,
  calculateLenientFlags,
  prepareError,
  kSkipPendingData,
} = require("node:_http_common");
const { kUniqueHeaders, parseUniqueHeadersOption, OutgoingMessage } = require("node:_http_outgoing");
const Agent = require("node:_http_agent");
const { urlToHttpOptions } = require("internal/url");
const { kOutHeaders, kNeedDrain, kProxyConfig, checkShouldUseProxy } = require("internal/http");
const { validateInteger, validateBoolean, validateString, validateOneOf } = require("internal/validators");
const { getTimerDuration } = require("internal/timers");
const { addAbortSignal } = require("internal/streams/add-abort-signal");
const finished = require("internal/streams/end-of-stream");
const dc = require("node:diagnostics_channel");

const ObjectAssign = Object.assign;
const ObjectDefineProperty = Object.defineProperty;
const ObjectKeys = Object.keys;
const NumberIsFinite = Number.isFinite;
const ArrayIsArray = Array.isArray;

const onClientRequestCreatedChannel = dc.channel("http.client.request.created");
const onClientRequestStartChannel = dc.channel("http.client.request.start");
const onClientRequestErrorChannel = dc.channel("http.client.request.error");
const onClientResponseFinishChannel = dc.channel("http.client.response.finish");

function emitErrorEvent(request, error) {
  if (onClientRequestErrorChannel.hasSubscribers) {
    onClientRequestErrorChannel.publish({
      request,
      error,
    });
  }
  // Every request-error path funnels here (ECONNREFUSED, DNS, parse error,
  // reset): close the trace span; deduped by the per-request flag.
  traceClientResponseEnd(request);
  request.emit("error", error);
}

function onCreateConnection(this: any, err, socket) {
  if (err) {
    process.nextTick(emitErrorEvent, this, err);
  } else {
    this.onSocket(socket);
  }
}

const INVALID_PATH_REGEX = /[^\u0021-\u00ff]/;
const kError = Symbol("kError");
const kPath = Symbol("kPath");
// Chunks queued while parser.execute() is already running on this socket
// (undefined when no execute() is in progress).
const kPendingParserData = Symbol("kPendingParserData");

function validateHost(host, name) {
  if (host !== null && host !== undefined && typeof host !== "string") {
    // node passes ['string', 'undefined', 'null'] and its formatter renders the non-type
    // entries as "one of undefined or null"; pass the pre-formatted text to match.
    // https://github.com/nodejs/node/blob/v26.3.0/lib/_http_client.js#L83-L89
    throw $ERR_INVALID_ARG_TYPE(`options.${name}`, "string or one of undefined or null", host);
  }
  return host;
}

class HTTPClientAsyncResource {
  type: string;
  req: any;
  constructor(type, req) {
    this.type = type;
    this.req = req;
  }
}

// Node's parser AsyncWrap + _http_agent asyncResetHandle() make every socket
// callback re-enter the current request's async scope; Bun bridges this in
// JS by snapshotting the frame at tickOnSocket and running each socket
// listener (data/end/error/close/drain/timeout) inside it.
const kClientAsyncContext = Symbol("kClientAsyncContext");
const runInFrame = require("internal/async_context_frame").run;

function closeRequest(req) {
  if (req[kClientAsyncContext] !== undefined) req[kClientAsyncContext] = undefined;
  req._closed = true;
  req.emit("close");
}

function isURLInstance(input) {
  return input != null && typeof input === "object" && input instanceof URL;
}

// When proxying a HTTP request, the following needs to be done:
// https://datatracker.ietf.org/doc/html/rfc7230#section-5.3.2
// 1. Rewrite the request path to absolute-form.
// 2. Add proxy-connection and proxy-authorization headers appropriately.
//
// This function checks whether the request should be rewritten for proxying
// and modifies the headers as well as req.path if necessary.
// The handling of the proxy server connection is done in createConnection.
function rewriteForProxiedHttp(req, reqOptions) {
  if (req._header) {
    $debug("request._header is already sent, skipping rewriteForProxiedHttp", reqOptions);
    return false;
  }
  const agent = req.agent;
  if (!agent || !agent[kProxyConfig]) {
    return false;
  }
  if ((reqOptions.protocol || agent.protocol) !== "http:") {
    return false;
  }
  const shouldUseProxy = checkShouldUseProxy(agent[kProxyConfig], reqOptions);
  if (!shouldUseProxy) {
    return false;
  }
  // Add proxy headers.
  const { auth } = agent[kProxyConfig];
  if (auth) {
    req.setHeader("proxy-authorization", auth);
  }
  if (req.shouldKeepAlive) {
    req.setHeader("proxy-connection", "keep-alive");
  } else {
    req.setHeader("proxy-connection", "close");
  }

  // Convert the path to absolute-form.
  // https://datatracker.ietf.org/doc/html/rfc7230#section-5.3.2
  const requestHost = req.getHeader("host") || "localhost";
  const requestBase = `http://${requestHost}`;
  const requestURL = new URL(req.path, requestBase);
  const reqOptionsPort = reqOptions.port;
  if (reqOptionsPort) {
    requestURL.port = reqOptionsPort;
  }
  req.path = requestURL.href;
  return true;
}

// node.http trace events ('http.client.request' b/e). 'b' is emitted at the
// end of the constructor (like Node); the per-request flag dedupes the single
// 'e' across the response/error/destroy/close paths. Near-zero cost when off.
const kHttpTraceCat = "node,node.http";
const kTraceRequestActive = Symbol("kTraceRequestActive");
let traceEvents = null;
function traceClientResponseEnd(req) {
  if (req[kTraceRequestActive]) {
    req[kTraceRequestActive] = false;
    traceEvents.emitEvent("e", kHttpTraceCat, "http.client.request");
  }
}

function ClientRequest(input, options, cb) {
  if (!(this instanceof ClientRequest)) {
    return new (ClientRequest as any)(input, options, cb);
  }
  OutgoingMessage.$call(this);

  if (typeof input === "string") {
    const urlStr = input;
    input = urlToHttpOptions(new URL(urlStr));
  } else if (isURLInstance(input)) {
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
    options = ObjectAssign({ __proto__: null }, input, options);
  }

  let agent = options.agent;
  const defaultAgent = options._defaultAgent || Agent.globalAgent;
  if (agent === false) {
    agent = new defaultAgent.constructor();
  } else if (agent === null || agent === undefined) {
    if (typeof options.createConnection !== "function") {
      agent = defaultAgent;
    }
    // Explicitly pass through this statement as agent will not be used
    // when createConnection is provided.
  } else if (typeof agent.addRequest !== "function") {
    // node renders ['Agent-like Object', 'undefined', 'false'] as "must be one of ..."
    // (none of the entries are type names); Bun's native formatter always says
    // "must be of type ...", so patch the fixed prefix while keeping its
    // "Received ..." rendering of the offending value.
    // https://github.com/nodejs/node/blob/v26.3.0/lib/_http_client.js#L168-L170
    const err = $ERR_INVALID_ARG_TYPE("options.agent", ["Agent-like Object", "undefined", "false"], agent);
    err.message = err.message.replace(" must be of type ", " must be one of ");
    throw err;
  }
  this.agent = agent;

  const protocol = options.protocol || defaultAgent.protocol;
  let expectedProtocol = defaultAgent.protocol;
  const agentProtocol = this.agent?.protocol;
  if (agentProtocol) expectedProtocol = agentProtocol;

  const optionsPath = options.path;
  if (optionsPath) {
    const path = String(optionsPath);
    if (INVALID_PATH_REGEX.test(path)) {
      throw $ERR_UNESCAPED_CHARACTERS("Request path");
    }
  }

  if (protocol !== expectedProtocol) {
    throw $ERR_INVALID_PROTOCOL(protocol, expectedProtocol);
  }

  const defaultPort = options.defaultPort || this.agent?.defaultPort;

  const optsWithoutSignal = { __proto__: null, ...options };

  const port = (optsWithoutSignal.port = options.port || defaultPort || 80);
  const host = (optsWithoutSignal.host =
    validateHost(options.hostname, "hostname") || validateHost(options.host, "host") || "localhost");

  const setHost = options.setHost !== undefined ? Boolean(options.setHost) : options.setDefaultHeaders !== false;

  this._removedConnection = options.setDefaultHeaders === false;
  this._removedContLen = options.setDefaultHeaders === false;
  this._removedTE = options.setDefaultHeaders === false;

  this.socketPath = options.socketPath;

  const optionsTimeout = options.timeout;
  if (optionsTimeout !== undefined) this.timeout = getTimerDuration(optionsTimeout, "timeout");

  const signal = options.signal;
  if (signal) {
    addAbortSignal(signal, this);
    delete optsWithoutSignal.signal;
  }
  let method = options.method;
  if (method != null) {
    validateString(method, "options.method");
  }

  if (method) {
    if (!checkIsHttpToken(method)) {
      throw $ERR_INVALID_HTTP_TOKEN("Method", method);
    }
    method = this.method = method.toUpperCase();
  } else {
    method = this.method = "GET";
  }

  const maxHeaderSize = options.maxHeaderSize;
  if (maxHeaderSize !== undefined) validateInteger(maxHeaderSize, "maxHeaderSize", 0);
  this.maxHeaderSize = maxHeaderSize;

  const insecureHTTPParser = options.insecureHTTPParser;
  if (insecureHTTPParser !== undefined) {
    validateBoolean(insecureHTTPParser, "options.insecureHTTPParser");
  }

  this.insecureHTTPParser = insecureHTTPParser;

  const httpValidation = options.httpValidation;
  if (httpValidation !== undefined) {
    validateOneOf(httpValidation, "options.httpValidation", ["strict", "relaxed", "insecure"]);
    if (insecureHTTPParser !== undefined) {
      throw $ERR_INVALID_ARG_VALUE(
        "options.httpValidation",
        httpValidation,
        "cannot be used together with options.insecureHTTPParser",
      );
    }
  }

  this.httpValidation = httpValidation;

  const joinDuplicateHeaders = options.joinDuplicateHeaders;
  if (joinDuplicateHeaders !== undefined) {
    validateBoolean(joinDuplicateHeaders, "options.joinDuplicateHeaders");
  }

  this.joinDuplicateHeaders = joinDuplicateHeaders;

  this[kPath] = options.path || "/";
  if (cb) {
    this.once("response", cb);
  }

  if (
    method === "GET" ||
    method === "HEAD" ||
    method === "DELETE" ||
    method === "OPTIONS" ||
    method === "TRACE" ||
    method === "CONNECT"
  ) {
    this.useChunkedEncodingByDefault = false;
  } else {
    this.useChunkedEncodingByDefault = true;
  }

  this._ended = false;
  this.res = null;
  this.aborted = false;
  this.timeoutCb = null;
  this.upgradeOrConnect = false;
  this.parser = null;
  this.maxHeadersCount = null;
  this.reusedSocket = false;
  this.host = host;
  this.protocol = protocol;

  // node's domain integration attaches every EventEmitter created inside
  // domain.run() to that domain via async context propagation. Capture the
  // active domain here so the response can be bound to it when it arrives.
  const activeDomain = process.domain;
  if (activeDomain != null) {
    this.domain = activeDomain;
  }

  const thisAgent = this.agent;
  if (thisAgent) {
    // If there is an agent we should default to Connection:keep-alive,
    // but only if the Agent will actually reuse the connection!
    // If it's not a keepAlive agent, and the maxSockets==Infinity, then
    // there's never a case where this socket will actually be reused
    if (!thisAgent.keepAlive && !NumberIsFinite(thisAgent.maxSockets)) {
      this._last = true;
      this.shouldKeepAlive = false;
    } else {
      this._last = false;
      this.shouldKeepAlive = true;
    }
  }

  const optionsHeaders = options.headers;
  const headersArray = ArrayIsArray(optionsHeaders);
  if (!headersArray) {
    if (optionsHeaders) {
      const keys = ObjectKeys(optionsHeaders);
      // Retain for(;;) loop for performance reasons
      // Refs: https://github.com/nodejs/node/pull/30958
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        this.setHeader(key, optionsHeaders[key]);
      }
    }

    if (host && !this.getHeader("host") && setHost) {
      let hostHeader = host;

      // For the Host header, ensure that IPv6 addresses are enclosed
      // in square brackets, as defined by URI formatting
      // https://tools.ietf.org/html/rfc3986#section-3.2.2
      const posColon = hostHeader.indexOf(":");
      if (posColon !== -1 && hostHeader.includes(":", posColon + 1) && hostHeader.charCodeAt(0) !== 91 /* '[' */) {
        hostHeader = `[${hostHeader}]`;
      }

      if (port && +port !== defaultPort) {
        hostHeader += ":" + port;
      }
      this.setHeader("Host", hostHeader);
    }

    const auth = options.auth;
    if (auth && !this.getHeader("Authorization")) {
      this.setHeader("Authorization", "Basic " + Buffer.from(auth).toString("base64"));
    }

    if (this.getHeader("expect")) {
      if (this._header) {
        throw $ERR_HTTP_HEADERS_SENT("render");
      }

      rewriteForProxiedHttp(this, optsWithoutSignal);
      this._storeHeader(this.method + " " + this.path + " HTTP/1.1\r\n", this[kOutHeaders]);
    } else {
      rewriteForProxiedHttp(this, optsWithoutSignal);
    }
  } else {
    rewriteForProxiedHttp(this, optsWithoutSignal);
    this._storeHeader(this.method + " " + this.path + " HTTP/1.1\r\n", optionsHeaders);
  }

  this[kUniqueHeaders] = parseUniqueHeadersOption(options.uniqueHeaders);

  // initiate connection
  if (thisAgent) {
    thisAgent.addRequest(this, optsWithoutSignal);
  } else {
    // No agent, default to Connection:close.
    this._last = true;
    this.shouldKeepAlive = false;
    let opts = optsWithoutSignal;
    let socketPath;
    if (opts.path || (socketPath = opts.socketPath)) {
      opts = { ...optsWithoutSignal };
      socketPath ??= opts.socketPath;
      if (socketPath) {
        opts.path = socketPath;
      } else {
        opts.path &&= undefined;
      }
    }
    if (typeof opts.createConnection === "function") {
      const oncreate = once(onCreateConnection.bind(this));

      try {
        const newSocket = opts.createConnection(opts, oncreate);
        if (newSocket) {
          oncreate(null, newSocket);
        }
      } catch (err) {
        oncreate(err);
      }
    } else {
      $debug("CLIENT use net.createConnection", opts);
      this.onSocket(net.createConnection(opts));
    }
  }
  if (onClientRequestCreatedChannel.hasSubscribers) {
    onClientRequestCreatedChannel.publish({
      request: this,
    });
  }

  traceEvents ??= require("internal/trace_events");
  if (traceEvents.isCategoryGroupEnabled(kHttpTraceCat)) {
    traceEvents.emitEvent("b", kHttpTraceCat, "http.client.request");
    this[kTraceRequestActive] = true;
  }
}
$toClass(ClientRequest, "ClientRequest", OutgoingMessage);

ObjectDefineProperty(ClientRequest.prototype, "path", {
  __proto__: null,
  get() {
    return this[kPath];
  },
  set(value) {
    const path = String(value);
    if (INVALID_PATH_REGEX.test(path)) {
      throw $ERR_UNESCAPED_CHARACTERS("Request path");
    }
    this[kPath] = path;
  },
  configurable: true,
  enumerable: true,
});

ClientRequest.prototype._finish = function _finish() {
  OutgoingMessage.prototype._finish.$call(this);
  if (hasObserver("http")) {
    startPerf(this, kClientRequestStatistics, {
      type: "http",
      name: "HttpClient",
      detail: {
        req: {
          method: this.method,
          url: `${this.protocol}//${this.host}${this.path}`,
          headers: typeof this.getHeaders === "function" ? this.getHeaders() : {},
        },
      },
    });
  }
  if (onClientRequestStartChannel.hasSubscribers) {
    onClientRequestStartChannel.publish({
      request: this,
    });
  }
};

ClientRequest.prototype._implicitHeader = function _implicitHeader() {
  if (this._header) {
    throw $ERR_HTTP_HEADERS_SENT("render");
  }
  this._storeHeader(this.method + " " + this.path + " HTTP/1.1\r\n", this[kOutHeaders]);
};

ClientRequest.prototype.abort = function abort() {
  if (this.aborted) {
    return;
  }
  this.aborted = true;
  process.nextTick(emitAbortNT, this);
  this.destroy();
};

ClientRequest.prototype.destroy = function destroy(err) {
  if (this.destroyed) {
    return this;
  }
  this.destroyed = true;

  // Close the http.client.request trace span if no response ever arrived
  // (req.destroy()/abort before headers); deduped by the per-request flag.
  traceClientResponseEnd(this);

  // If we're aborting, we don't care about any more response data.
  const res = this.res;
  if (res) {
    res._dump();
  }

  this[kError] = err;
  this.socket?.destroy(err);

  return this;
};

function emitAbortNT(req) {
  req.emit("abort");
}

function ondrain() {
  return runInFrame(this._httpMessage?.[kClientAsyncContext], ondrainInner, this);
}

function ondrainInner() {
  const msg = this._httpMessage;
  if (msg && !msg.finished && msg[kNeedDrain]) {
    msg[kNeedDrain] = false;
    msg.emit("drain");
  }
}

function socketCloseListener() {
  return runInFrame(this._httpMessage?.[kClientAsyncContext], socketCloseListenerInner, this);
}

function socketCloseListenerInner() {
  const socket = this;
  const req = socket._httpMessage;
  $debug("HTTP socket close");

  // NOTE: It's important to get parser here, because it could be freed by
  // the `socketOnData`.
  const parser = socket.parser;
  const res = req.res;

  req.destroyed = true;
  // Socket-level close without a response (connection reset, abort):
  // close the trace span so it doesn't stay open forever.
  traceClientResponseEnd(req);
  if (res) {
    // Socket closed before we emitted 'end' below.
    if (!res.complete) {
      res.destroy(new ConnResetException("aborted"));
    }
    closeRequest(req);
    if (!res.aborted && res.readable) {
      res.push(null);
    }
  } else {
    if (!req.socket._hadError) {
      // This socket error fired before we started to
      // receive a response. The error needs to
      // fire on the request.
      req.socket._hadError = true;
      emitErrorEvent(req, new ConnResetException("socket hang up"));
    }
    closeRequest(req);
  }

  // Too bad.  That output wasn't getting written.
  // This is pretty terrible that it doesn't raise an error.
  // Fixed better in v0.10
  const outputData = req.outputData;
  if (outputData) outputData.length = 0;

  if (parser) {
    parser.finish();
    freeParser(parser, req, socket);
  }
}

function socketErrorListener(err) {
  return runInFrame(this._httpMessage?.[kClientAsyncContext], socketErrorListenerInner, this, err);
}

function socketErrorListenerInner(err) {
  const socket = this;
  const req = socket._httpMessage;
  $debug("SOCKET ERROR:", err);

  if (req) {
    // For Safety. Some additional errors might fire later on
    // and we need to make sure we don't double-fire the error event.
    socket._hadError = true;
    emitErrorEvent(req, err);
  }

  const parser = socket.parser;
  if (parser) {
    parser.finish();
    freeParser(parser, req, socket);
  }

  // Ensure that no further data will come out of the socket
  socket.removeListener("data", socketOnData);
  socket.removeListener("end", socketOnEnd);
  socket.destroy();
}

function socketOnEnd() {
  return runInFrame(this._httpMessage?.[kClientAsyncContext], socketOnEndInner, this);
}

function socketOnEndInner() {
  const socket = this;
  const req = this._httpMessage;
  const parser = this.parser;

  if (!req.res && !req.socket._hadError) {
    // If we don't have a response then we know that the socket
    // ended prematurely and we need to emit an error on the request.
    req.socket._hadError = true;
    emitErrorEvent(req, new ConnResetException("socket hang up"));
  }
  if (parser) {
    parser.finish();
    freeParser(parser, req, socket);
  }
  socket.destroy();
}

function socketOnData(d) {
  return runInFrame(this._httpMessage?.[kClientAsyncContext], socketOnDataInner, this, d);
}

function socketOnDataInner(d) {
  const socket = this;

  // HTTPParser.execute() is not reentrant. User code can synchronously push
  // more response data from inside an event emitted by execute() (e.g. an
  // 'information' handler writing to a custom createConnection duplex), which
  // re-enters this 'data' listener while the previous execute() is still on
  // the stack. Queue those chunks and process them once the outer call
  // finishes.
  const pending = socket[kPendingParserData];
  if (pending !== undefined) {
    pending.push(d);
    return;
  }

  const queue = (socket[kPendingParserData] = [d]);
  try {
    while (queue.length !== 0) {
      const parser = socket.parser;
      // The previous chunk may have freed the parser (response complete,
      // upgrade, parse error); any data queued after that point would have
      // been emitted with no 'data' listener attached in node, so drop it.
      if (!parser) break;
      processClientData(socket, queue.shift(), parser);
    }
  } finally {
    socket[kPendingParserData] = undefined;
  }
}

function processClientData(socket, d, parser) {
  const req = socket._httpMessage;

  $assert(parser && parser.socket === socket);

  const ret = parser.execute(d);
  if (ret instanceof Error) {
    prepareError(ret, parser, d);
    $debug("parse error", ret);
    freeParser(parser, req, socket);
    socket.removeListener("data", socketOnData);
    socket.removeListener("end", socketOnEnd);
    socket.destroy();
    req.socket._hadError = true;
    emitErrorEvent(req, ret);
  } else {
    const res = parser.incoming;
    if (res?.upgrade) {
      // Upgrade (if status code 101) or CONNECT
      const bytesParsed = ret;
      req.res = res;

      socket.removeListener("data", socketOnData);
      socket.removeListener("end", socketOnEnd);
      socket.removeListener("drain", ondrain);

      const timeoutCb = req.timeoutCb;
      if (timeoutCb) socket.removeListener("timeout", timeoutCb);
      socket.removeListener("timeout", responseOnTimeout);

      parser.finish();
      freeParser(parser, req, socket);

      const bodyHead = d.slice(bytesParsed, d.length);

      const eventName = req.method === "CONNECT" ? "connect" : "upgrade";
      if (req.listenerCount(eventName) > 0) {
        req.upgradeOrConnect = true;

        // detach the socket
        socket.emit("agentRemove");
        socket.removeListener("close", socketCloseListener);
        socket.removeListener("error", socketErrorListener);

        socket._httpMessage = null;
        socket.readableFlowing = null;

        // Clear before the emit: a throwing upgrade/connect handler would skip
        // closeRequest() and leave the retained request pinning the store.
        req[kClientAsyncContext] = undefined;
        req.emit(eventName, res, socket, bodyHead);
        req.destroyed = true;
        closeRequest(req);
      } else {
        // Requested Upgrade or used CONNECT method, but have no handler.
        socket.destroy();
      }
    } else if (
      res?.complete &&
      // When the status code is informational (100, 102-199),
      // the server will send a final response after this client
      // sends a request body, so we must not free the parser.
      // 101 (Switching Protocols) and all other status codes
      // should be processed normally.
      !statusIsInformational(res.statusCode)
    ) {
      socket.removeListener("data", socketOnData);
      socket.removeListener("end", socketOnEnd);
      socket.removeListener("drain", ondrain);
      freeParser(parser, req, socket);
    }
  }
}

function statusIsInformational(status) {
  // 100 (Continue)    RFC7231 Section 6.2.1
  // 102 (Processing)  RFC2518
  // 103 (Early Hints) RFC8297
  // 104-199 (Unassigned)
  return status < 200 && status >= 100 && status !== 101;
}

// client
function parserOnIncomingClient(res, shouldKeepAlive) {
  const socket = this.socket;
  const req = socket._httpMessage;

  $debug("AGENT incoming response!");

  const existingRes = req.res;
  if (existingRes) {
    // We already have a response object, this means the server
    // sent a double response.
    socket.destroy();
    const parser = socket.parser;
    if (parser) {
      // https://github.com/nodejs/node/issues/60025
      // Now, parser.incoming is pointed to the new IncomingMessage,
      // we need to rewrite it to the first one and skip all the pending IncomingMessage
      parser.incoming = existingRes;
      parser.incoming[kSkipPendingData] = true;
    }
    return 0;
  }
  req.res = res;

  // Skip body and treat as Upgrade.
  if (res.upgrade) return 2;

  // Responses to CONNECT request is handled as Upgrade.
  const method = req.method;
  if (method === "CONNECT") {
    res.upgrade = true;
    return 2; // Skip body and treat as Upgrade.
  }

  const statusCode = res.statusCode;
  if (statusIsInformational(statusCode)) {
    // Restart the parser, as this is a 1xx informational message.
    req.res = null; // Clear res so that we don't hit double-responses.
    // Maintain compatibility by sending 100-specific events
    if (statusCode === 100) {
      req.emit("continue");
    }
    // Send information events to all 1xx responses except 101 Upgrade.
    req.emit("information", {
      statusCode,
      statusMessage: res.statusMessage,
      httpVersion: res.httpVersion,
      httpVersionMajor: res.httpVersionMajor,
      httpVersionMinor: res.httpVersionMinor,
      headers: res.headers,
      rawHeaders: res.rawHeaders,
    });

    return 1; // Skip body but don't treat as Upgrade.
  }

  if (req.shouldKeepAlive && !shouldKeepAlive && !req.upgradeOrConnect) {
    // Server MUST respond with Connection:keep-alive for us to enable it.
    // If we've been upgraded (via WebSockets) we also shouldn't try to
    // keep the connection open.
    req.shouldKeepAlive = false;
  }

  if (req[kClientRequestStatistics] && hasObserver("http")) {
    stopPerf(req, kClientRequestStatistics, {
      detail: {
        res: {
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          headers: res.headers,
        },
      },
    });
  }

  if (onClientResponseFinishChannel.hasSubscribers) {
    onClientResponseFinishChannel.publish({
      request: req,
      response: res,
    });
  }
  // The response arrived: close the 'http.client.request' span (Node ends it
  // here, in parserOnIncomingClient, before handing the response to the user).
  traceClientResponseEnd(req);
  req.res = res;
  res.req = req;

  // Bind the response to the domain that was active when the request was
  // created, so unhandled 'error' events on the response are routed to
  // domain.on('error') like in node.
  const reqDomain = req.domain;
  if (reqDomain != null && typeof reqDomain.add === "function" && res.domain == null) {
    res.domain = reqDomain;
    reqDomain.add(res);
  }

  // Add our listener first, so that we guarantee socket cleanup
  res.on("end", responseOnEnd);
  req.on("finish", requestOnFinish);
  socket.on("timeout", responseOnTimeout);

  // If the user did not listen for the 'response' event, then they
  // can't possibly read the data, so we ._dump() it into the void
  // so that the socket doesn't hang there in a paused state.
  if (req.aborted || !req.emit("response", res)) res._dump();

  if (method === "HEAD") return 1; // Skip body but don't treat as Upgrade.

  if (res.statusCode === 304) {
    res.complete = true;
    return 1; // Skip body as there won't be any
  }

  return 0; // No special treatment.
}

// client
function responseKeepAlive(req) {
  const socket = req.socket;

  $debug("AGENT socket keep-alive");
  if (req.timeoutCb) {
    socket.setTimeout(0, req.timeoutCb);
    req.timeoutCb = null;
  }
  socket.removeListener("close", socketCloseListener);
  socket.removeListener("error", socketErrorListener);
  socket.removeListener("data", socketOnData);
  socket.removeListener("end", socketOnEnd);

  // TODO(ronag): Between here and emitFreeNT the socket
  // has no 'error' handler.

  // Mark this socket as available, AFTER user-added end
  // handlers have a chance to run.
  process.nextTick(emitFreeNT, req);

  req.destroyed = true;
  const reqRes = req.res;
  if (reqRes) {
    // Detach socket from IncomingMessage to avoid destroying the freed
    // socket in IncomingMessage.destroy().
    reqRes.socket = null;
  }
}

function responseOnEnd() {
  const req = this.req;
  const socket = req.socket;

  if (socket) {
    if (req.timeoutCb) socket.removeListener("timeout", emitRequestTimeout);
    socket.removeListener("timeout", responseOnTimeout);
  }

  req._ended = true;

  if (!req.shouldKeepAlive) {
    if (socket.writable) {
      $debug("AGENT socket.destroySoon()");
      if (typeof socket.destroySoon === "function") socket.destroySoon();
      else socket.end();
    }
    $assert(!socket.writable);
  } else if (req.writableFinished && !this.aborted) {
    $assert(req.finished);
    // We can assume `req.finished` means all data has been written since:
    // - `'responseOnEnd'` means we have been assigned a socket.
    // - when we have a socket we write directly to it without buffering.
    // - `req.finished` means `end()` has been called and no further data.
    //   can be written
    // In addition, `req.writableFinished` means all data written has been
    // accepted by the kernel. (i.e. the `req.socket` is drained).Without
    // this constraint, we may assign a non drained socket to a request.
    responseKeepAlive(req);
  }
}

function responseOnTimeout() {
  return runInFrame(this._httpMessage?.[kClientAsyncContext], responseOnTimeoutInner, this);
}

function responseOnTimeoutInner() {
  const req = this._httpMessage;
  if (!req) return;
  const res = req.res;
  if (!res) return;
  res.emit("timeout");
}

// This function is necessary in the case where we receive the entire response
// from the server before we finish sending out the request.
function requestOnFinish() {
  const req = this;

  // If the response ends before this request finishes writing, `responseOnEnd()`
  // already released the socket. When `finish` fires later, that socket may
  // belong to a different request, so only call `responseKeepAlive()` when the
  // original request is still alive (`!req.destroyed`).
  if (req.shouldKeepAlive && req._ended && !req.destroyed) responseKeepAlive(req);
}

function emitFreeNT(req) {
  closeRequest(req);
  const socket = req.socket;
  if (socket) {
    socket.emit("free");
  }
}

function tickOnSocket(req, socket) {
  const parser = parsers.alloc();
  req.socket = socket;
  req[kClientAsyncContext] = $getInternalField($asyncContext, 0);
  const lenientFlags = calculateLenientFlags(req.httpValidation, req.insecureHTTPParser);
  parser.initialize(
    HTTPParser.RESPONSE,
    new HTTPClientAsyncResource("HTTPINCOMINGMESSAGE", req),
    req.maxHeaderSize || 0,
    lenientFlags,
  );
  parser.socket = socket;
  parser.outgoing = req;
  req.parser = parser;

  socket.parser = parser;
  socket._httpMessage = req;

  // Propagate headers limit from request object to parser
  const maxHeadersCount = req.maxHeadersCount;
  if (typeof maxHeadersCount === "number") {
    parser.maxHeaderPairs = maxHeadersCount << 1;
  }

  parser.joinDuplicateHeaders = req.joinDuplicateHeaders;

  parser.onIncoming = parserOnIncomingClient;
  socket.on("data", socketOnData);
  socket.on("end", socketOnEnd);
  socket.on("close", socketCloseListener);
  socket.on("drain", ondrain);

  if (req.timeout !== undefined || req.agent?.options?.timeout) {
    listenSocketTimeout(req);
  }
  req.emit("socket", socket);
}

function emitRequestTimeout() {
  return runInFrame(this._httpMessage?.[kClientAsyncContext], emitRequestTimeoutInner, this);
}

function emitRequestTimeoutInner() {
  const req = this._httpMessage;
  if (req) {
    req.emit("timeout");
  }
}

function onSocketListenTimeout(socket) {
  socket.once("timeout", emitRequestTimeout);
}

function listenSocketTimeout(req) {
  if (req.timeoutCb) {
    return;
  }
  // Set timeoutCb so it will get cleaned up on request end.
  req.timeoutCb = emitRequestTimeout;
  // Delegate socket timeout event.
  const reqSocket = req.socket;
  if (reqSocket) {
    reqSocket.once("timeout", emitRequestTimeout);
  } else {
    req.on("socket", onSocketListenTimeout);
  }
}

ClientRequest.prototype.onSocket = function onSocket(socket, err) {
  // Attach the error listener synchronously so that any errors emitted on
  // the socket before onSocketNT runs (e.g. from a blocklist check or other
  // next-tick error) are forwarded to the request and can be caught by the
  // user's error handler. socketErrorListener requires socket._httpMessage
  // to be set so we set it here too.
  if (socket && !err) {
    socket._httpMessage = this;
    // Capture the frame here, not just in tickOnSocket: onSocket runs in the
    // request's context, and an error in the window before onSocketNT would
    // otherwise run socketErrorListener with no frame and clear the context.
    this[kClientAsyncContext] = $getInternalField($asyncContext, 0);
    socket.on("error", socketErrorListener);
  }
  process.nextTick(onSocketNT, this, socket, err);
};

function destroyRequestOnSocketNT(req, socket, err) {
  if (!req.aborted && !err) {
    err = new ConnResetException("socket hang up");
  }
  // ERR_PROXY_TUNNEL is handled by the proxying logic.
  // Skip if the error was already emitted by the early socketErrorListener.
  if (err && err.code !== "ERR_PROXY_TUNNEL" && !socket?._hadError) {
    emitErrorEvent(req, err);
  }
  // The request is dead with no parser: close the trace span on the paths
  // that skip emitErrorEvent above (proxy tunnel; error already emitted).
  traceClientResponseEnd(req);
  closeRequest(req);
}

function onSocketNT(req, socket, err) {
  if (req.destroyed || err) {
    req.destroyed = true;

    if (socket) {
      if (!err && req.agent && !socket.destroyed) {
        socket.emit("free");
        socket.removeListener("error", socketErrorListener);
      } else {
        finished(socket.destroy(err || req[kError]), onSocketFinishedDestroy.bind(undefined, req, socket, err));
        return;
      }
    }

    destroyRequestOnSocketNT(req, socket, err || req[kError]);
  } else {
    tickOnSocket(req, socket);
    req._flush();
  }
}

function onSocketFinishedDestroy(req, socket, err, er) {
  if (er?.code === "ERR_STREAM_PREMATURE_CLOSE") {
    er = null;
  }
  destroyRequestOnSocketNT(req, socket, er || err);
}

function callSocketMethod(this: any, method, arguments_) {
  if (method) this.socket[method].$apply(this.socket, arguments_);
}

function deferToConnectOnSocket(this: any, method, arguments_) {
  if (this.socket.writable) {
    callSocketMethod.$call(this, method, arguments_);
  } else {
    this.socket.once("connect", callSocketMethod.bind(this, method, arguments_));
  }
}

ClientRequest.prototype._deferToConnect = _deferToConnect;
function _deferToConnect(this: any, method, arguments_) {
  // This function is for calls that need to happen once the socket is
  // assigned to this request and writable. It's an important promisy
  // thing for all the socket calls that happen either now
  // (when a socket is assigned) or in the future (when a socket gets
  // assigned out of the pool and is eventually writable).

  if (!this.socket) {
    this.once("socket", deferToConnectOnSocket.bind(this, method, arguments_));
  } else {
    deferToConnectOnSocket.$call(this, method, arguments_);
  }
}

ClientRequest.prototype.setTimeout = function setTimeout(msecs, callback) {
  if (this._ended) {
    return this;
  }

  listenSocketTimeout(this);
  msecs = getTimerDuration(msecs, "msecs");
  if (callback) this.once("timeout", callback);

  const socket = this.socket;
  if (socket) {
    setSocketTimeout(socket, msecs);
  } else {
    this.once("socket", onSocketSetTimeout.bind(undefined, msecs));
  }

  return this;
};

function onSocketSetTimeout(msecs, sock) {
  setSocketTimeout(sock, msecs);
}

function setSocketTimeout(sock, msecs) {
  if (sock.connecting) {
    sock.once("connect", function () {
      sock.setTimeout(msecs);
    });
  } else {
    sock.setTimeout(msecs);
  }
}

ClientRequest.prototype.setNoDelay = function setNoDelay(noDelay) {
  this._deferToConnect("setNoDelay", [noDelay]);
};

ClientRequest.prototype.setSocketKeepAlive = function setSocketKeepAlive(enable, initialDelay) {
  this._deferToConnect("setKeepAlive", [enable, initialDelay]);
};

ClientRequest.prototype.clearTimeout = function clearTimeout(cb) {
  this.setTimeout(0, cb);
};

export default {
  ClientRequest,
};
