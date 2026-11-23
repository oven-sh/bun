// What fetch() and WebSocket publish to node:diagnostics_channel in Node, where undici implements them.
// Reference: https://github.com/nodejs/undici/blob/v8.12.2/docs/docs/api/DiagnosticsChannel.md

const { builtinChannel, reportUncaughtException } = require("internal/shared");
const { checkIsHttpToken } = require("internal/validators");
const { isIP } = require("internal/net/isIP");

const ArrayPrototypeSlice = Array.prototype.slice;
const NumberParseInt = Number.parseInt;
const ObjectAssign = Object.assign;
const ObjectDefineProperty = Object.defineProperty;
const ObjectHasOwn = Object.hasOwn;
const RegExpPrototypeExec = RegExp.prototype.exec;
const SafeError = Error;
const StringPrototypeIndexOf = String.prototype.indexOf;
const StringPrototypeSlice = String.prototype.slice;
const StringPrototypeSplit: (this: string, separator: string) => string[] = String.prototype.split;
const StringPrototypeToLowerCase = String.prototype.toLowerCase;
const StringPrototypeTrim = String.prototype.trim;

const onBeforeConnect = builtinChannel("undici:client:beforeConnect");
const onConnected = builtinChannel("undici:client:connected");
const onConnectError = builtinChannel("undici:client:connectError");
const onSendHeaders = builtinChannel("undici:client:sendHeaders");
const onCreate = builtinChannel("undici:request:create");
const onBodySent = builtinChannel("undici:request:bodySent");
const onBodyChunkSent = builtinChannel("undici:request:bodyChunkSent");
const onBodyChunkReceived = builtinChannel("undici:request:bodyChunkReceived");
const onHeaders = builtinChannel("undici:request:headers");
const onTrailers = builtinChannel("undici:request:trailers");
const onError = builtinChannel("undici:request:error");
const onOpen = builtinChannel("undici:websocket:open");
const onClose = builtinChannel("undici:websocket:close");
const onSocketError = builtinChannel("undici:websocket:socket_error");
const onPing = builtinChannel("undici:websocket:ping");
const onPong = builtinChannel("undici:websocket:pong");

// Keep in sync with DiagnosticsHook.h
const enum RequestEvent {
  WantedChunks,
  Create,
  Connecting,
  HeadSent,
  BodyChunkSent,
  BodySent,
  ResponseHead,
  BodyChunkReceived,
  ResponseEnd,
  Error,
  Abort,
}

const enum WebSocketEvent {
  Open,
  Close,
  SocketError,
  TLSError,
  Ping,
  Pong,
}

class UndiciError extends Error {
  code: string;

  constructor(name: string, code: string, message: string) {
    super(message);
    this.name = name;
    this.code = code;
    // What `instanceof` of the classes of the npm package looks for.
    ObjectDefineProperty(this, Symbol.for("undici.error.UND_ERR"), { __proto__: null, value: true });
    ObjectDefineProperty(this, Symbol.for(`undici.error.${code}`), { __proto__: null, value: true });
  }
}

function invalidArgument(message: string) {
  return new UndiciError("InvalidArgumentError", "UND_ERR_INVALID_ARG", message);
}

function validateName(key: unknown): string {
  if (typeof key !== "string" || !checkIsHttpToken(key)) throw invalidArgument("invalid header key");
  return StringPrototypeToLowerCase.$call(key);
}

const refusedByAddHeader = /[^\t\x20-\x7e\x80-\xff]/;
const refusedByHeaders = /[\0\n\r]|[^\0-\xff]/;

function validateValue(key: string, value: unknown, refused: RegExp) {
  if (value === null) return "";
  if (typeof value === "object") throw invalidArgument(`invalid ${key} header`);
  const text = `${value}`;
  if (RegExpPrototypeExec.$call(refused, text) !== null) throw invalidArgument(`invalid ${key} header`);
  return text;
}

function validateValues(key: string, value: unknown, refused: RegExp): string | string[] {
  if (!$isJSArray(value)) return validateValue(key, value, refused);
  const values: string[] = [];
  for (let i = 0; i < value.length; i++) $arrayPush(values, validateValue(key, value[i], refused));
  return values;
}

function hasCloseToken(value: string) {
  const tokens: string[] = StringPrototypeSplit.$call(StringPrototypeToLowerCase.$call(value), ",");
  let found = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = StringPrototypeTrim.$call(tokens[i]);
    if (!checkIsHttpToken(token)) return undefined;
    if (token === "close") found = true;
  }
  return found;
}

/** Where the port starts, or the length. */
function endOfHostname(host: string): number {
  const colon = StringPrototypeIndexOf.$call(host, ":", StringPrototypeIndexOf.$call(host, "]") + 1);
  return colon === -1 ? host.length : colon;
}

function getHostname(host: string): string {
  const end = endOfHostname(host);
  return host[0] === "[" ? StringPrototypeSlice.$call(host, 1, end - 1) : StringPrototypeSlice.$call(host, 0, end);
}

function getServerName(host: string | null) {
  if (!host) return null;
  const hostname = getHostname(host);
  return hostname === "" || isIP(hostname) ? null : hostname;
}

// Whoever reads this in Node takes the body away from the request.
// eslint-disable-next-line require-yield
async function* unreadableBody() {
  throw $ERR_INVALID_STATE("The body of a request is published on undici:request:bodyChunkSent");
}

class Request {
  headersTimeout = undefined;
  bodyTimeout = undefined;
  method: string;
  typeOfService = undefined;
  abort = null;
  body: AsyncGenerator | null;
  completed = false;
  aborted = false;
  upgrade: string | null = null;
  path: string;
  origin: string;
  protocol: string;
  idempotent: boolean;
  blocking: boolean;
  reset: boolean | null = null;
  host: string | null = null;
  contentLength: number | null;
  contentType: string | string[] | null = null;
  headers: unknown[] = [];
  expectContinue = false;
  servername: string | null = null;

  constructor(method: string, origin: string, path: string, hasBody: boolean, contentLength: number | null) {
    this.method = method;
    this.body = hasBody ? unreadableBody() : null;
    this.path = path;
    this.origin = origin;
    this.protocol = origin[4] === "s" ? "https:" : "http:";
    this.idempotent = method === "HEAD" || method === "GET" || method === "QUERY";
    this.blocking = method !== "HEAD";
    this.contentLength = contentLength;
  }

  addHeader(key: string, value: unknown) {
    if (value === undefined) return this;

    const name = validateName(key);
    const values = validateValues(key, value, refusedByAddHeader);
    switch (name) {
      case "host":
        if (this.host !== null) throw invalidArgument("duplicate host header");
        if (typeof values !== "string") throw invalidArgument("invalid host header");
        this.host = values;
        break;
      case "content-length":
        if (this.contentLength !== null) throw invalidArgument("duplicate content-length header");
        if (typeof values !== "string" || RegExpPrototypeExec.$call(/^\d+$/, values) === null) {
          throw invalidArgument("invalid content-length header");
        }
        this.contentLength = NumberParseInt(values, 10);
        break;
      case "transfer-encoding":
      case "keep-alive":
      case "upgrade":
        throw invalidArgument(`invalid ${name} header`);
      case "connection": {
        const closes = typeof values === "string" ? hasCloseToken(values) : undefined;
        if (closes === undefined) throw invalidArgument("invalid connection header");
        if (closes) this.reset = true;
        break;
      }
      case "expect":
        throw new UndiciError("NotSupportedError", "UND_ERR_NOT_SUPPORTED", "expect header not supported");
      default:
        if (name === "content-type") this.contentType ??= values;
        $arrayPush(this.headers, key);
        $arrayPush(this.headers, values);
    }
    return this;
  }
}

/** Sorts `fields` into `request`. Returns the ones that are not up to a subscriber. */
function readFields(request: Request, fields: string[]) {
  const fixed: string[] = [];
  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    let target: unknown[] = fixed;
    const name = StringPrototypeToLowerCase.$call(key);
    switch (name) {
      case "host":
        request.host = value;
        request.servername = getServerName(value);
        continue;
      case "connection":
        if (hasCloseToken(value)) request.reset = true;
        break;
      case "upgrade":
        request.upgrade = value;
        break;
      case "content-length":
      case "transfer-encoding":
        break;
      default:
        if (name === "content-type") request.contentType = value;
        target = request.headers;
    }
    $arrayPush(target, key);
    $arrayPush(target, value);
  }
  return fixed;
}

function appendField(fields: string[], key: unknown, value: unknown) {
  switch (validateName(key)) {
    case "host":
    case "connection":
    case "upgrade":
    case "content-length":
    case "transfer-encoding":
      throw invalidArgument(`invalid ${key} header`);
  }
  const values = validateValues(key as string, value, refusedByHeaders);
  if (typeof values === "string") {
    $arrayPush(fields, key);
    $arrayPush(fields, values);
    return;
  }
  for (let i = 0; i < values.length; i++) {
    $arrayPush(fields, key);
    $arrayPush(fields, values[i]);
  }
}

// Node writes to the socket whatever a subscriber puts there. Here it fares like a call of addHeader() that throws.
function writeFields(fixed: string[], host: unknown, closes: boolean, headers: unknown) {
  const fields: string[] = [];
  for (let i = 0; i < fixed.length; i += 2) {
    if (closes && StringPrototypeToLowerCase.$call(fixed[i]) === "connection") continue;
    $arrayPush(fields, fixed[i]);
    $arrayPush(fields, fixed[i + 1]);
  }
  try {
    if (typeof host === "string") {
      host = validateValue("host", host, refusedByHeaders);
      $arrayPush(fields, "Host");
      $arrayPush(fields, host);
    }
  } catch (error) {
    process.nextTick(reportUncaughtException, error);
  }
  if (closes) {
    $arrayPush(fields, "Connection");
    $arrayPush(fields, "close");
  }
  if ($isJSArray(headers)) {
    for (let i = 0; i < headers.length; i += 2) {
      try {
        appendField(fields, headers[i], headers[i + 1]);
      } catch (error) {
        process.nextTick(reportUncaughtException, error);
      }
    }
  }
  return fields;
}

function isSameList(value: unknown, list: unknown[]) {
  if (!$isJSArray(value) || value.length !== list.length) return false;
  for (let i = 0; i < list.length; i++) {
    if (value[i] !== list[i]) return false;
  }
  return true;
}

/** Returns the fields to send if they are not `fields` any more. */
function publishCreate(request: Request, fields: string[]) {
  const fixed = readFields(request, fields);
  if (!onCreate.hasSubscribers) return;

  const { host, reset, upgrade } = request;
  const before = ArrayPrototypeSlice.$call(request.headers);
  onCreate.publish({ request });

  const { host: newHost, headers } = request;
  const closes = request.reset === true && !reset && upgrade === null;
  if (closes || newHost !== host || !isSameList(headers, before)) {
    return writeFields(fixed, newHost, closes, headers);
  }
}

function familyOf(address: string | undefined) {
  return address === undefined ? undefined : isIP(address) === 6 ? "IPv6" : "IPv4";
}

/** What there is to know of a socket that has no net.Socket. */
class Socket {
  remoteAddress: string | undefined;
  remoteFamily: string | undefined;
  remotePort: number | undefined;
  localAddress: string | undefined;
  localFamily: string | undefined;
  localPort: number | undefined;
  _host: string | null;
  declare encrypted?: true;
  declare servername?: string | false;
  declare alpnProtocol?: string;

  constructor(
    { protocol, hostname, version }: ConnectParams,
    remoteAddress: string | undefined,
    remotePort: number | undefined,
    localAddress: string | undefined,
    localPort: number | undefined,
  ) {
    const name = isIP(hostname) ? null : hostname;
    this.remoteAddress = remoteAddress;
    this.remoteFamily = familyOf(remoteAddress);
    this.remotePort = remotePort;
    this.localAddress = localAddress;
    this.localFamily = familyOf(localAddress);
    this.localPort = localPort;
    this._host = name;
    if (protocol === "https:") {
      this.encrypted = true;
      this.servername = name ?? false;
      this.alpnProtocol = version === "h1" ? "http/1.1" : version;
    }
  }

  address() {
    const { localAddress: address, localFamily: family, localPort: port } = this;
    return address === undefined ? {} : { address, family, port };
  }
}

type ConnectParams = ReturnType<typeof makeConnectParams>;

function makeConnectParams(origin: string, servername: string | null, version?: string) {
  const colon = StringPrototypeIndexOf.$call(origin, ":");
  const host: string = StringPrototypeSlice.$call(origin, colon + 3);
  return {
    host,
    hostname: getHostname(host),
    protocol: StringPrototypeSlice.$call(origin, 0, colon + 1) as string,
    port: StringPrototypeSlice.$call(host, endOfHostname(host) + 1) as string,
    version,
    servername,
    localAddress: null,
  };
}

function publishError(request: Request, error: unknown) {
  if (onError.hasSubscribers) onError.publish({ request, error });
  request.aborted = true;
}

// Not at once: a subscriber may be the one to abort, ahead of others that have yet to hear of the request.
function publishAbort(request: Request, reason: unknown) {
  queueMicrotask(() => publishError(request, reason));
}

/** Returns what native code reports the steps of a request to, and those of the requests that it is redirected to. */
function traceRequests() {
  let request: Request;
  let origin: string;
  let servername: string | null;
  let hasBody = false;
  let isConnecting = false;
  let isBodySent = false;
  let isOver = false;

  return (event: RequestEvent, a: any, b: any, c: any, d: any, e: any, f: any) => {
    switch (event) {
      case RequestEvent.WantedChunks:
        return (onBodyChunkSent.hasSubscribers ? 1 : 0) | (onBodyChunkReceived.hasSubscribers ? 2 : 0);
      case RequestEvent.Create: {
        isConnecting = isBodySent = isOver = false;
        request = new Request(a, (origin = b), c, (hasBody = e), f);
        const fields = publishCreate(request, d);
        servername = request.servername;
        return fields;
      }
    }

    if (isOver) return;

    switch (event) {
      case RequestEvent.Connecting:
        isConnecting = true;
        if (onBeforeConnect.hasSubscribers) {
          onBeforeConnect.publish({ connectParams: makeConnectParams(origin, servername), connector: undefined });
        }
        break;
      case RequestEvent.HeadSent: {
        const wasConnecting = isConnecting;
        isConnecting = false;
        if (!onConnected.hasSubscribers && !onSendHeaders.hasSubscribers) break;
        const connectParams = makeConnectParams(origin, servername, `h${b}`);
        const socket = new Socket(connectParams, c, d, e, f);
        if (wasConnecting && onConnected.hasSubscribers) {
          onConnected.publish({ connectParams, connector: undefined, socket });
        }
        if (onSendHeaders.hasSubscribers) onSendHeaders.publish({ request, headers: a, socket });
        break;
      }
      case RequestEvent.BodyChunkSent:
        // The stream of a request that was redirected may still be writing.
        if (hasBody) onBodyChunkSent.publish({ request, chunk: a });
        break;
      case RequestEvent.BodySent:
        // `a`: according to that stream.
        if (isBodySent || (a && !hasBody)) break;
        isBodySent = true;
        if (onBodySent.hasSubscribers) onBodySent.publish({ request });
        break;
      case RequestEvent.ResponseHead:
        if (onHeaders.hasSubscribers) {
          onHeaders.publish({ request, response: { statusCode: a, headers: c, statusText: b } });
        }
        break;
      case RequestEvent.BodyChunkReceived:
        if (onBodyChunkReceived.hasSubscribers) onBodyChunkReceived.publish({ request, chunk: a });
        break;
      case RequestEvent.ResponseEnd:
        isOver = request.completed = true;
        if (onTrailers.hasSubscribers) onTrailers.publish({ request, trailers: [] });
        break;
      case RequestEvent.Error:
        isOver = true;
        // `b`: the caller gave up.
        if (isConnecting && !b && onConnectError.hasSubscribers) {
          const connectParams = makeConnectParams(origin, servername);
          onConnectError.publish({ connectParams, connector: undefined, error: a });
        }
        publishError(request, a);
        break;
      case RequestEvent.Abort:
        isOver = true;
        publishAbort(request, a);
        break;
    }
  };
}

function joinFields(fields: string[]) {
  const headers = {};
  for (let i = 0; i < fields.length; i += 2) {
    const name = StringPrototypeToLowerCase.$call(fields[i]);
    const value = fields[i + 1];
    $putByValDirect(headers, name, ObjectHasOwn(headers, name) ? `${headers[name]}, ${value}` : value);
  }
  return headers;
}

function publishWebSocketEvent(event: WebSocketEvent, websocket: WebSocket, a: any, b: any, c: any, d: any, e: any) {
  switch (event) {
    case WebSocketEvent.Open:
      if (onOpen.hasSubscribers) {
        onOpen.publish({
          address: d === undefined ? {} : { address: d, family: familyOf(d), port: e },
          protocol: websocket.protocol,
          extensions: websocket.extensions,
          websocket,
          handshakeResponse: { status: a, statusText: b, headers: joinFields(c) },
        });
      }
      break;
    case WebSocketEvent.Close:
      onClose.publish({ websocket, code: a, reason: b });
      break;
    case WebSocketEvent.SocketError:
      if (onSocketError.hasSubscribers) {
        const { errno, code } = a;
        onSocketError.publish(ObjectAssign(new SafeError(`${b} ${code}`), { errno, code, syscall: b }));
      }
      break;
    case WebSocketEvent.TLSError:
      if (onSocketError.hasSubscribers) {
        const error = require("internal/tls").tlsHandshakeError({ code: "EPROTO", reason: a });
        // BoringSSL's name for a close_notify during a renegotiation.
        if (error.code !== "ERR_SSL_SSL_HANDSHAKE_FAILURE") onSocketError.publish(error);
      }
      break;
    case WebSocketEvent.Ping:
      onPing.publish({ payload: a, websocket });
      break;
    case WebSocketEvent.Pong:
      onPong.publish({ payload: a, websocket });
      break;
  }
}

export default {
  requestHook() {
    return onBeforeConnect.hasSubscribers ||
      onConnected.hasSubscribers ||
      onConnectError.hasSubscribers ||
      onSendHeaders.hasSubscribers ||
      onCreate.hasSubscribers ||
      onBodySent.hasSubscribers ||
      onBodyChunkSent.hasSubscribers ||
      onBodyChunkReceived.hasSubscribers ||
      onHeaders.hasSubscribers ||
      onTrailers.hasSubscribers ||
      onError.hasSubscribers
      ? traceRequests
      : undefined;
  },
  webSocketHook() {
    return onOpen.hasSubscribers ||
      onClose.hasSubscribers ||
      onSocketError.hasSubscribers ||
      onPing.hasSubscribers ||
      onPong.hasSubscribers
      ? publishWebSocketEvent
      : undefined;
  },
};
