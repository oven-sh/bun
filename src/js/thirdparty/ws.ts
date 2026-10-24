// Hardcoded module "ws"
// Implements the https://github.com/websockets/ws API on top of Bun's native WebSocket client and server sockets.
// lib/websocket.js, websocket-server.js, event-target.js, stream.js, extension.js and subprotocol.js are
// ported from ws 8.22.0 (MIT). Framing (upstream's Sender and Receiver) is native.

const EventEmitter = require("node:events");

const {
  createWebSocket,
  createWebSocketOverStream,
  detach,
  feed,
  remoteAddress,
  sendFrame: clientSendFrame,
  setRef,
  streamClosed,
} = $cpp("JSWebSocket.cpp", "createWebSocketBindingForWs") as NativeClientBinding;
const upgradeWebSocket = $bindgen("node_http_binding.bind.ts", "upgradeNodeHTTPResponseToWebSocket") as (
  response: unknown,
  websocket: WebSocket,
  handlers: ServerHandlers,
  handshake: string,
  maxPayload: number,
  flags: number,
  deflate: NativeStreamOptions["deflate"],
) => NativeServer | undefined;
const serverSendFrame = $bindgen("node_http_binding.bind.ts", "sendWebSocketFrame") as (
  handle: NativeServer,
  data: string | Buffer | Blob,
  opcode: number,
  fin: boolean,
  compress: boolean,
) => number;

const BINARY_TYPES: BinaryType[] = ["nodebuffer", "arraybuffer", "fragments", "blob"];
const CLOSE_TIMEOUT = 30000;
const EMPTY_BUFFER = Buffer.alloc(0);
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const NOOP = () => {};

const kAborted = Symbol("kAborted");
const kCallbacks = Symbol("kCallbacks");
const kFirstFragment = Symbol("kFirstFragment");
const kForOnEventAttribute = Symbol("kIsForOnEventAttribute");
const kHandshake = Symbol("kHandshake");
const kFinalCallback = Symbol("kFinalCallback");
const kHandshakeTimer = Symbol("kHandshakeTimer");
const kIdentityError = Symbol("kIdentityError");
const kHeaders = Symbol("kHeaders");
const kInternalSocketData = Symbol.for("::bunternal::");
const kListener = Symbol("kListener");
const kNative = Symbol("kNative");
const kNativeOptions = Symbol("kNativeOptions");
const kOptions = Symbol("kOptions");
const kRemoveAbortListener = Symbol("kRemoveAbortListener");
const kProxyUrl = Symbol("kProxyUrl");
const kRequest = Symbol("kRequest");
const kResponse = Symbol("kResponse");
const kStatusCode = Symbol("status-code");
const kThrowSynchronously = Symbol("kThrowSynchronously");
const kTransport = Symbol("kTransport");
const kUrl = Symbol("kUrl");
const kWebSocket = Symbol("websocket");
const kWriteCallback = Symbol("kWriteCallback");

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

// Transport kinds. They determine what `websocket[kNative]` is and who owns the connection.
const NATIVE_CLIENT = 0; // The native client, which opened the connection itself. `_socket` is a ClientSocket.
const NATIVE_SERVER = 1; // A native server socket that adopted a node:http request's connection.
const STREAM = 2; // Only the native client's engine. It reads from and writes to `_socket`, which can be any Duplex.

const protocolVersions = [8, 13];
const readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
const subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;
const keyRegex = /^[+/0-9A-Za-z]{22}==$/;

type BinaryType = "nodebuffer" | "arraybuffer" | "fragments" | "blob";
type ReadyState = typeof CONNECTING | typeof OPEN | typeof CLOSING | typeof CLOSED;
type Transport = typeof NATIVE_CLIENT | typeof NATIVE_SERVER | typeof STREAM;
type Data = string | Buffer | ArrayBufferLike | Buffer[] | Blob;
type SendCallback = (err?: Error | null) => void;
// A send(), ping() or pong() callback that waits, with the async context of its call. `callback` is unset once it ran.
type WaitingCallback = { callback: SendCallback | undefined; asyncContext: unknown };
// Null-prototype literals are written `{ __proto__: null as never }` because TypeScript treats `__proto__` as a key.
type Dictionary<T> = { [key: string]: T };

// node/http.ts types these two as `any`.
type HttpModule = Omit<typeof import("../node/http").default, "IncomingMessage" | "STATUS_CODES"> & {
  IncomingMessage: new (socket: null) => HandshakeResponse;
  STATUS_CODES: { [code: number]: string };
};
type IncomingMessage = import("node:http").IncomingMessage;
interface HandshakeResponse extends IncomingMessage {
  _addHeaderLines(headers: string[], n: number): void;
  [kRequest]?: ClientRequest;
}
type HeaderValue = import("node:http").OutgoingHttpHeader;
type HttpHeaders = import("node:http").OutgoingHttpHeaders;
type HttpAgent = import("node:http").Agent;
type HttpAgentOptions = import("node:http").AgentOptions;
type HttpServer = import("node:http").Server;
type NodeClientRequest = import("node:http").ClientRequest;
type HttpsRequestOptions = import("node:https").RequestOptions;
type NetSocket = import("node:net").Socket;
type Duplex = import("node:stream").Duplex;

interface SendOptions {
  binary?: boolean;
  compress?: boolean;
  fin?: boolean;
  mask?: boolean;
}

type ListenerFunction = (this: WebSocket, event: Event) => void;
type Listener = ListenerFunction | { handleEvent(event: Event): void };

interface ListenerOptions {
  once?: boolean;
  [kForOnEventAttribute]?: boolean;
}

// An entry in `websocket.listeners()`: a plain `on()` listener or an addEventListener() wrapper.
interface EmitterListener {
  (this: WebSocket, ...args: any[]): void;
  [kForOnEventAttribute]?: boolean;
  [kListener]?: Listener;
}

type ExtensionParams = Dictionary<(string | true)[]>;
type ExtensionOffers = Dictionary<ExtensionParams[]>;
type ExtensionParamValue = string | number | true;
type FormattedParams = Dictionary<ExtensionParamValue | ExtensionParamValue[]>;

type DeflateParams = {
  client_max_window_bits?: number | true;
  client_no_context_takeover?: true;
  server_max_window_bits?: number;
  server_no_context_takeover?: true;
};

interface PerMessageDeflateOptions {
  clientMaxWindowBits?: boolean | number;
  clientNoContextTakeover?: boolean;
  concurrencyLimit?: number;
  isServer?: boolean;
  serverMaxWindowBits?: boolean | number;
  serverNoContextTakeover?: boolean;
  threshold?: number;
  zlibDeflateOptions?: import("node:zlib").ZlibOptions;
  zlibInflateOptions?: import("node:zlib").ZlibOptions;
}

type Extensions = { [extensionName]?: PerMessageDeflate };

interface NativeError extends Error {
  code?: string;
  $detail?: string;
}

interface ReceiverError extends Error {
  code?: string;
  [kStatusCode]?: number;
}

interface ConnectError extends NodeJS.ErrnoException {
  address?: string;
  hostname?: string;
  port?: number;
}

type NativeClient = globalThis.WebSocket;
type NativeServer = Bun.ServerWebSocket<WebSocket>;

interface NativeTlsOptions {
  __proto__?: object | null;
  servername?: string;
  [option: string]: unknown;
}

interface ProxyOptions {
  url: string | URL;
  headers?: HttpHeaders | globalThis.Headers;
  tls?: NativeTlsOptions;
}
type ProxyOption = string | URL | ProxyOptions;

interface NativeClientOptions {
  __proto__: null;
  protocols: string[];
  headers: Dictionary<HeaderValue> | undefined;
  maxPayload: number;
  autoPong: boolean;
  skipUTF8Validation: boolean;
  extensions: string | undefined;
  proxy?: ProxyOption;
  tls?: NativeTlsOptions;
}

interface NativeStreamOptions {
  isServer: boolean;
  url: string;
  protocol: string;
  extensions: string;
  maxPayload: number;
  autoPong: boolean;
  skipUTF8Validation: boolean;
  deflate:
    | {
        serverNoContextTakeover: boolean;
        clientNoContextTakeover: boolean;
        serverMaxWindowBits: number;
        clientMaxWindowBits: number;
      }
    | undefined;
}

interface NativeClientBinding {
  createWebSocket(url: string, options: NativeClientOptions, owner: WebSocket, handlers: ClientHandlers): NativeClient;
  createWebSocketOverStream(options: NativeStreamOptions, owner: WebSocket, handlers: ClientHandlers): NativeClient;
  detach(ws: NativeClient): void;
  feed(ws: NativeClient, chunk: Uint8Array): void;
  streamClosed(ws: NativeClient): void;
  sendFrame(
    ws: NativeClient,
    data: string | ArrayBufferView | ArrayBuffer | Blob,
    opcode: number,
    fin: boolean,
    compress: boolean,
    // False if the connection has ended, so nothing was sent. Its 'close' is queued behind the current task.
  ): false | undefined;
  setRef(ws: NativeClient, ref: boolean): void;
  remoteAddress(ws: NativeClient): { address: string; family: "IPv4" | "IPv6"; port: number } | undefined;
}

interface ServerHandlers {
  message(this: WebSocket, data: Buffer, isBinary: boolean): void;
  ping(this: WebSocket, data: Buffer): void;
  pong(this: WebSocket, data: Buffer): void;
  drain(this: WebSocket): void;
  close(this: WebSocket, code: number, reason: Buffer): void;
}

interface ClientHandlers extends Omit<ServerHandlers, "close"> {
  // Returns an object to accept a 101. The native client doesn't validate the response itself.
  handshake(
    this: WebSocket,
    statusCode: number,
    statusMessage: string,
    rawHeaders: string[],
    isUpgrade: boolean,
  ): Pick<NativeStreamOptions, "deflate"> | undefined;
  body(this: WebSocket, chunk: Buffer | null, aborted: boolean, reset: boolean): void;
  open(this: WebSocket): void;
  error(this: WebSocket, error: NativeError, viaProxy: boolean): void;
  conclude(this: WebSocket, code: number, reason: string): void;
  close(this: WebSocket): void;
  write(this: WebSocket, chunk: Buffer): void;
  end(this: WebSocket): void;
  destroy(this: WebSocket): void;
}

// The socket from a node:http 'upgrade' event (server or client).
interface ServerSocket extends NetSocket {
  authorized?: boolean;
  encrypted?: boolean;
  _httpMessage?: import("node:http").ServerResponse | null;
  [kInternalSocketData]?: unknown;
  [kWebSocket]?: WebSocket;
}

interface ServerRequest extends IncomingMessage {
  socket: ServerSocket;
  url: string;
  [internal: symbol]: unknown;
}

interface SetSocketOptions {
  maxPayload: number;
  skipUTF8Validation: boolean;
  [kHandshake]: string;
  [kResponse]: unknown;
}

// An `http.Agent` or a third-party proxy agent. Proxy agents store the proxy URL and headers in these fields.
interface Agent extends HttpAgent {
  addRequest?: unknown;
  connectOpts?: AgentConnectOptions;
  proxyRequestOptions?: AgentConnectOptions;
  createSocket?: unknown;
  options: AgentConnectOptions;
  proxy?: string | URL;
  proxyHeaders?: HttpHeaders | (() => HttpHeaders);
}

interface AgentConnectOptions extends HttpAgentOptions {
  headers?: HttpHeaders;
  proxy?: string | URL;
}

interface ClientOptions extends Omit<HttpsRequestOptions, "agent" | "headers" | "host" | "path" | "port"> {
  secureContext?: import("node:tls").SecureContext;
  agent?: Agent | boolean;
  allowSynchronousEvents?: boolean;
  autoPong?: boolean;
  closeTimeout?: number;
  finishRequest?(req: HandshakeRequest, websocket: WebSocket): void;
  followRedirects?: boolean;
  generateMask?(mask: Buffer): void;
  handshakeTimeout?: number;
  headers?: HttpHeaders;
  host?: string;
  maxPayload?: number;
  maxRedirects?: number;
  origin?: string;
  path?: string;
  perMessageDeflate?: boolean | PerMessageDeflateOptions;
  port?: number | string;
  protocols?: string | string[];
  protocolVersion?: number;
  proxy?: ProxyOption;
  skipUTF8Validation?: boolean;
  tls?: NativeTlsOptions;
}

type ClientDefaults =
  | "allowSynchronousEvents"
  | "autoPong"
  | "closeTimeout"
  | "followRedirects"
  | "maxPayload"
  | "maxRedirects"
  | "perMessageDeflate"
  | "protocolVersion"
  | "skipUTF8Validation";
type ResolvedClientOptions = ClientOptions & Required<Pick<ClientOptions, ClientDefaults>> & { __proto__: null };

// A real `http.request()` request, used when the native client can't make the connection.
interface HttpClientRequest extends NodeClientRequest {
  [kAborted]: boolean;
  [kOptions]: RequestState;
  [kWebSocket]: WebSocket;
}

type HandshakeRequest = ClientRequest | HttpClientRequest;

// State from the initAsClient() call that created a request. Used to validate the response and follow redirects.
interface RequestState {
  opts: ResolvedClientOptions;
  address: string | URL;
  protocols: string[];
  options: ClientOptions | undefined;
  protocolSet: Set<string>;
  perMessageDeflate: PerMessageDeflate | undefined;
}

interface VerifyClientInfo {
  origin: string | string[] | undefined;
  secure: boolean;
  req: ServerRequest;
}

interface VerifyClient {
  (info: VerifyClientInfo): boolean;
  (
    info: VerifyClientInfo,
    callback: (verified: boolean, code?: number, message?: string, headers?: HttpHeaders) => void,
  ): void;
}

interface ServerOptions {
  allowSynchronousEvents?: boolean;
  autoPong?: boolean;
  backlog?: number | null;
  clientTracking?: boolean;
  closeTimeout?: number;
  handleProtocols?: ((protocols: Set<string>, request: ServerRequest) => string | false) | null;
  host?: string | null;
  maxPayload?: number;
  noServer?: boolean;
  path?: string | null;
  perMessageDeflate?: boolean | PerMessageDeflateOptions;
  port?: number | null;
  server?: HttpServer | null;
  skipUTF8Validation?: boolean;
  verifyClient?: VerifyClient | null;
  WebSocket?: typeof WebSocket;
}

type UpgradeCallback = (ws: WebSocket, req: ServerRequest) => void;

interface WebSocketDuplex extends Duplex {
  _readableState: { endEmitted: boolean; objectMode: boolean };
  _writableState: { finished: boolean };
}

// node:http is almost the entire cost of require("ws"); load it on first use.
let http: HttpModule | undefined;
let kHeaderSource: symbol | undefined;
let kClosedWithUnsentData: symbol | undefined;
let kHasQueuedReads: symbol | undefined;
let kRememberPeer: symbol | undefined;
function lazyHttp(): HttpModule {
  return (http ??= require("node:http"));
}

// prettier-ignore
const tokenChars = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 0 - 15
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 16 - 31
  0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, // 32 - 47
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, // 48 - 63
  0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 64 - 79
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, // 80 - 95
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, // 96 - 111
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0 // 112 - 127
];

function isValidStatusCode(code: number): boolean {
  return (
    (code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) || (code >= 3000 && code <= 4999)
  );
}

function isBlob(value: unknown): value is Blob {
  return typeof value === "object" && value instanceof Blob;
}

function toBuffer(data: any): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof SharedArrayBuffer) return Buffer.from(new Uint8Array(data));
  return Buffer.from(data);
}

function toArrayBuffer(buf: Buffer): ArrayBufferLike {
  if (buf.length === buf.buffer.byteLength) return buf.buffer;
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}

//
// lib/subprotocol.js
//

function subprotocolParse(header: string): Set<string> {
  const protocols = new Set<string>();
  let start = -1;
  let end = -1;
  let i = 0;

  for (i; i < header.length; i++) {
    const code = header.charCodeAt(i);

    if (end === -1 && tokenChars[code] === 1) {
      if (start === -1) start = i;
    } else if (i !== 0 && (code === 0x20 /* ' ' */ || code === 0x09) /* '\t' */) {
      if (end === -1 && start !== -1) end = i;
    } else if (code === 0x2c /* ',' */) {
      if (start === -1) {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }

      if (end === -1) end = i;

      const protocol = header.slice(start, end);

      if (protocols.has(protocol)) {
        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
      }

      protocols.add(protocol);
      start = end = -1;
    } else {
      throw new SyntaxError(`Unexpected character at index ${i}`);
    }
  }

  if (start === -1 || end !== -1) {
    throw new SyntaxError("Unexpected end of input");
  }

  const protocol = header.slice(start, i);

  if (protocols.has(protocol)) {
    throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
  }

  protocols.add(protocol);
  return protocols;
}

//
// lib/extension.js
//

function extensionPush<T>(dest: Dictionary<T[]>, name: string, elem: T): void {
  if (dest[name] === undefined) dest[name] = [elem];
  else dest[name].push(elem);
}

function extensionParse(header: string): ExtensionOffers {
  const offers: ExtensionOffers = Object.create(null);
  let params: ExtensionParams = Object.create(null);
  let mustUnescape = false;
  let isEscaping = false;
  let inQuotes = false;
  let extensionName: string | undefined;
  let paramName: string | undefined;
  let start = -1;
  let code = -1;
  let end = -1;
  let i = 0;

  for (; i < header.length; i++) {
    code = header.charCodeAt(i);

    if (extensionName === undefined) {
      if (end === -1 && tokenChars[code] === 1) {
        if (start === -1) start = i;
      } else if (i !== 0 && (code === 0x20 /* ' ' */ || code === 0x09) /* '\t' */) {
        if (end === -1 && start !== -1) end = i;
      } else if (code === 0x3b /* ';' */ || code === 0x2c /* ',' */) {
        if (start === -1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }

        if (end === -1) end = i;
        const name = header.slice(start, end);
        if (code === 0x2c) {
          extensionPush(offers, name, params);
          params = Object.create(null);
        } else {
          extensionName = name;
        }

        start = end = -1;
      } else {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }
    } else if (paramName === undefined) {
      if (end === -1 && tokenChars[code] === 1) {
        if (start === -1) start = i;
      } else if (code === 0x20 || code === 0x09) {
        if (end === -1 && start !== -1) end = i;
      } else if (code === 0x3b || code === 0x2c) {
        if (start === -1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }

        if (end === -1) end = i;
        extensionPush(params, header.slice(start, end), true);
        if (code === 0x2c) {
          extensionPush(offers, extensionName, params);
          params = Object.create(null);
          extensionName = undefined;
        }

        start = end = -1;
      } else if (code === 0x3d /* '=' */ && start !== -1 && end === -1) {
        paramName = header.slice(start, i);
        start = end = -1;
      } else {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }
    } else {
      // The value of a quoted-string after unescaping must conform to the token ABNF.
      if (isEscaping) {
        if (tokenChars[code] !== 1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
        if (start === -1) start = i;
        else if (!mustUnescape) mustUnescape = true;
        isEscaping = false;
      } else if (inQuotes) {
        if (tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (code === 0x22 /* '"' */ && start !== -1) {
          inQuotes = false;
          end = i;
        } else if (code === 0x5c /* '\' */) {
          isEscaping = true;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      } else if (code === 0x22 && header.charCodeAt(i - 1) === 0x3d) {
        inQuotes = true;
      } else if (end === -1 && tokenChars[code] === 1) {
        if (start === -1) start = i;
      } else if (start !== -1 && (code === 0x20 || code === 0x09)) {
        if (end === -1) end = i;
      } else if (code === 0x3b || code === 0x2c) {
        if (start === -1) {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }

        if (end === -1) end = i;
        let value = header.slice(start, end);
        if (mustUnescape) {
          value = value.replace(/\\/g, "");
          mustUnescape = false;
        }
        extensionPush(params, paramName, value);
        if (code === 0x2c) {
          extensionPush(offers, extensionName, params);
          params = Object.create(null);
          extensionName = undefined;
        }

        paramName = undefined;
        start = end = -1;
      } else {
        throw new SyntaxError(`Unexpected character at index ${i}`);
      }
    }
  }

  if (start === -1 || inQuotes || code === 0x20 || code === 0x09) {
    throw new SyntaxError("Unexpected end of input");
  }

  if (end === -1) end = i;
  const token = header.slice(start, end);
  if (extensionName === undefined) {
    extensionPush(offers, token, params);
  } else {
    if (paramName === undefined) {
      extensionPush(params, token, true);
    } else if (mustUnescape) {
      extensionPush(params, paramName, token.replace(/\\/g, ""));
    } else {
      extensionPush(params, paramName, token);
    }
    extensionPush(offers, extensionName, params);
  }

  return offers;
}

function extensionFormat(extensions: Dictionary<FormattedParams | FormattedParams[]>): string {
  return Object.keys(extensions)
    .map(extension => {
      let configurations = extensions[extension];
      if (!$isArray(configurations)) configurations = [configurations];
      return configurations
        .map(params => {
          return [extension]
            .concat(
              Object.keys(params).map(k => {
                let values = params[k];
                if (!$isArray(values)) values = [values];
                return values.map(v => (v === true ? k : `${k}=${v}`)).join("; ");
              }),
            )
            .join("; ");
        })
        .join(", ");
    })
    .join(", ");
}

//
// The negotiation half of lib/permessage-deflate.js. Compression itself is native.
//

const extensionName = "permessage-deflate";

class PerMessageDeflate {
  declare _isServer: boolean;
  declare _options: PerMessageDeflateOptions;
  declare _threshold: number;
  declare params: DeflateParams | null;

  constructor(options?: PerMessageDeflateOptions) {
    this._options = options || {};
    this._threshold = this._options.threshold !== undefined ? this._options.threshold : 1024;
    this._isServer = !!this._options.isServer;
    this.params = null;
  }

  static get extensionName(): typeof extensionName {
    return extensionName;
  }

  offer(): FormattedParams {
    const params: FormattedParams = {};
    const { serverNoContextTakeover, clientNoContextTakeover, serverMaxWindowBits, clientMaxWindowBits } =
      this._options;

    if (serverNoContextTakeover) {
      params.server_no_context_takeover = true;
    }
    if (clientNoContextTakeover) {
      params.client_no_context_takeover = true;
    }
    if (serverMaxWindowBits) {
      params.server_max_window_bits = serverMaxWindowBits;
    }
    if (clientMaxWindowBits) {
      params.client_max_window_bits = clientMaxWindowBits;
    } else if (clientMaxWindowBits == null) {
      params.client_max_window_bits = true;
    }

    return params;
  }

  accept(configurations: ExtensionParams[] | DeflateParams[]): DeflateParams {
    configurations = this.normalizeParams(configurations as ExtensionParams[]);

    this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);

    return this.params;
  }

  cleanup(): void {}

  acceptAsServer(offers: DeflateParams[]): DeflateParams {
    const opts = this._options;
    const accepted = offers.find(params => {
      if (
        (opts.serverNoContextTakeover === false && params.server_no_context_takeover) ||
        (params.server_max_window_bits &&
          (opts.serverMaxWindowBits === false ||
            (typeof opts.serverMaxWindowBits === "number" &&
              opts.serverMaxWindowBits > params.server_max_window_bits))) ||
        (typeof opts.clientMaxWindowBits === "number" &&
          (typeof params.client_max_window_bits === "number"
            ? opts.clientMaxWindowBits > params.client_max_window_bits
            : !params.client_max_window_bits))
      ) {
        return false;
      }

      return true;
    });

    if (!accepted) {
      throw new Error("None of the extension offers can be accepted");
    }

    if (opts.serverNoContextTakeover) {
      accepted.server_no_context_takeover = true;
    }
    if (opts.clientNoContextTakeover) {
      accepted.client_no_context_takeover = true;
    }
    const { serverMaxWindowBits, clientMaxWindowBits } = opts;

    if (typeof serverMaxWindowBits === "number") {
      accepted.server_max_window_bits = serverMaxWindowBits;
    }
    if (typeof clientMaxWindowBits === "number") {
      accepted.client_max_window_bits = clientMaxWindowBits;
    } else if (accepted.client_max_window_bits === true || clientMaxWindowBits === false) {
      delete accepted.client_max_window_bits;
    }

    return accepted;
  }

  acceptAsClient(response: DeflateParams[]): DeflateParams {
    const params = response[0];
    const { clientNoContextTakeover, clientMaxWindowBits } = this._options;

    if (clientNoContextTakeover === false && params.client_no_context_takeover) {
      throw new Error('Unexpected parameter "client_no_context_takeover"');
    }

    if (!params.client_max_window_bits) {
      if (typeof clientMaxWindowBits === "number") {
        params.client_max_window_bits = clientMaxWindowBits;
      }
    } else if (
      clientMaxWindowBits === false ||
      (typeof clientMaxWindowBits === "number" && (params.client_max_window_bits as number) > clientMaxWindowBits)
    ) {
      throw new Error('Unexpected or invalid parameter "client_max_window_bits"');
    }

    return params;
  }

  normalizeParams(configurations: ExtensionParams[]): DeflateParams[] {
    configurations.forEach(params => {
      Object.keys(params).forEach(key => {
        let value: (string | true)[] | ExtensionParamValue = params[key];

        if (value.length > 1) {
          throw new Error(`Parameter "${key}" must have only a single value`);
        }

        value = value[0];

        if (key === "client_max_window_bits") {
          if (value !== true) {
            const num = +value;
            if (!Number.isInteger(num) || num < 8 || num > 15) {
              throw new TypeError(`Invalid value for parameter "${key}": ${value}`);
            }
            value = num;
          } else if (!this._isServer) {
            throw new TypeError(`Invalid value for parameter "${key}": ${value}`);
          }
        } else if (key === "server_max_window_bits") {
          const num = +value;
          if (!Number.isInteger(num) || num < 8 || num > 15) {
            throw new TypeError(`Invalid value for parameter "${key}": ${value}`);
          }
          value = num;
        } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
          if (value !== true) {
            throw new TypeError(`Invalid value for parameter "${key}": ${value}`);
          }
        } else {
          throw new Error(`Unknown parameter "${key}"`);
        }

        (params as FormattedParams)[key] = value;
      });
    });

    return configurations as DeflateParams[];
  }
}

//
// lib/event-target.js
//

const kCode = Symbol("kCode");
const kData = Symbol("kData");
const kError = Symbol("kError");
const kMessage = Symbol("kMessage");
const kReason = Symbol("kReason");
const kTarget = Symbol("kTarget");
const kType = Symbol("kType");
const kWasClean = Symbol("kWasClean");

class Event {
  declare [kTarget]: WebSocket | null;
  declare [kType]: string;

  constructor(type: string) {
    this[kTarget] = null;
    this[kType] = type;
  }

  get target(): WebSocket | null {
    return this[kTarget];
  }

  get type(): string {
    return this[kType];
  }
}

Object.defineProperty(Event.prototype, "target", { enumerable: true });
Object.defineProperty(Event.prototype, "type", { enumerable: true });

class CloseEvent extends Event {
  declare [kCode]: number;
  declare [kReason]: string;
  declare [kWasClean]: boolean;

  constructor(type: string, options: { code?: number; reason?: string; wasClean?: boolean } = {}) {
    super(type);

    this[kCode] = options.code === undefined ? 0 : options.code;
    this[kReason] = options.reason === undefined ? "" : options.reason;
    this[kWasClean] = options.wasClean === undefined ? false : options.wasClean;
  }

  get code(): number {
    return this[kCode];
  }

  get reason(): string {
    return this[kReason];
  }

  get wasClean(): boolean {
    return this[kWasClean];
  }
}

Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });

class ErrorEvent extends Event {
  declare [kError]: unknown;
  declare [kMessage]: string;

  constructor(type: string, options: { error?: unknown; message?: string } = {}) {
    super(type);

    this[kError] = options.error === undefined ? null : options.error;
    this[kMessage] = options.message === undefined ? "" : options.message;
  }

  get error(): unknown {
    return this[kError];
  }

  get message(): string {
    return this[kMessage];
  }
}

Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });

class MessageEvent extends Event {
  declare [kData]: Data | null;

  constructor(type: string, options: { data?: Data } = {}) {
    super(type);

    this[kData] = options.data === undefined ? null : options.data;
  }

  get data(): Data | null {
    return this[kData];
  }
}

Object.defineProperty(MessageEvent.prototype, "data", { enumerable: true });

function callListener(listener: Listener, thisArg: WebSocket, event: Event): void {
  const handleEvent = typeof listener === "object" && listener.handleEvent;

  if (handleEvent) {
    handleEvent.$call(listener, event);
  } else {
    (listener as ListenerFunction).$call(thisArg, event);
  }
}

function addEventListener(this: WebSocket, type: string, handler: Listener, options: ListenerOptions = {}): void {
  for (const listener of this.listeners(type)) {
    if (!options[kForOnEventAttribute] && listener[kListener] === handler && !listener[kForOnEventAttribute]) {
      return;
    }
  }

  let wrapper: EmitterListener;

  if (type === "message") {
    wrapper = function onMessage(data: Data, isBinary: boolean) {
      const event = new MessageEvent("message", {
        data: isBinary ? data : data.toString(),
      });

      event[kTarget] = this;
      callListener(handler, this, event);
    };
  } else if (type === "close") {
    wrapper = function onClose(code: number, message: Buffer) {
      const event = new CloseEvent("close", {
        code,
        reason: message.toString(),
        wasClean: this._closeFrameReceived && this._closeFrameSent,
      });

      event[kTarget] = this;
      callListener(handler, this, event);
    };
  } else if (type === "error") {
    wrapper = function onError(error: Error) {
      const event = new ErrorEvent("error", {
        error,
        message: error.message,
      });

      event[kTarget] = this;
      callListener(handler, this, event);
    };
  } else if (type === "open") {
    wrapper = function onOpen() {
      const event = new Event("open");

      event[kTarget] = this;
      callListener(handler, this, event);
    };
  } else if (type === "ping" || type === "pong") {
    // npm ws doesn't support these two, but Bun's `ws` always has.
    wrapper = function onControl(data: Buffer) {
      const event = new MessageEvent(type, { data });

      event[kTarget] = this;
      callListener(handler, this, event);
    };
  } else {
    return;
  }

  wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
  wrapper[kListener] = handler;

  if (options.once) {
    this.once(type, wrapper);
  } else {
    this.on(type, wrapper);
  }
}

function removeEventListener(this: WebSocket, type: string, handler: Listener): void {
  for (const listener of this.listeners(type)) {
    if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
      this.removeListener(type, listener);
      break;
    }
  }
}

//
// lib/websocket.js
//

class WebSocket extends EventEmitter {
  declare static readonly CONNECTING: typeof CONNECTING;
  declare static readonly OPEN: typeof OPEN;
  declare static readonly CLOSING: typeof CLOSING;
  declare static readonly CLOSED: typeof CLOSED;
  declare readonly CONNECTING: typeof CONNECTING;
  declare readonly OPEN: typeof OPEN;
  declare readonly CLOSING: typeof CLOSING;
  declare readonly CLOSED: typeof CLOSED;

  declare _autoPong: boolean | undefined;
  declare _binaryType: BinaryType;
  declare _bufferedAmount: number;
  declare _closeCode: number;
  declare _closeFrameReceived: boolean;
  declare _closeFrameSent: boolean;
  declare _closeMessage: Buffer;
  declare _closeTimeout: number | undefined;
  declare _closeTimer: Timer | null;
  declare _errorEmitted: boolean;
  declare _extensions: Extensions;
  declare _isServer: boolean;
  declare _originalHostOrSocketPath: string | undefined;
  declare _originalIpc: boolean | undefined;
  declare _originalSecure: boolean | undefined;
  declare _paused: boolean;
  declare _protocol: string;
  declare _readyState: ReadyState;
  declare _receiver: null;
  declare _redirects: number;
  declare _req: HandshakeRequest | null | undefined;
  declare _sender: null;
  declare _socket: ServerSocket | ClientSocket | null;
  declare _url: string | undefined;
  declare [kCallbacks]: WaitingCallback[] | null;
  declare [kFinalCallback]: (() => void) | undefined;
  declare [kFirstFragment]: boolean;
  declare [kHandshakeTimer]: Timer | undefined;
  declare [kIdentityError]: unknown;
  declare [kNative]: NativeClient | NativeServer | null;
  declare [kProxyUrl]: string | undefined;
  declare [kRequest]: ClientRequest | undefined;
  declare [kTransport]: Transport;
  declare [kWriteCallback]: WaitingCallback | undefined;

  declare onclose: ListenerFunction | null;
  declare onerror: ListenerFunction | null;
  declare onmessage: ListenerFunction | null;
  declare onopen: ListenerFunction | null;
  declare addEventListener: typeof addEventListener;
  declare removeEventListener: typeof removeEventListener;

  constructor(address: null, protocols: undefined, options: Pick<ServerOptions, "autoPong" | "closeTimeout">);
  constructor(address: string | URL, protocols?: string | string[] | ClientOptions, options?: ClientOptions);
  constructor(address: string | URL | null, protocols?: string | string[] | ClientOptions, options?: ClientOptions) {
    super();

    this._binaryType = BINARY_TYPES[0];
    this._bufferedAmount = 0;
    this._closeCode = 1006;
    this._closeFrameReceived = false;
    this._closeFrameSent = false;
    this._closeMessage = EMPTY_BUFFER;
    this._closeTimer = null;
    this._errorEmitted = false;
    this._extensions = {};
    this._paused = false;
    this._protocol = "";
    this._readyState = CONNECTING;
    this._receiver = null;
    this._sender = null;
    this._socket = null;
    this[kNative] = null;
    this[kCallbacks] = null;
    this[kFirstFragment] = true;
    this[kTransport] = NATIVE_CLIENT;
    this[kWriteCallback] = undefined;

    if (address !== null) {
      this._isServer = false;
      this._redirects = 0;

      if (protocols === undefined) {
        protocols = protocolsOption(options);
      } else if (!$isArray(protocols)) {
        if (typeof protocols === "object" && protocols !== null) {
          options = protocols;
          protocols = protocolsOption(options);
        } else {
          protocols = [protocols];
        }
      }

      initAsClient(this, address, protocols, options);
    } else {
      this._autoPong = options!.autoPong;
      this._closeTimeout = options!.closeTimeout;
      this._isServer = true;
    }
  }

  get binaryType(): BinaryType {
    return this._binaryType;
  }

  set binaryType(type: BinaryType) {
    if (!BINARY_TYPES.includes(type)) return;

    this._binaryType = type;
  }

  get bufferedAmount(): number {
    const native = this[kNative];
    if (native === null) return this._bufferedAmount;

    return this._bufferedAmount + nativeBufferedAmount(this);
  }

  get extensions(): string {
    return Object.keys(this._extensions).join();
  }

  get isPaused(): boolean {
    return this._paused;
  }

  get protocol(): string {
    return this._protocol;
  }

  get readyState(): ReadyState {
    return this._readyState;
  }

  get url(): string | undefined {
    return this._url;
  }

  // Sends `options[kHandshake]` and attaches `socket`. Returns false without sending anything if `socket` is a
  // node:http connection that can no longer be upgraded.
  setSocket(socket: ServerSocket, head: Buffer, options: SetSocketOptions): boolean {
    const maxPayload = Math.max(options.maxPayload | 0, 0);

    // node:http does this itself for an 'upgrade' listener, but handleUpgrade() can also be called from a 'request' one.
    if (this._isServer) socket[(kRememberPeer ??= require("internal/http").kRememberPeer as symbol)]?.();

    // The native server socket only sees data received after it adopts the connection. If handleUpgrade() was called
    // late, node:http may already have read frames into `head` or `socket`'s buffer, or be about to push them or the
    // peer's FIN into that buffer, so use the stream transport.
    if (
      options[kResponse] &&
      head.length === 0 &&
      socket.readableLength === 0 &&
      !socket[(kHasQueuedReads ??= require("internal/http").kHasQueuedReads as symbol)]
    ) {
      const native = upgradeWebSocket(
        options[kResponse],
        this,
        serverHandlers,
        options[kHandshake],
        maxPayload,
        (this._autoPong ? 1 : 0) | (options.skipUTF8Validation ? 2 : 0),
        nativeDeflateParams(this),
      );

      if (native === undefined) return false;

      this[kNative] = native;
      this[kTransport] = NATIVE_SERVER;
    } else {
      if (options[kHandshake]) socket.write(options[kHandshake]);

      this[kNative] = createWebSocketOverStream(
        {
          isServer: this._isServer,
          url: this._url || "",
          protocol: this._protocol,
          extensions: this.extensions,
          maxPayload,
          // The `ping` handler sends the pong instead, because the engine can't see the stream's backpressure.
          autoPong: false,
          skipUTF8Validation: !!options.skipUTF8Validation,
          deflate: nativeDeflateParams(this),
        },
        this,
        clientHandlers,
      );
      this[kTransport] = STREAM;
    }

    this._socket = socket;

    socket[kWebSocket] = this;

    if (socket.setTimeout) socket.setTimeout(0);

    socket.on("close", socketOnClose);
    socket.on("error", socketOnError);

    if (this[kTransport] === STREAM) {
      if (socket.setNoDelay) socket.setNoDelay();
      if (head.length > 0) socket.unshift(head);

      socket.on("data", socketOnData);
      socket.on("end", socketOnEnd);
    }

    this._readyState = OPEN;
    this.emit("open");
    return true;
  }

  emitClose(): void {
    this._readyState = CLOSED;
    // In npm ws the callbacks and 'close' come from separate events of the socket, so a callback that throws doesn't
    // skip 'close'.
    try {
      settleCallbacks(this, !wroteEverything(this));
    } finally {
      finishStream(this);
      this.emit("close", this._closeCode, this._closeMessage);
    }
  }

  close(code?: number, data?: string | Uint8Array): void {
    if (this.readyState === CLOSED) return;
    if (this.readyState === CONNECTING) {
      const msg = "WebSocket was closed before the connection was established";
      abortHandshake(this, this._req!, msg);
      return;
    }

    if (this.readyState === CLOSING) return;

    if (code === undefined) {
      data = undefined;
    } else if (typeof code !== "number" || !isValidStatusCode(code)) {
      throw new TypeError("First argument must be a valid error code number");
    } else if (data === undefined || !data.length) {
      data = undefined;
    } else {
      if (Buffer.byteLength(data) > 123) {
        throw new RangeError("The message must not be greater than 123 bytes");
      }

      if (typeof data !== "string") {
        if (!(data instanceof Uint8Array)) {
          throw new TypeError("Second argument must be a string or a Uint8Array");
        }
        data = toBuffer(data).toString();

        // Invalid UTF-8 was replaced with U+FFFD, which is three bytes, so check the length again.
        if (Buffer.byteLength(data) > 123) {
          throw new RangeError("The message must not be greater than 123 bytes");
        }
      }
    }

    // Update the state first. If `_socket` is an in-memory stream, the peer's reply can arrive during the call below.
    this._closeFrameSent = true;
    this._readyState = CLOSING;
    setCloseTimer(this);

    // On the native server socket, 1005 means a Close frame with no body.
    if (this[kTransport] === NATIVE_SERVER) this[kNative]!.close(code === undefined ? 1005 : code, data);
    else this[kNative]!.close(code, data);
  }

  pause(): void {
    if (this.readyState === CONNECTING || this.readyState === CLOSED) {
      return;
    }

    this._paused = true;
    if (this[kTransport] !== NATIVE_CLIENT) (this._socket as ServerSocket).pause();
    this[kNative]!.pause();
  }

  ping(data?: any, mask?: boolean | SendCallback, cb?: SendCallback): void {
    sendControl(this, 0x09, data, mask, cb);
  }

  pong(data?: any, mask?: boolean | SendCallback, cb?: SendCallback): void {
    sendControl(this, 0x0a, data, mask, cb);
  }

  resume(): void {
    if (this.readyState === CONNECTING || this.readyState === CLOSED) {
      return;
    }

    this._paused = false;
    if (this[kTransport] !== NATIVE_CLIENT) (this._socket as ServerSocket).resume();
    this[kNative]!.resume();
  }

  send(data: any, options?: SendOptions | SendCallback, cb?: SendCallback): void {
    if (this.readyState === CONNECTING) {
      throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
    }

    if (typeof options === "function") {
      cb = options;
      options = undefined;
    }

    if (typeof data === "number") data = data.toString();

    if (this.readyState !== OPEN) {
      sendAfterClose(this, data, cb);
      return;
    }

    let binary: boolean | undefined = typeof data !== "string";
    let compress: boolean | undefined = true;
    let fin: boolean | undefined = true;

    if ($isObject(options)) {
      if ("binary" in options) binary = options.binary;
      if ("compress" in options) compress = options.compress;
      if ("fin" in options) fin = options.fin;
    }

    if (!data) data = EMPTY_BUFFER;
    else if (typeof data !== "string" && !isBlob(data)) data = toBuffer(data);

    let opcode = binary ? 2 : 1;

    if (this[kFirstFragment]) {
      const perMessageDeflate = this._extensions[extensionName];

      if (!perMessageDeflate) {
        compress = false;
      } else if (
        compress &&
        perMessageDeflate.params![this._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]
      ) {
        const byteLength = typeof data === "string" ? Buffer.byteLength(data) : isBlob(data) ? data.size : data.length;
        compress = byteLength >= perMessageDeflate._threshold;
      }
    } else {
      compress = false;
      opcode = 0;
    }

    const transport = this[kTransport];

    // Sending a file-backed Blob throws. Nothing was sent in that case, so kFirstFragment must not change.
    if (transport === NATIVE_SERVER) {
      const status = serverSendFrame(this[kNative] as NativeServer, data, opcode, !!fin, !!compress);

      this[kFirstFragment] = !!fin;
      scheduleSendCallback(this, status === -1, cb);
    } else if (transport === NATIVE_CLIENT) {
      const sent = clientSendFrame(this[kNative] as NativeClient, data, opcode, !!fin, !!compress);
      this[kFirstFragment] = !!fin;
      scheduleSendCallback(this, sent === false || (this[kNative] as NativeClient).bufferedAmount !== 0, cb);
    } else {
      this[kWriteCallback] = cb ? waitingCallback(cb) : undefined;
      try {
        clientSendFrame(this[kNative] as NativeClient, data, opcode, !!fin, !!compress);
      } catch (err) {
        this[kWriteCallback] = undefined;
        throw err;
      }
      this[kFirstFragment] = !!fin;
      flushUnusedWriteCallback(this);
    }
  }

  terminate(): void {
    if (this.readyState === CLOSED) return;
    if (this.readyState === CONNECTING) {
      const msg = "WebSocket was closed before the connection was established";
      abortHandshake(this, this._req!, msg);
      return;
    }

    if (this[kNative] === null) return;

    this._readyState = CLOSING;
    destroySocket(this);
  }
}

for (let i = 0; i < readyStates.length; i++) {
  const descriptor = { enumerable: true, value: i };
  Object.defineProperty(WebSocket, readyStates[i], descriptor);
  Object.defineProperty(WebSocket.prototype, readyStates[i], descriptor);
}

["binaryType", "bufferedAmount", "extensions", "isPaused", "protocol", "readyState", "url"].forEach(property => {
  Object.defineProperty(WebSocket.prototype, property, { enumerable: true });
});

["open", "error", "close", "message"].forEach(method => {
  Object.defineProperty(WebSocket.prototype, `on${method}`, {
    configurable: true,
    enumerable: true,
    get(this: WebSocket): Listener | null | undefined {
      for (const listener of this.listeners(method)) {
        if (listener[kForOnEventAttribute]) return listener[kListener];
      }

      return null;
    },
    set(this: WebSocket, handler: ListenerFunction | null | undefined): void {
      for (const listener of this.listeners(method)) {
        if (listener[kForOnEventAttribute]) {
          this.removeListener(method, listener);
          break;
        }
      }

      if (typeof handler !== "function") return;

      this.addEventListener(method, handler, {
        [kForOnEventAttribute]: true,
      });
    },
  });
});

WebSocket.prototype.addEventListener = addEventListener;
WebSocket.prototype.removeEventListener = removeEventListener;

function protocolsOption(options: ClientOptions | undefined): string[] {
  const protocols = options?.protocols;

  if (protocols === undefined) return [];
  return $isArray(protocols) ? protocols : [protocols];
}

function sendControl(
  websocket: WebSocket,
  opcode: 0x09 | 0x0a,
  data: any,
  mask: boolean | SendCallback | undefined,
  cb: SendCallback | undefined,
): void {
  if (websocket.readyState === CONNECTING) {
    throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
  }

  if (typeof data === "function") {
    cb = data;
    data = mask = undefined;
  } else if (typeof mask === "function") {
    cb = mask;
    mask = undefined;
  }

  if (typeof data === "number") data = data.toString();

  if (websocket.readyState !== OPEN) {
    sendAfterClose(websocket, data, cb);
    return;
  }

  const native = websocket[kNative]!;
  const isStream = websocket[kTransport] === STREAM;

  if (!data) {
    data = undefined;
  } else {
    if (typeof data !== "string" && !isBlob(data)) data = toBuffer(data);

    const byteLength = typeof data === "string" ? Buffer.byteLength(data) : isBlob(data) ? data.size : data.length;

    if (byteLength > 125) {
      throw new RangeError("The data size must not be greater than 125 bytes");
    }
  }

  if (isStream) websocket[kWriteCallback] = cb ? waitingCallback(cb) : undefined;

  try {
    if (opcode === 0x09) native.ping(data);
    else native.pong(data);
  } catch (err) {
    // File-backed Blobs throw.
    websocket[kWriteCallback] = undefined;
    throw err;
  }

  if (isStream) flushUnusedWriteCallback(websocket);
  else scheduleSendCallback(websocket, endedNatively(websocket) || nativeBufferedAmount(websocket) !== 0, cb);
}

// The connection of a native client has ended, so it sends nothing. Its 'close' is queued behind the current task.
function endedNatively(websocket: WebSocket): boolean {
  return websocket[kTransport] === NATIVE_CLIENT && (websocket[kNative] as NativeClient).readyState !== OPEN;
}

function nativeBufferedAmount(websocket: WebSocket): number {
  switch (websocket[kTransport]) {
    case NATIVE_CLIENT:
      return (websocket[kNative] as NativeClient).bufferedAmount;
    case NATIVE_SERVER:
      return (websocket[kNative] as NativeServer).getBufferedAmount();
    default:
      return (websocket._socket as ServerSocket).writableLength;
  }
}

// A callback that has to wait runs from a drain or close event, which doesn't have the caller's AsyncLocalStorage
// context. That includes `socket.write()` callbacks on the stream transport.
function waitingCallback(callback: SendCallback): WaitingCallback {
  return { callback, asyncContext: $getInternalField($asyncContext, 0) };
}

function runWaitingCallback(entry: WaitingCallback, err: Error | null | undefined): void {
  const { callback, asyncContext } = entry;
  if (callback === undefined) return;

  entry.callback = undefined;
  // These are equal in every program without AsyncLocalStorage and Bun.ModuleGraph, which never loads the helper.
  if (asyncContext === $getInternalField($asyncContext, 0)) callback(err);
  else require("internal/async_context_frame").run(asyncContext, callback, undefined, err);
}

// A send callback runs once its frame has been written to the kernel, like a `socket.write()` callback.
function scheduleSendCallback(websocket: WebSocket, buffered: boolean, cb: SendCallback | undefined): void {
  if (buffered) {
    if (cb) (websocket[kCallbacks] ??= []).push(waitingCallback(cb));
    return;
  }

  // Nothing is buffered, so earlier frames were flushed too. Run their callbacks first.
  const queued = websocket[kCallbacks];
  if (queued !== null) {
    websocket[kCallbacks] = null;
    for (let i = 0; i < queued.length; i++) process.nextTick(runWaitingCallback, queued[i], null);
  }

  if (cb) process.nextTick(cb, null);
}

// If the engine wrote nothing, the `write` handler never ran and the callback is still set. Fail it.
function flushUnusedWriteCallback(websocket: WebSocket): void {
  const entry = websocket[kWriteCallback];
  if (entry === undefined) return;

  websocket[kWriteCallback] = undefined;
  process.nextTick(runWaitingCallback, entry, $ERR_STREAM_DESTROYED("write"));
}

function settleCallbacks(websocket: WebSocket, failed: boolean): void {
  const callbacks = websocket[kCallbacks];
  if (callbacks === null) return;

  websocket[kCallbacks] = null;
  runCallbacks(callbacks, 0, failed ? $ERR_STREAM_DESTROYED("write") : null);
}

// Once the closing handshake is done, uWS keeps writing what is queued but no longer reports a drain. So when the socket
// closes, callbacks can still be waiting for data that was written.
function wroteEverything(websocket: WebSocket): boolean {
  if (websocket[kTransport] !== NATIVE_SERVER) return false;

  kClosedWithUnsentData ??= require("internal/http").kClosedWithUnsentData as symbol;
  return websocket._socket![kClosedWithUnsentData] === false;
}

function runCallbacks(callbacks: WaitingCallback[], start: number, err: Error | null): void {
  let i = start;
  try {
    for (; i < callbacks.length; i++) runWaitingCallback(callbacks[i], err);
  } finally {
    // One of them threw. In node:stream each write has its own callback, so the rest still run.
    if (++i < callbacks.length) process.nextTick(runCallbacks, callbacks, i, err);
  }
}

function sendAfterClose(websocket: WebSocket, data: any, cb: SendCallback | undefined): void {
  if (data) {
    websocket._bufferedAmount += isBlob(data) ? data.size : toBuffer(data).length;
  }

  if (cb) {
    const err = new Error(
      `WebSocket is not open: readyState ${websocket.readyState} (${readyStates[websocket.readyState]})`,
    );
    process.nextTick(cb, err);
  }
}

function emitErrorAndClose(websocket: WebSocket, err: Error): void {
  websocket._readyState = CLOSING;
  websocket._errorEmitted = true;
  websocket.emit("error", err);
  websocket.emitClose();
}

function emitError(websocket: WebSocket, err: Error): void {
  websocket._errorEmitted = true;
  websocket.emit("error", err);
}

function emitWebSocketClose(websocket: WebSocket): void {
  websocket.emitClose();
}

function abortHandshake(websocket: WebSocket, req: HandshakeRequest, message: string, upgraded = false): void {
  websocket._readyState = CLOSING;

  const err = new Error(message);
  Error.captureStackTrace(err, abortHandshake);

  req[kAborted] = true;
  req.abort();

  const { socket } = req;

  if (socket && !socket.destroyed) {
    // On Node.js >= 14.3.0 `request.abort()` does not destroy the socket if called after the request completed.
    socket.destroy();
  }

  if (upgraded) {
    // After a 101, upstream destroys the socket and forwards its 'error' and 'close' events. They're separate events,
    // so an 'error' listener that throws doesn't skip 'close'.
    process.nextTick(emitError, websocket, err);
    process.nextTick(emitWebSocketClose, websocket);
  } else {
    process.nextTick(emitErrorAndClose, websocket, err);
  }
}

// Upstream's `websocket._socket.destroy()`.
function destroySocket(websocket: WebSocket): void {
  // On the stream transport, keep the engine alive until socketOnClose() so it can parse data buffered in the socket.
  if (websocket[kTransport] !== STREAM) {
    const closeFrameSent = websocket._closeFrameSent;

    // terminate() delivers the frames the native client has buffered. A Close frame among them isn't echoed, so
    // restore `_closeFrameSent`.
    websocket[kNative]!.terminate();
    websocket._closeFrameSent = closeFrameSent;
  }
  if (websocket[kTransport] !== NATIVE_CLIENT) websocket._socket!.destroy();
}

function setCloseTimer(websocket: WebSocket): void {
  websocket._closeTimer = setTimeout(destroySocket, websocket._closeTimeout, websocket);
}

// lib/receiver.js errors by code: [constructor, message, has "Invalid WebSocket frame: " prefix, status code].
// The native client's codes and status codes come from `ErrorCode::info()` in src/http_jsc/websocket_client.rs.
const receiverErrors = {
  __proto__: null,
  WS_ERR_EXPECTED_FIN: [RangeError, "FIN must be set", true, 1002],
  WS_ERR_EXPECTED_MASK: [RangeError, "MASK must be set", true, 1002],
  WS_ERR_INVALID_CLOSE_CODE: [RangeError, "invalid status code ", true, 1002],
  WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH: [RangeError, "invalid payload length ", true, 1002],
  WS_ERR_INVALID_OPCODE: [RangeError, "invalid opcode ", true, 1002],
  WS_ERR_INVALID_UTF8: [Error, "invalid UTF-8 sequence", true, 1007],
  WS_ERR_UNEXPECTED_MASK: [RangeError, "MASK must be clear", true, 1002],
  WS_ERR_UNEXPECTED_RSV_1: [RangeError, "RSV1 must be clear", true, 1002],
  WS_ERR_UNEXPECTED_RSV_2_3: [RangeError, "RSV2 and RSV3 must be clear", true, 1002],
  WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH: [
    RangeError,
    "Unsupported WebSocket frame: payload length > 2^53 - 1",
    false,
    1009,
  ],
  WS_ERR_UNSUPPORTED_MESSAGE_LENGTH: [RangeError, "Max payload size exceeded", false, 1009],
  Z_DATA_ERROR: [Error, "invalid compressed data", false, 1007],
  // Not an upstream ws code. Allocating a buffer for the message failed.
  ERR_MEMORY_ALLOCATION_FAILED: [RangeError, "Out of memory", false, 1011],
} as const;
type ReceiverErrorCode = Exclude<keyof typeof receiverErrors, "__proto__">;

// Indexed by uWS::WebSocketFailureKind.
const serverFailures: (ReceiverErrorCode | undefined)[] = [
  undefined,
  "WS_ERR_EXPECTED_MASK",
  "WS_ERR_UNEXPECTED_RSV_1",
  "WS_ERR_UNEXPECTED_RSV_2_3",
  "WS_ERR_INVALID_OPCODE",
  "WS_ERR_EXPECTED_FIN",
  "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH",
  "WS_ERR_INVALID_CLOSE_CODE",
  "WS_ERR_INVALID_UTF8",
  "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH",
  "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH",
  "Z_DATA_ERROR",
  "ERR_MEMORY_ALLOCATION_FAILED",
];

function createReceiverError(code: ReceiverErrorCode, detail: string | undefined): ReceiverError {
  const { 0: ErrorCtor, 1: message, 2: prefix, 3: statusCode } = receiverErrors[code];
  const text = message.endsWith(" ") ? message + detail : message;
  const err: ReceiverError = new ErrorCtor(prefix ? `Invalid WebSocket frame: ${text}` : text);

  Error.captureStackTrace(err, createReceiverError);
  err.code = code;
  err[kStatusCode] = statusCode;
  return err;
}

// The native side already sent a Close frame with `err`'s status code and is closing the connection.
function receiverOnError(websocket: WebSocket, err: Error): void {
  websocket._closeFrameSent = true;

  if (websocket._readyState === OPEN) {
    websocket._readyState = CLOSING;
    setCloseTimer(websocket);
  }

  if (!websocket._errorEmitted) {
    websocket._errorEmitted = true;
    websocket.emit("error", err);
  }
}

function binaryMessage(websocket: WebSocket, data: Buffer): Data {
  switch (websocket._binaryType) {
    case "nodebuffer":
      return data;
    case "arraybuffer":
      return toArrayBuffer(data);
    case "fragments":
      return data.length ? [data] : [];
    default:
      return new Blob([data]);
  }
}

// The closing handshake finished, or the connection ended without one (1006). `_socket` is about to close.
function receiverOnConclude(websocket: WebSocket, code: number, reason: Buffer): void {
  if (code !== 1006) {
    websocket._closeFrameReceived = true;
    websocket._closeFrameSent = true;
    websocket._closeMessage = reason;
    websocket._closeCode = code;

    if (websocket._readyState === OPEN) setCloseTimer(websocket);

    // Only the peer's FIN can follow its Close frame, and a paused socket would never read it.
    if (websocket._paused) process.nextTick(resumeSocket, websocket);

    finishStream(websocket);
  }

  if (websocket._readyState !== CLOSED) websocket._readyState = CLOSING;
}

// Upstream's createWebSocketStream() finishes its writable side on the socket's 'finish' event, which follows the closing
// handshake. The native transports' `_socket` doesn't emit it.
function finishStream(websocket: WebSocket): void {
  const callback = websocket[kFinalCallback];
  if (callback === undefined) return;

  websocket[kFinalCallback] = undefined;
  callback();
}

function resumeSocket(websocket: WebSocket): void {
  if (websocket[kTransport] !== NATIVE_CLIENT) (websocket._socket as ServerSocket | null)?.resume();
  websocket[kNative]?.resume();
}

//
// Callbacks invoked by the native sockets. `this` is the WebSocket.
//

const serverHandlers: ServerHandlers = {
  message(data, isBinary) {
    this.emit("message", isBinary ? binaryMessage(this, data) : data, isBinary);
  },
  ping(data) {
    // Cap auto-pongs. A peer can send unlimited pings, so unbounded replies would let it exhaust our memory. App sends
    // aren't capped. The native transports have the same limit. RFC 6455 5.5.3 allows answering only the latest ping.
    if (this[kTransport] === STREAM && this._autoPong && nativeBufferedAmount(this) <= 16 * 1024 * 1024) {
      this.pong(data, NOOP);
    }
    this.emit("ping", data);
  },
  pong(data) {
    this.emit("pong", data);
  },
  drain() {
    if (nativeBufferedAmount(this) === 0) settleCallbacks(this, false);
  },
  // `code` is one of:
  // - the status code of the peer's Close frame (1005 if it had none), which the native side already echoed
  // - 1006 if the connection ended without a Close frame
  // - a negated uWS::WebSocketFailureKind if the native side failed the connection, with the detail in `reason`
  close(code, reason) {
    if (code < 0) receiverOnError(this, createReceiverError(serverFailures[-code]!, reason.toString()));
    else receiverOnConclude(this, code, reason);
  },
};

const clientHandlers: ClientHandlers = {
  message: serverHandlers.message,
  ping: serverHandlers.ping,
  pong: serverHandlers.pong,
  drain: serverHandlers.drain,
  // Upstream initAsClient()'s `req.on('response')` and `req.on('upgrade')` listeners.
  // `isUpgrade` is true for a 101 that llhttp would treat as an upgrade: it needs an `Upgrade` header and
  // `Connection: upgrade`.
  handshake(statusCode, statusMessage, rawHeaders, isUpgrade) {
    const req = this._req as ClientRequest;

    if (!isUpgrade) {
      if (followRedirect(this, req, statusCode, headerValue(rawHeaders, "location"))) return;

      // From here on the native socket only reads the body. The 'unexpected-response' listener decides what to do with
      // it, as with a real response. `handshakeTimeout` is the socket's inactivity timeout in node:http, so it stays
      // armed until the request is destroyed.
      const res = (req.res = makeHandshakeResponse(statusCode, statusMessage, rawHeaders));

      res[kRequest] = req;
      res._read = responseRead;
      res.once("close", responseOnClose);

      if (!this.emit("unexpected-response", req, res)) {
        abortHandshake(this, req, `Unexpected server response: ${statusCode}`);
      }
      return;
    }

    // node:http drops the request's timeout once the response is an upgrade, even if an 'upgrade' listener throws.
    clearTimeout(this[kHandshakeTimer]);

    if (this.listenerCount("upgrade") > 0) {
      const res = makeHandshakeResponse(statusCode, statusMessage, rawHeaders);

      res.complete = true;
      res.push(null);
      this.emit("upgrade", res);

      // The user may have closed the connection from a listener of the `'upgrade'` event, or destroyed the request.
      if (this.readyState !== CONNECTING || req.destroyed) return;
    }

    if (!validateUpgrade(this, req, rawHeaders, headerValue(rawHeaders, "upgrade"))) return;

    // From here on the WebSocket owns the connection.
    req[kNative] = null;
    req.upgradeOrConnect = true;
    this[kRequest] = req;

    return { deflate: nativeDeflateParams(this) };
  },
  // Called with each body chunk of a non-101 response, then with `null`. `aborted` means the connection ended before
  // the body was complete. `reset` means it ended with an error, which also fails the request.
  body(chunk, aborted, reset) {
    const req = this._req as ClientRequest | null;
    const res = req?.res;

    if (!res) return;

    this[kHandshakeTimer]?.refresh();

    if (aborted) {
      res.destroy(connResetException("aborted"));
    } else {
      if (chunk === null) res.complete = true;
      if (!res.push(chunk) && chunk !== null) req[kNative]?.pause();
    }

    if (reset) {
      emitRequestError(
        req,
        new (require("internal/shared").ErrnoException)(process.binding("uv").UV_ECONNRESET, "read"),
      );
    }
  },
  open() {
    clearTimeout(this[kHandshakeTimer]);
    this._socket = new ClientSocket(this[kNative] as NativeClient);
    this._readyState = OPEN;

    const req = this[kRequest]!;

    this[kRequest] = undefined;
    this.emit("open");

    // node:http is done with the request once its 'upgrade' listeners return, and upstream emits 'open' from one of
    // them. A later `req.destroy()` does nothing.
    if (!req.destroyed) {
      req.destroyed = true;
      req.emit("close");
    }
  },
  error(error, viaProxy) {
    const { code } = error;

    if (this._readyState !== CONNECTING) {
      // After 'open', upstream only emits 'error' for what its Receiver rejects. Its socketOnError() destroys the socket
      // without an event, and 'close' follows with 1006.
      if (code! in receiverErrors) {
        receiverOnError(this, createReceiverError(code as ReceiverErrorCode, error.$detail));
      } else if (this._readyState === OPEN) {
        this._readyState = CLOSING;
      }
      return;
    }

    // Connecting failed. Emit the error that node:http would pass to `req.on('error')`.
    const native = this[kNative] as NativeClient;

    clearTimeout(this[kHandshakeTimer]);
    // `_req` is already null if the socket closed after validateUpgrade() accepted the 101 but before 'open'.
    const req = this._req;
    if (req) removeAbortListener(req);
    detach(native);
    this[kNative] = null;
    this._req = null;
    const identityError = code === "ERR_TLS_CERT_ALTNAME_INVALID" && this[kIdentityError];
    // Through a proxy, the proxy is the only host the client looks up and connects to.
    const proxyUrl = viaProxy ? this[kProxyUrl] : undefined;
    const dialled = proxyUrl !== undefined && URL.canParse(proxyUrl) ? proxyUrl : native.url;
    emitErrorAndClose(this, (identityError as Error) || connectError(dialled, error));
  },
  // The peer's Close frame was received and ours was sent.
  conclude(code, reason) {
    receiverOnConclude(this, code, Buffer.from(reason));
  },
  // The connection closed. On the stream transport, socketOnClose() handles this instead.
  close() {
    if (this[kTransport] === STREAM) return;

    clearTimeout(this._closeTimer!);
    this.emitClose();
  },
  write(chunk) {
    const entry = this[kWriteCallback];
    const socket = this._socket as ServerSocket;

    if (entry === undefined) {
      socket.write(chunk);
      return;
    }

    this[kWriteCallback] = undefined;

    // node:net on Bun drops the callbacks of queued writes when the peer resets the connection, so keep them here too.
    // emitClose() fails the ones that are left.
    const callbacks = (this[kCallbacks] ??= []);

    callbacks.push(entry);
    socket.write(chunk, err => {
      // node:net on Bun also calls a callback again if a later one threw while the socket was being destroyed.
      if (entry.callback === undefined || this[kCallbacks] !== callbacks) return;

      // Not always the oldest one: if a callback throws, node:stream skips the rest of that batch.
      callbacks.splice(callbacks.indexOf(entry), 1);
      runWaitingCallback(entry, err);
    });
  },
  end() {
    (this._socket as ServerSocket).end();
  },
  destroy() {
    this._socket!.destroy();
  },
};

function socketOnClose(this: ServerSocket): void {
  const websocket = this[kWebSocket]!;

  this.removeListener("close", socketOnClose);

  websocket._readyState = CLOSING;

  if (websocket[kTransport] === STREAM) {
    const native = websocket[kNative] as NativeClient;

    this.removeListener("data", socketOnData);
    this.removeListener("end", socketOnEnd);

    // The socket closed with unread data in its buffer, which may include the Close frame.
    const { readableLength } = this;

    if (!this.readableEnded && !websocket._closeFrameReceived && !websocket._errorEmitted && readableLength) {
      const closeFrameSent = websocket._closeFrameSent;

      feed(native, this.read(readableLength));
      websocket._closeFrameSent = closeFrameSent;
    }

    streamClosed(native);
  }

  this[kWebSocket] = undefined;

  clearTimeout(websocket._closeTimer!);
  websocket.emitClose();
}

function socketOnData(this: ServerSocket, chunk: Buffer): void {
  feed(this[kWebSocket]![kNative] as NativeClient, chunk);
}

function socketOnEnd(this: ServerSocket): void {
  this[kWebSocket]!._readyState = CLOSING;
  this.end();
}

function socketOnError(this: ServerSocket): void {
  const websocket = this[kWebSocket];

  this.removeListener("error", socketOnError);
  this.on("error", NOOP);

  if (websocket) {
    websocket._readyState = CLOSING;
    this.destroy();
  }
}

//
// Client handshake
//

// A native client's `websocket._socket`. Implements the subset of `net.Socket` that users commonly access.
class ClientSocket {
  declare [kNative]: NativeClient;

  constructor(native: NativeClient) {
    this[kNative] = native;
  }

  // For setSocketOptions() of bun:internal-for-testing.
  get [kInternalSocketData](): NativeClient {
    return this[kNative];
  }

  get remoteAddress(): string | undefined {
    return remoteAddress(this[kNative])?.address;
  }

  get remoteFamily(): "IPv4" | "IPv6" | undefined {
    return remoteAddress(this[kNative])?.family;
  }

  get remotePort(): number | undefined {
    return remoteAddress(this[kNative])?.port;
  }

  ref(): this {
    setRef(this[kNative], true);
    return this;
  }

  unref(): this {
    setRef(this[kNative], false);
    return this;
  }

  destroy(): this {
    this[kNative].terminate();
    return this;
  }

  setKeepAlive(): this {
    return this;
  }

  setNoDelay(): this {
    return this;
  }

  setTimeout(): this {
    return this;
  }
}
Object.defineProperty(ClientSocket, "name", { value: "Socket" });

// node:tls destroys the socket with whatever `checkServerIdentity` returned, so 'error' gets that value. The native
// client only reports that the name check failed.
function keepIdentityError(websocket: WebSocket, tls: NativeTlsOptions): NativeTlsOptions {
  const checkServerIdentity = getIgnoringObjectPrototype(tls, "checkServerIdentity");
  if (!$isCallable(checkServerIdentity)) return tls;

  // If the verdict isn't enforced the connection goes on, and a later failure must not report this one.
  const rejectUnauthorized = getIgnoringObjectPrototype(tls, "rejectUnauthorized");
  const enforced =
    typeof rejectUnauthorized === "boolean" ? rejectUnauthorized : process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0";

  // The handshake calls it from the event loop, which doesn't have the AsyncLocalStorage context of `new WebSocket()`.
  const asyncContext = $getInternalField($asyncContext, 0);

  // Inherit from `tls` instead of copying it, so that getters and inherited options keep working.
  return {
    __proto__: tls,
    checkServerIdentity: (hostname: string, cert: unknown) => {
      const verdict =
        asyncContext === $getInternalField($asyncContext, 0)
          ? checkServerIdentity(hostname, cert)
          : require("internal/async_context_frame").run(asyncContext, checkServerIdentity, undefined, hostname, cert);
      if (enforced) websocket[kIdentityError] = verdict;
      return verdict;
    },
  };
}

function connectError(dialled: string, error: NativeError): Error {
  const { code } = error;
  if (code === undefined) {
    return error;
  }

  const detail = error.$detail;
  // Node reports libuv's errno, which differs from os.constants.errno on Windows.
  const errno = (process.binding("uv") as unknown as Dictionary<number | undefined>)["UV_" + code];
  let err: ConnectError;

  if (detail) {
    err = new Error(detail);
    if (detail.startsWith("read ")) err.syscall = "read";
  } else if (code === "ECONNRESET") {
    err = new Error("socket hang up");
  } else if (code === "HPE_INVALID_CONSTANT") {
    err = new Error("Parse Error: Expected HTTP/, RTSP/ or ICE/");
  } else {
    const url = new URL(dialled);
    if (code === "ENOTFOUND") {
      err = new Error(`getaddrinfo ENOTFOUND ${url.hostname}`);
      err.syscall = "getaddrinfo";
      err.hostname = url.hostname;
    } else if (errno === undefined) {
      return error;
    } else if (url.protocol === "ws+unix:" || url.protocol === "wss+unix:") {
      return new (require("internal/shared").ExceptionWithHostPort)(errno, "connect", url.pathname.split(":")[0]);
    } else {
      const port = +url.port || (url.protocol === "wss:" || url.protocol === "https:" ? 443 : 80);
      const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
      return new (require("internal/shared").ExceptionWithHostPort)(errno, "connect", host, port);
    }
  }

  if (errno !== undefined) err.errno = errno;
  err.code = code;
  return err;
}

// `_read()` and the 'close' listener for a response whose body the native client reads.
function responseRead(this: HandshakeResponse, n: number): void {
  lazyHttp().IncomingMessage.prototype._read.$call(this, n);
  this[kRequest]![kNative]?.resume();
}

function responseOnClose(this: HandshakeResponse): void {
  this[kRequest]!.destroy();
}

function makeHandshakeResponse(statusCode: number, statusMessage: string, rawHeaders: string[]): HandshakeResponse {
  const res = new (lazyHttp().IncomingMessage)(null);
  res._addHeaderLines(rawHeaders, rawHeaders.length);
  res.statusCode = statusCode;
  res.statusMessage = statusMessage;
  res.httpVersion = "1.1";
  res.httpVersionMajor = 1;
  res.httpVersionMinor = 1;
  return res;
}

function headerValue(rawHeaders: string[], name: string): string | undefined {
  let value: string | undefined;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i].toLowerCase() === name) {
      value = value === undefined ? rawHeaders[i + 1] : `${value}, ${rawHeaders[i + 1]}`;
    }
  }
  return value;
}

// Returns true if the response was a redirect, which was either followed or failed the handshake.
function followRedirect(
  websocket: WebSocket,
  req: HandshakeRequest,
  statusCode: number,
  location: string | undefined,
): boolean {
  const { opts, address, protocols, options } = req[kOptions];

  if (!location || !opts.followRedirects || statusCode < 300 || statusCode >= 400) return false;

  if (++websocket._redirects > opts.maxRedirects) {
    abortHandshake(websocket, req, "Maximum redirects exceeded");
    return true;
  }

  req[kAborted] = true;
  req.abort();

  let addr: URL;

  try {
    addr = new URL(location, address);
  } catch {
    const err = new SyntaxError(`Invalid URL: ${location}`);
    emitErrorAndClose(websocket, err);
    return true;
  }

  initAsClient(websocket, addr, protocols, options);
  return true;
}

// The negotiated permessage-deflate parameters for the native side, or undefined for no compression.
function nativeDeflateParams(websocket: WebSocket): NativeStreamOptions["deflate"] {
  const params = websocket._extensions[extensionName]?.params;

  if (!params) return undefined;

  return {
    serverNoContextTakeover: !!params.server_no_context_takeover,
    clientNoContextTakeover: !!params.client_no_context_takeover,
    serverMaxWindowBits: params.server_max_window_bits || 15,
    clientMaxWindowBits: typeof params.client_max_window_bits === "number" ? params.client_max_window_bits : 15,
  };
}

// The validation from upstream's `req.on('upgrade')` listener. Returns false if it aborted the handshake. This is the
// only check of a 101 on either transport.
function validateUpgrade(
  websocket: WebSocket,
  req: HandshakeRequest,
  rawHeaders: string[],
  upgrade: string | undefined,
): boolean {
  const { protocolSet, perMessageDeflate } = req[kOptions];

  websocket._req = null;
  removeAbortListener(req);

  if (upgrade === undefined || upgrade.toLowerCase() !== "websocket") {
    abortHandshake(websocket, req, "Invalid Upgrade header", true);
    return false;
  }

  if (
    headerValue(rawHeaders, "sec-websocket-accept") !==
    Bun.SHA1.hash(req.getHeader("sec-websocket-key") + GUID, "base64")
  ) {
    abortHandshake(websocket, req, "Invalid Sec-WebSocket-Accept header", true);
    return false;
  }

  const serverProt = headerValue(rawHeaders, "sec-websocket-protocol");
  let protError: string | undefined;

  if (serverProt !== undefined) {
    if (!protocolSet.size) {
      protError = "Server sent a subprotocol but none was requested";
    } else if (!protocolSet.has(serverProt)) {
      protError = "Server sent an invalid subprotocol";
    }
  } else if (protocolSet.size) {
    protError = "Server sent no subprotocol";
  }

  if (protError) {
    abortHandshake(websocket, req, protError, true);
    return false;
  }

  if (serverProt) websocket._protocol = serverProt;

  const secWebSocketExtensions = headerValue(rawHeaders, "sec-websocket-extensions");

  if (secWebSocketExtensions !== undefined) {
    if (!perMessageDeflate) {
      const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
      abortHandshake(websocket, req, message, true);
      return false;
    }

    let extensions: ExtensionOffers;

    try {
      extensions = extensionParse(secWebSocketExtensions);
    } catch {
      const message = "Invalid Sec-WebSocket-Extensions header";
      abortHandshake(websocket, req, message, true);
      return false;
    }

    const extensionNames = Object.keys(extensions);

    if (extensionNames.length !== 1 || extensionNames[0] !== extensionName) {
      const message = "Server indicated an extension that was not requested";
      abortHandshake(websocket, req, message, true);
      return false;
    }

    try {
      perMessageDeflate.accept(extensions[extensionName]);
    } catch {
      const message = "Invalid Sec-WebSocket-Extensions header";
      abortHandshake(websocket, req, message, true);
      return false;
    }

    websocket._extensions[extensionName] = perMessageDeflate;
  }

  return true;
}

// Implements http.request()'s `signal` option: aborting the signal destroys the request.
function abortOnSignal(req: ClientRequest, signal: AbortSignal): void {
  const onAbort = () => void req.destroy($makeAbortError(undefined, { cause: signal.reason }));

  req[kRemoveAbortListener] = require("internal/abort_listener").addAbortListener(signal, onAbort)[Symbol.dispose];
}

// Call this whenever the request ends. The signal can outlive it, and the listener would leak.
function removeAbortListener(req: HandshakeRequest): void {
  const remove = (req as ClientRequest)[kRemoveAbortListener];

  if (remove !== undefined) {
    (req as ClientRequest)[kRemoveAbortListener] = undefined;
    remove();
  }
}

function handshakeOnTimeout(websocket: WebSocket): void {
  abortHandshake(websocket, websocket._req!, "Opening handshake has timed out");
}

// Returns `object[key]` if it's an own property or inherited from a class, but not from Object.prototype.
function getIgnoringObjectPrototype<T extends object, K extends keyof T>(object: T, key: K): T[K] | undefined {
  for (let current: object | null = object; current !== null; current = Object.getPrototypeOf(current)) {
    if (current === Object.prototype) return undefined;
    if (Object.hasOwn(current, key)) return object[key];
  }
}

// `options` is `agent.options`, which node:http merges over the request's options. `connectOpts` is what a proxy agent
// uses to connect to the proxy, so it must not affect how the target is verified.
function extractAgentOptions(agent: Agent): {
  options: AgentConnectOptions | undefined;
  connectOpts: AgentConnectOptions | undefined;
  proxy: ProxyOptions | null;
  isSecureProxy: boolean;
} {
  let options = Object.hasOwn(agent, "options") ? agent.options : undefined;
  if (!$isObject(options)) options = undefined;
  // hpagent calls it `proxyRequestOptions`.
  let connectOpts = Object.hasOwn(agent, "connectOpts")
    ? agent.connectOpts
    : Object.hasOwn(agent, "proxyRequestOptions")
      ? agent.proxyRequestOptions
      : undefined;
  if (!$isObject(connectOpts)) connectOpts = undefined;
  let proxy: ProxyOptions | null = null;

  // The native client only supports HTTP(S) proxies. A SOCKS agent's `proxy` isn't a URL.
  const proxySource = connectOpts || options;
  const agentProxy =
    (proxySource && getIgnoringObjectPrototype(proxySource, "proxy")) || getIgnoringObjectPrototype(agent, "proxy");
  const proxyUrl = (agentProxy as URL)?.href || agentProxy;
  if (typeof proxyUrl === "string" && (proxyUrl.startsWith("http:") || proxyUrl.startsWith("https:"))) {
    // hpagent keeps them in `proxyRequestOptions.headers`.
    const proxyHeaders =
      getIgnoringObjectPrototype(agent, "proxyHeaders") ??
      (connectOpts && getIgnoringObjectPrototype(connectOpts, "headers"));
    let headers = $isCallable(proxyHeaders) ? proxyHeaders.$call(agent) : proxyHeaders;

    // Both agents overwrite this header with the URL's credentials. The native client prefers the header.
    const { username, password } = new URL(proxyUrl);
    if ((username || password) && $isObject(headers)) {
      if (headers instanceof Headers) {
        headers = new Headers(headers);
        headers.delete("proxy-authorization");
      } else {
        headers = { ...headers };
        for (const name of Object.keys(headers)) {
          if (name.toLowerCase() === "proxy-authorization") delete headers[name];
        }
      }
    }

    proxy = { url: proxyUrl, headers: headers || undefined };
  }

  return { options, connectOpts, proxy, isSecureProxy: proxy !== null && (proxyUrl as string).startsWith("https:") };
}

// Whether `agent` overrides how connections are made.
function hasCustomConnect(agent: Agent): boolean {
  const { prototype } = lazyHttp().Agent as unknown as { prototype: Agent };

  return (
    agent.addRequest !== prototype.addRequest ||
    agent.createSocket !== prototype.createSocket ||
    (agent.createConnection !== prototype.createConnection &&
      agent.createConnection !== require("node:https").Agent.prototype.createConnection)
  );
}

// A minimal `http.ClientRequest` for handshakes done by the native client. It's passed to 'redirect' and
// 'unexpected-response' listeners and stored in `websocket._req`. `end()` starts the connection.
class ClientRequest extends EventEmitter {
  declare aborted: boolean;
  declare destroyed: boolean;
  declare finished: boolean;
  declare headersSent: boolean;
  declare host: string | undefined;
  declare method: string;
  declare path: string | undefined;
  declare protocol: string;
  declare res: HandshakeResponse | null;
  declare reusedSocket: boolean;
  declare socket: null;
  declare upgradeOrConnect: boolean;
  declare [kAborted]: boolean;
  declare [kThrowSynchronously]: boolean;
  declare [kRemoveAbortListener]: (() => void) | undefined;
  declare [kHeaders]: Dictionary<[name: string, value: HeaderValue]>;
  declare [kNative]: NativeClient | null;
  declare [kNativeOptions]: NativeClientOptions;
  declare [kOptions]: RequestState;
  declare [kUrl]: string;
  declare [kWebSocket]: WebSocket;

  constructor(websocket: WebSocket, url: string, nativeOptions: NativeClientOptions, state: RequestState) {
    super();

    this.aborted = false;
    this.destroyed = false;
    this.finished = false;
    this.headersSent = false;
    this.host = state.opts.host;
    this.method = "GET";
    this.path = state.opts.path;
    this.protocol = url.startsWith("wss") ? "https:" : "http:";
    this.res = null;
    this.reusedSocket = false;
    this.socket = null;
    this.upgradeOrConnect = false;
    this[kAborted] = false;
    this[kThrowSynchronously] = false;
    this[kRemoveAbortListener] = undefined;
    this[kHeaders] = { __proto__: null as never };
    this[kNative] = null;
    this[kNativeOptions] = nativeOptions;
    this[kOptions] = state;
    this[kUrl] = url;
    this[kWebSocket] = websocket;
  }

  get writableEnded(): boolean {
    return this.finished;
  }

  setHeader(name: string, value: HeaderValue): this {
    if (this.headersSent) throw $ERR_HTTP_HEADERS_SENT("set");
    const { validateHeaderName, validateHeaderValue } = lazyHttp();
    validateHeaderName(name);
    validateHeaderValue(name, value);
    this[kHeaders][name.toLowerCase()] = [name, value];
    return this;
  }

  getHeader(name: string): HeaderValue | undefined {
    return this[kHeaders][`${name}`.toLowerCase()]?.[1];
  }

  getHeaders(): Dictionary<HeaderValue> {
    const headers: Dictionary<HeaderValue> = { __proto__: null as never };
    for (const key in this[kHeaders]) headers[key] = this[kHeaders][key][1];
    return headers;
  }

  getHeaderNames(): string[] {
    return Object.keys(this[kHeaders]);
  }

  getRawHeaderNames(): string[] {
    return Object.values(this[kHeaders]).map(entry => entry[0]);
  }

  hasHeader(name: string): boolean {
    return `${name}`.toLowerCase() in this[kHeaders];
  }

  removeHeader(name: string): void {
    if (this.headersSent) throw $ERR_HTTP_HEADERS_SENT("remove");
    delete this[kHeaders][`${name}`.toLowerCase()];
  }

  flushHeaders(): void {}
  setNoDelay(): void {}
  setSocketKeepAlive(): void {}
  setTimeout(): this {
    return this;
  }
  write(): boolean {
    return true;
  }

  end(): this {
    if (this.finished || this.destroyed) return this;

    this.finished = true;
    this.headersSent = true;

    const websocket = this[kWebSocket];
    const nativeOptions = this[kNativeOptions];
    const headers: Dictionary<HeaderValue> = { __proto__: null as never };
    for (const key in this[kHeaders]) {
      const entry = this[kHeaders][key];
      const value = entry[1];

      if (!$isArray(value)) headers[entry[0]] = value;
      // https://github.com/nodejs/node/blob/v26.3.0/lib/_http_outgoing.js#L672
      else if (value.length) headers[entry[0]] = value.join(key === "cookie" ? "; " : ", ");
    }
    nativeOptions.headers = headers;
    nativeOptions.extensions = this[kHeaders]["sec-websocket-extensions"]?.[1] as string | undefined;

    let native: NativeClient;
    try {
      native = createWebSocket(this[kUrl], nativeOptions, websocket, clientHandlers);
    } catch (err) {
      if (this[kThrowSynchronously]) throw err;

      this.destroy(err as Error);
      return this;
    }
    this[kNative] = websocket[kNative] = native;

    if (this.listenerCount("socket") > 0) process.nextTick(emitSocket, this, native);
    return this;
  }

  abort(): void {
    if (this.aborted) return;

    this.aborted = true;
    process.nextTick(emitAbort, this);
    this.destroy();
  }

  destroy(err?: Error | null): this {
    if (this.destroyed) return this;

    this.destroyed = true;

    if (this.upgradeOrConnect) {
      // Called from an 'open' listener. node:http destroys the socket, which the WebSocket now uses.
      this[kWebSocket].terminate();
      process.nextTick(emitRequestClose, this);
      return this;
    }

    clearTimeout(this[kWebSocket][kHandshakeTimer]);
    removeAbortListener(this);

    const { res } = this;

    if (res !== null && !res.complete) {
      // Body bytes that the native client read together with the headers are delivered after the 'unexpected-response'
      // listeners return, so release the client on the next tick. node:http's parser also finishes its current chunk.
      res.resume();
      process.nextTick(releaseNative, this);
    } else {
      releaseNative(this);
    }

    // Destroying a request before it got a response fails the handshake with "socket hang up", like node:http. After
    // the response, only an explicit `err` is reported.
    if (!err && res === null) err = connResetException("socket hang up");

    if (err) process.nextTick(emitRequestError, this, err);

    process.nextTick(emitRequestClose, this);
    return this;
  }
}

function connResetException(message: string): ConnectError {
  return new (require("internal/shared").ConnResetException)(message);
}

function releaseNative(req: ClientRequest): void {
  const websocket = req[kWebSocket];
  const native = req[kNative];
  const { res } = req;

  if (native !== null) {
    req[kNative] = null;
    detach(native);
    native.terminate();
    if (websocket[kNative] === native) websocket[kNative] = null;
  }

  // node:http does this in the socket's 'close' listener.
  if (res !== null && !res.complete) res.destroy(connResetException("aborted"));
}

// Emits a ClientRequest's 'error' event. initAsClient()'s listener (requestFailed) runs before user listeners.
function emitRequestError(req: ClientRequest, err: Error): void {
  const aborted = req[kAborted];

  requestFailed(req, err);

  if (!aborted && req.listenerCount("error") > 0) req.emit("error", err);
}

// Upstream initAsClient()'s `req.on('error')` listener.
function requestFailed(req: HandshakeRequest, err: Error): void {
  const websocket = req[kWebSocket];

  if (websocket._req !== req || req[kAborted]) return;

  websocket._req = null;
  emitErrorAndClose(websocket, err);
}

function emitSocket(req: ClientRequest, native: NativeClient): void {
  if (!req.destroyed) req.emit("socket", new ClientSocket(native));
}

function emitAbort(req: ClientRequest): void {
  req.emit("abort");
}

function emitRequestClose(req: ClientRequest): void {
  req.emit("close");
}

//
// Listeners for a real `http.request()` request.
//

function requestOnError(this: HttpClientRequest, err: Error): void {
  requestFailed(this, err);
}

function requestOnResponse(this: HttpClientRequest, res: IncomingMessage): void {
  const websocket = this[kWebSocket];

  if (followRedirect(websocket, this, res.statusCode!, res.headers.location)) return;

  if (!websocket.emit("unexpected-response", this, res)) {
    abortHandshake(websocket, this, `Unexpected server response: ${res.statusCode}`);
  }
}

function requestOnTimeout(this: HttpClientRequest): void {
  abortHandshake(this[kWebSocket], this, "Opening handshake has timed out");
}

function requestOnUpgrade(this: HttpClientRequest, res: IncomingMessage, socket: ServerSocket, head: Buffer): void {
  const websocket = this[kWebSocket];

  websocket.emit("upgrade", res);

  // The user may have closed the connection from a listener of the `'upgrade'` event.
  if (websocket.readyState !== CONNECTING) return;

  if (!validateUpgrade(websocket, this, res.rawHeaders, res.headers.upgrade)) return;

  const { opts } = this[kOptions];

  websocket.setSocket(socket, head, {
    maxPayload: opts.maxPayload,
    skipUTF8Validation: opts.skipUTF8Validation,
    [kHandshake]: "",
    [kResponse]: undefined,
  });
}

// The request's options, which `http.Agent` passes to `createConnection()`.
type ConnectOptions = Omit<import("node:net").IpcNetConnectOpts & import("node:tls").ConnectionOptions, "path"> & {
  host: string;
  path: string | undefined;
  socketPath: string;
};

function netConnect(options: import("node:http").ClientRequestArgs): NetSocket {
  (options as ConnectOptions).path = (options as ConnectOptions).socketPath;
  return require("node:net").connect(options as import("node:net").IpcNetConnectOpts);
}

function tlsConnect(args: import("node:http").ClientRequestArgs): NetSocket {
  const options = args as ConnectOptions;

  options.path = undefined;

  if (!options.servername && options.servername !== "") {
    options.servername = require("node:net").isIP(options.host) ? "" : options.host;
  }

  return require("node:tls").connect(options as import("node:tls").ConnectionOptions);
}

function initAsClient(
  websocket: WebSocket,
  address: string | URL,
  protocols: string[],
  options: ClientOptions | undefined,
): void {
  const opts: ResolvedClientOptions = {
    // `tls`, `proxy` and `agent` have no default here, so without this they could be read from Object.prototype.
    __proto__: null,
    allowSynchronousEvents: true,
    autoPong: true,
    closeTimeout: CLOSE_TIMEOUT,
    protocolVersion: protocolVersions[1],
    maxPayload: 100 * 1024 * 1024,
    skipUTF8Validation: false,
    perMessageDeflate: true,
    followRedirects: false,
    maxRedirects: 10,
    ...options,
    socketPath: undefined,
    hostname: undefined,
    protocol: undefined,
    protocols: undefined,
    timeout: undefined,
    method: "GET",
    host: undefined,
    path: undefined,
    port: undefined,
  };

  websocket._autoPong = opts.autoPong;
  websocket._closeTimeout = opts.closeTimeout;

  const { protocolVersion, origin, handshakeTimeout, agent } = opts;

  if (!protocolVersions.includes(protocolVersion)) {
    throw new RangeError(
      `Unsupported protocol version: ${protocolVersion} (supported versions: ${protocolVersions.join(", ")})`,
    );
  }

  let parsedUrl: URL;

  if (address instanceof URL) {
    parsedUrl = address;
  } else {
    try {
      parsedUrl = new URL(address);
    } catch {
      throw new SyntaxError(`Invalid URL: ${address}`);
    }
  }

  if (parsedUrl.protocol === "http:") {
    parsedUrl.protocol = "ws:";
  } else if (parsedUrl.protocol === "https:") {
    parsedUrl.protocol = "wss:";
  }

  websocket._url = parsedUrl.href;

  // "wss+unix:" is a Bun extension.
  const isSecure = parsedUrl.protocol === "wss:" || parsedUrl.protocol === "wss+unix:";
  const isIpcUrl = parsedUrl.protocol === "ws+unix:" || parsedUrl.protocol === "wss+unix:";
  let invalidUrlMessage: string | undefined;

  if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
    invalidUrlMessage = 'The URL\'s protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"';
  } else if (isIpcUrl && !parsedUrl.pathname) {
    invalidUrlMessage = "The URL's pathname is empty";
  } else if (parsedUrl.hash) {
    invalidUrlMessage = "The URL contains a fragment identifier";
  }

  if (invalidUrlMessage) {
    const err = new SyntaxError(invalidUrlMessage);

    if (websocket._redirects === 0) {
      throw err;
    } else {
      emitErrorAndClose(websocket, err);
      return;
    }
  }

  const defaultPort = isSecure ? 443 : 80;
  const protocolSet = new Set<string>();
  let perMessageDeflate: PerMessageDeflate | undefined;

  opts.port = parsedUrl.port || defaultPort;
  opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
  opts.headers = {
    ...opts.headers,
    "Sec-WebSocket-Version": protocolVersion,
    "Sec-WebSocket-Key": Buffer.from(crypto.getRandomValues(new Uint8Array(16)).buffer).toString("base64"),
    Connection: "Upgrade",
    Upgrade: "websocket",
  };
  opts.path = parsedUrl.pathname + parsedUrl.search;

  const deflateOptions = opts.perMessageDeflate;

  if (deflateOptions) {
    perMessageDeflate = new PerMessageDeflate({
      ...(deflateOptions as PerMessageDeflateOptions),
      isServer: false,
    });
    opts.headers["Sec-WebSocket-Extensions"] = extensionFormat({ [extensionName]: perMessageDeflate.offer() });
  }
  if (protocols.length) {
    for (const protocol of protocols) {
      if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
        throw new SyntaxError("An invalid or duplicated subprotocol was specified");
      }

      protocolSet.add(protocol);
    }

    opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
  }
  if (origin) {
    if (protocolVersion < 13) {
      opts.headers["Sec-WebSocket-Origin"] = origin;
    } else {
      opts.headers.Origin = origin;
    }
  }
  const { username, password } = parsedUrl;

  if (username || password) {
    opts.auth = `${username}:${password}`;
  }

  if (isIpcUrl) {
    const parts = opts.path.split(":");

    opts.socketPath = parts[0];
    opts.path = parts[1];
  }

  if (opts.followRedirects) {
    if (websocket._redirects === 0) {
      websocket._originalIpc = isIpcUrl;
      websocket._originalSecure = isSecure;
      websocket._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;

      const headers = options && options.headers;

      // Shallow copy the user provided options so that headers can be changed without mutating the original object.
      options = { ...options, headers: {} };

      if (headers) {
        for (const [key, value] of Object.entries(headers)) {
          options.headers![key.toLowerCase()] = value;
        }
      }
    } else if (websocket.listenerCount("redirect") === 0) {
      const isSameHost = isIpcUrl
        ? websocket._originalIpc
          ? opts.socketPath === websocket._originalHostOrSocketPath
          : false
        : websocket._originalIpc
          ? false
          : parsedUrl.host === websocket._originalHostOrSocketPath;

      if (!isSameHost || (websocket._originalSecure && !isSecure)) {
        // Match curl 7.77.0 behavior and drop the following headers.
        delete opts.headers.authorization;
        delete opts.headers.cookie;

        if (!isSameHost) delete opts.headers.host;

        opts.auth = undefined;
      }
    }

    // Match curl 7.77.0 behavior and make the first `Authorization` header win.
    const { auth } = opts;

    if (auth && !options!.headers!.authorization) {
      options!.headers!.authorization = "Basic " + Buffer.from(auth).toString("base64");
    }
  }

  const state: RequestState = { opts, address, protocols, options, protocolSet, perMessageDeflate };

  let proxy: ProxyOption | null | undefined = opts.proxy;
  let agentOptions: AgentConnectOptions | undefined;
  if ($isObject(agent)) {
    const agentOpts = extractAgentOptions(agent);
    agentOptions = agentOpts.options;

    if (!proxy) {
      proxy = agentOpts.proxy;

      // A proxy agent verifies an https: proxy with its own `connectOpts` and the target with the request's options.
      // Set `proxy.tls` even if they're empty. Without it the native client uses the target's options for the proxy
      // too. That's what the `tls` option asks for, and all there is to go by for an agent without `connectOpts`.
      const { connectOpts } = agentOpts;
      if (agentOpts.isSecureProxy && connectOpts && !$isObject(opts.tls)) {
        agentOpts.proxy!.tls = require("internal/tls").nodeClientTlsToNative({ __proto__: null, ...connectOpts }) ?? {};
      }
    }
  }

  // The native client doesn't support these options, so fall back to `http.request()`. The native engine adopts the
  // request's socket after the 101.
  if (
    !proxy &&
    (opts.createConnection ||
      opts.lookup ||
      protocolVersion !== 13 ||
      opts.family ||
      opts.localAddress ||
      opts.localPort ||
      opts.finishRequest ||
      opts.signal ||
      opts.secureContext ||
      ($isObject(agent) && hasCustomConnect(agent)))
  ) {
    const defaultCreateConnection = isSecure ? tlsConnect : netConnect;

    opts.createConnection = opts.createConnection || defaultCreateConnection;
    opts.defaultPort = opts.defaultPort || defaultPort;
    opts.timeout = handshakeTimeout;

    const tlsOption = opts.tls;
    if ($isObject(tlsOption)) {
      // `tls` overrides every other TLS option, same as on the native path below.
      const { serverName, ...tls }: Dictionary<unknown> = { __proto__: null as never, ...tlsOption };
      const requestOptions = opts as unknown as Dictionary<unknown>;
      const { nodeClientTlsKeys } = require("internal/tls");

      // The agent's options override the request's. An agent that only carries options isn't needed to connect, so
      // drop it and pass its remaining options straight to the connection.
      const connectionOptions: Dictionary<unknown> | undefined =
        $isObject(agent) && !hasCustomConnect(agent) ? { __proto__: null as never, ...agentOptions } : undefined;

      // Use `delete`, not `= undefined`. An own key set to undefined still overrides tls.connect()'s defaults.
      for (const target of connectionOptions ? [requestOptions, connectionOptions] : [requestOptions]) {
        for (let i = 0; i < nodeClientTlsKeys.length; i++) delete target[nodeClientTlsKeys[i]];
        delete target.ALPNProtocols;
        delete target.secureContext;
        delete target.secureProtocol;
      }
      delete requestOptions.tls;

      for (const key of Object.keys(tls)) {
        if (tls[key] !== undefined) requestOptions[key] = tls[key];
      }
      if (serverName !== undefined) requestOptions.servername = serverName;

      if (connectionOptions) {
        opts.agent = undefined;
        opts.createConnection = args => defaultCreateConnection({ ...args, ...connectionOptions });
      }
    }

    const request = isSecure ? require("node:https").request : lazyHttp().request;
    const req: HttpClientRequest = (websocket._req = request(opts));

    req[kAborted] = false;
    req[kOptions] = state;
    req[kWebSocket] = websocket;

    if (websocket._redirects) {
      websocket.emit("redirect", websocket.url, req);
    }

    if (opts.timeout) req.on("timeout", requestOnTimeout);

    req.on("error", requestOnError);
    req.on("response", requestOnResponse);
    req.on("upgrade", requestOnUpgrade);

    if (opts.finishRequest) {
      opts.finishRequest(req, websocket);
    } else {
      req.end();
    }
    return;
  }

  const nativeOptions: NativeClientOptions = {
    __proto__: null,
    protocols,
    headers: undefined,
    maxPayload: Math.max(opts.maxPayload | 0, 0),
    autoPong: !!opts.autoPong,
    skipUTF8Validation: !!opts.skipUTF8Validation,
    extensions: undefined,
  };

  if (proxy) {
    const proxyTls = $isObject(proxy) ? getIgnoringObjectPrototype(proxy as ProxyOptions, "tls") : undefined;
    const wrapped = $isObject(proxyTls)
      ? keepIdentityError(websocket, require("internal/tls").unsealPfxForNative(proxyTls))
      : proxyTls;
    nativeOptions.proxy =
      wrapped === proxyTls ? proxy : ({ __proto__: proxy, tls: wrapped } as unknown as ProxyOptions);
    // For connectError(). The caller may change or reuse its `proxy` object before the connection fails. A redirect
    // comes here again with the same `proxy`.
    if (websocket._redirects === 0) {
      const url = ($isObject(proxy) && getIgnoringObjectPrototype(proxy as ProxyOptions, "url")) || proxy;
      if (typeof url === "string" || url instanceof URL) websocket[kProxyUrl] = String(url);
    }
  }

  let tls = opts.tls;
  if ($isObject(tls)) {
    tls = require("internal/tls").unsealPfxForNative(tls);
  } else if (!tls && options) {
    // The agent's options take precedence: https://github.com/nodejs/node/blob/v26.3.0/lib/_http_agent.js#L305
    tls = require("internal/tls").nodeClientTlsToNative({ __proto__: null, ...options, ...agentOptions });
  }
  if (tls) nativeOptions.tls = keepIdentityError(websocket, tls);

  // Strip the credentials, which are sent in the Authorization header below, and an empty fragment.
  let url = parsedUrl.href;
  if (username || password || url.endsWith("#")) {
    const bare = new URL(url);
    bare.username = bare.password = bare.hash = "";
    url = bare.href;
  }

  const req = (websocket._req = new ClientRequest(websocket, url, nativeOptions, state));

  const headers = req[kHeaders];
  const extraHeaders = opts.headers;
  for (const name of Object.keys(extraHeaders)) {
    const value = extraHeaders[name];
    if (value !== undefined) headers[name.toLowerCase()] = [name, value];
  }
  if (headers.host === undefined) {
    const host = isIpcUrl ? "localhost" : parsedUrl.hostname;
    headers.host = ["Host", +opts.port === defaultPort ? host : `${host}:${opts.port}`];
  }
  const { auth } = opts;

  if (auth && headers.authorization === undefined) {
    headers.authorization = ["Authorization", "Basic " + Buffer.from(auth).toString("base64")];
  }

  if (websocket._redirects) {
    websocket.emit("redirect", websocket.url, req);
  }

  const { signal } = opts;
  if (signal) abortOnSignal(req, signal);

  // Start the timer now so it also covers a `finishRequest` that calls `req.end()` late or never.
  if (handshakeTimeout) {
    websocket[kHandshakeTimer] = setTimeout(handshakeOnTimeout, handshakeTimeout, websocket);
  }

  // Connecting throws on an invalid header. Let that propagate only while the constructor is still on the stack, i.e.
  // not after a redirect and not once `finishRequest` has returned. Otherwise `end()` turns it into an 'error' event.
  req[kThrowSynchronously] = websocket._redirects === 0;
  try {
    if (opts.finishRequest) opts.finishRequest(req, websocket);
    else req.end();
  } catch (err) {
    clearTimeout(websocket[kHandshakeTimer]);
    removeAbortListener(req);
    throw err;
  } finally {
    req[kThrowSynchronously] = false;
  }
}

//
// lib/websocket-server.js
//

const RUNNING = 0;
const SERVER_CLOSING = 1;
const SERVER_CLOSED = 2;

class WebSocketServer extends EventEmitter {
  declare clients: Set<WebSocket> | undefined;
  declare options: Required<ServerOptions>;
  declare _removeListeners: (() => void) | null | undefined;
  declare _server: HttpServer | null | undefined;
  declare _shouldEmitClose: boolean | undefined;
  declare _state: typeof RUNNING | typeof SERVER_CLOSING | typeof SERVER_CLOSED;

  constructor(options?: ServerOptions, callback?: () => void) {
    super();

    options = {
      allowSynchronousEvents: true,
      autoPong: true,
      maxPayload: 100 * 1024 * 1024,
      skipUTF8Validation: false,
      perMessageDeflate: false,
      handleProtocols: null,
      clientTracking: true,
      closeTimeout: CLOSE_TIMEOUT,
      verifyClient: null,
      noServer: false,
      backlog: null, // use default (511 as implemented in net.js)
      server: null,
      host: null,
      path: null,
      port: null,
      WebSocket,
      ...options,
    };

    const { port, noServer } = options;
    let { server } = options;

    if ((port == null && !server && !noServer) || (port != null && (server || noServer)) || (server && noServer)) {
      throw new TypeError('One and only one of the "port", "server", or "noServer" options must be specified');
    }

    if (port != null) {
      const http = lazyHttp();
      server = (http.createServer as typeof import("node:http").createServer)((req, res) => {
        const body = http.STATUS_CODES[426];

        res.writeHead(426, {
          "Content-Length": body.length,
          "Content-Type": "text/plain",
        });
        res.end(body);
      });
      server.listen(port, options.host!, options.backlog!, callback);
    }

    if (server) {
      const emitConnection = this.emit.bind(this, "connection");

      this._server = server;
      this._removeListeners = addListeners(server, {
        listening: this.emit.bind(this, "listening"),
        error: this.emit.bind(this, "error"),
        upgrade: (req: ServerRequest, socket: ServerSocket, head: Buffer) => {
          this.handleUpgrade(req, socket, head, emitConnection);
        },
      });
    }

    if (options.perMessageDeflate === true) options.perMessageDeflate = {};
    if (options.clientTracking) {
      this.clients = new Set();
      this._shouldEmitClose = false;
    }

    this.options = options as Required<ServerOptions>;
    this._state = RUNNING;
  }

  address(): ReturnType<HttpServer["address"]> {
    if (this.options.noServer) {
      throw new Error('The server is operating in "noServer" mode');
    }

    if (!this._server) return null;
    return this._server.address();
  }

  close(cb?: (err?: Error) => void): void {
    if (this._state === SERVER_CLOSED) {
      if (cb) {
        this.once("close", () => {
          cb(new Error("The server is not running"));
        });
      }

      process.nextTick(emitClose, this);
      return;
    }

    if (cb) this.once("close", cb);

    if (this._state === SERVER_CLOSING) return;
    this._state = SERVER_CLOSING;

    if (this.options.noServer || this.options.server) {
      if (this._server) {
        this._removeListeners!();
        this._removeListeners = this._server = null;
      }

      const { clients } = this;

      if (clients) {
        if (!clients.size) {
          process.nextTick(emitClose, this);
        } else {
          this._shouldEmitClose = true;
        }
      } else {
        process.nextTick(emitClose, this);
      }
    } else {
      const server = this._server!;

      this._removeListeners!();
      this._removeListeners = this._server = null;

      // The HTTP/S server was created internally. Close it, and rely on its `'close'` event.
      server.close(() => {
        emitClose(this);
      });
    }
  }

  shouldHandle(req: ServerRequest): boolean {
    const { path } = this.options;

    if (path) {
      const index = req.url.indexOf("?");
      const pathname = index !== -1 ? req.url.slice(0, index) : req.url;

      if (pathname !== path) return false;
    }

    return true;
  }

  handleUpgrade(req: ServerRequest, socket: ServerSocket, head: Buffer, cb: UpgradeCallback): void {
    socket.on("error", serverSocketOnError);

    const key = req.headers["sec-websocket-key"];
    const upgrade = req.headers.upgrade;
    const version = +req.headers["sec-websocket-version"]!;

    if (req.method !== "GET") {
      const message = "Invalid HTTP method";
      abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
      return;
    }

    if (upgrade === undefined || upgrade.toLowerCase() !== "websocket") {
      const message = "Invalid Upgrade header";
      abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
      return;
    }

    if (key === undefined || !keyRegex.test(key)) {
      const message = "Missing or invalid Sec-WebSocket-Key header";
      abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
      return;
    }

    if (version !== 13 && version !== 8) {
      const message = "Missing or invalid Sec-WebSocket-Version header";
      abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
        "Sec-WebSocket-Version": "13, 8",
      });
      return;
    }

    if (!this.shouldHandle(req)) {
      abortServerHandshake(req, socket, 400);
      return;
    }

    const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
    let protocols = new Set<string>();

    if (secWebSocketProtocol !== undefined) {
      try {
        protocols = subprotocolParse(secWebSocketProtocol);
      } catch {
        const message = "Invalid Sec-WebSocket-Protocol header";
        abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
        return;
      }
    }

    const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
    const extensions: Extensions = {};

    const deflateOptions = this.options.perMessageDeflate;

    if (deflateOptions && secWebSocketExtensions !== undefined) {
      const perMessageDeflate = new PerMessageDeflate({
        ...(deflateOptions as PerMessageDeflateOptions),
        isServer: true,
      });

      try {
        const offers = extensionParse(secWebSocketExtensions);

        if (offers[extensionName]) {
          perMessageDeflate.accept(offers[extensionName]);
          extensions[extensionName] = perMessageDeflate;
        }
      } catch {
        const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
        abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
        return;
      }
    }

    if (this.options.verifyClient) {
      const info: VerifyClientInfo = {
        origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
        secure: !!(req.socket.authorized || req.socket.encrypted),
        req,
      };

      if (this.options.verifyClient.length === 2) {
        this.options.verifyClient(info, (verified, code, message, headers) => {
          if (!verified) {
            return abortServerHandshake(req, socket, code || 401, message, headers);
          }

          this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
        });
        return;
      }

      if (!this.options.verifyClient(info)) return abortServerHandshake(req, socket, 401);
    }

    this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
  }

  completeUpgrade(
    extensions: Extensions,
    key: string,
    protocols: Set<string>,
    req: ServerRequest,
    socket: ServerSocket,
    head: Buffer,
    cb: UpgradeCallback,
  ): ServerSocket | void {
    // Destroy the socket if the client has already sent a FIN packet.
    if (!socket.readable || !socket.writable) return socket.destroy();

    if (socket[kWebSocket]) {
      throw new Error(
        "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration",
      );
    }

    if (this._state > RUNNING) return abortServerHandshake(req, socket, 503);

    const headers = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${Bun.SHA1.hash(key + GUID, "base64")}`,
    ];

    const ws = new this.options.WebSocket(null, undefined, this.options);

    if (protocols.size) {
      const protocol = this.options.handleProtocols
        ? this.options.handleProtocols(protocols, req)
        : protocols.values().next().value;

      if (protocol) {
        headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
        ws._protocol = protocol;
      }
    }

    if (extensions[extensionName]) {
      const params = extensions[extensionName].params!;
      const value = extensionFormat({
        [extensionName]: [params],
      });
      headers.push(`Sec-WebSocket-Extensions: ${value}`);
      ws._extensions = extensions;
    }

    // Allow external modification/inspection of handshake headers.
    this.emit("headers", headers, req);

    socket.removeListener("error", serverSocketOnError);

    if (
      !ws.setSocket(socket, head, {
        maxPayload: this.options.maxPayload,
        skipUTF8Validation: this.options.skipUTF8Validation,
        [kHandshake]: headers.concat("\r\n").join("\r\n"),
        [kResponse]: nativeResponse(req, socket),
      })
    ) {
      socket.on("error", serverSocketOnError);
      return abortServerHandshake(req, socket, 500);
    }

    const { clients } = this;

    if (clients) {
      clients.add(ws);
      ws.on("close", () => {
        clients.delete(ws);

        if (this._shouldEmitClose && !clients.size) {
          process.nextTick(emitClose, this);
        }
      });
    }

    cb(ws, req);
  }
}

// Returns the connection's native response if `socket` is the node:http socket itself and `req` arrived on it.
// Returns undefined for a wrapper around the socket, so the stream transport is used and the wrapper sees every byte.
// A `req` that node:http didn't create (e.g. a framework's own request object) is assumed to belong to `socket`.
function nativeResponse(req: ServerRequest, socket: ServerSocket): unknown {
  const response = socket[kInternalSocketData];
  const headerSource = req[(kHeaderSource ??= require("internal/http").kHeaderSource)];
  return headerSource === undefined || headerSource === response ? response : undefined;
}

function addListeners(server: HttpServer, map: Dictionary<(...args: any[]) => void>): () => void {
  for (const event of Object.keys(map)) server.on(event, map[event]);

  return function removeListeners() {
    for (const event of Object.keys(map)) {
      server.removeListener(event, map[event]);
    }
  };
}

function emitClose(server: WebSocketServer): void {
  server._state = SERVER_CLOSED;
  server.emit("close");
}

function serverSocketOnError(this: ServerSocket): void {
  this.destroy();
}

function abortServerHandshake(
  req: ServerRequest,
  socket: ServerSocket,
  code: number,
  message?: string,
  headers?: HttpHeaders,
): void {
  const { STATUS_CODES } = lazyHttp();
  message = message || STATUS_CODES[code];
  headers = {
    Connection: "close",
    "Content-Type": "text/html",
    "Content-Length": Buffer.byteLength(message),
    ...headers,
  };

  // handleUpgrade() was called from a 'request' listener, so reply through its ServerResponse. The socket's current
  // response can also belong to an earlier request that this one was pipelined behind.
  const response = socket._httpMessage;
  if (response && response.req === req) {
    response.writeHead(code, headers);
    response.end(message);
    return;
  }

  // Another WebSocketServer on the same http.Server has already upgraded this connection.
  if (socket[kWebSocket]) return;

  socket.once("finish", socket.destroy);

  socket.end(
    `HTTP/1.1 ${code} ${STATUS_CODES[code]}\r\n` +
      Object.keys(headers)
        .map(h => `${h}: ${headers[h]}`)
        .join("\r\n") +
      "\r\n\r\n" +
      message,
  );
}

function abortHandshakeOrEmitwsClientError(
  server: WebSocketServer,
  req: ServerRequest,
  socket: ServerSocket,
  code: number,
  message: string,
  headers?: HttpHeaders,
): void {
  if (server.listenerCount("wsClientError")) {
    const err = new Error(message);
    Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);

    server.emit("wsClientError", err, socket, req);
  } else {
    abortServerHandshake(req, socket, code, message, headers);
  }
}

//
// lib/stream.js
//

function emitStreamClose(stream: Duplex): void {
  stream.emit("close");
}

function duplexOnEnd(this: WebSocketDuplex): void {
  if (!this.destroyed && this._writableState.finished) {
    this.destroy();
  }
}

function duplexOnError(this: WebSocketDuplex, err: Error): void {
  this.removeListener("error", duplexOnError);
  this.destroy();
  if (this.listenerCount("error") === 0) {
    // Do not suppress the throwing behavior.
    this.emit("error", err);
  }
}

function createWebSocketStream(ws: WebSocket, options?: import("node:stream").DuplexOptions): Duplex {
  const { Duplex } = require("node:stream");
  let terminateOnDestroy = true;

  const duplex = new Duplex({
    ...options,
    autoDestroy: false,
    emitClose: false,
    objectMode: false,
    writableObjectMode: false,
  }) as WebSocketDuplex;

  ws.on("message", function message(msg: Data, isBinary: boolean) {
    const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;

    if (!duplex.push(data)) ws.pause();
  });

  ws.once("error", function error(err: Error) {
    if (duplex.destroyed) return;

    // Prevent `ws.terminate()` from being called by `duplex._destroy()`. The connection is already closing, and
    // terminating it now could drop the Close frame being sent to the peer.
    terminateOnDestroy = false;
    duplex.destroy(err);
  });

  ws.once("close", function close() {
    if (duplex.destroyed) return;

    duplex.push(null);
  });

  duplex._destroy = function (err, callback) {
    if (ws.readyState === ws.CLOSED) {
      callback(err);
      process.nextTick(emitStreamClose, duplex);
      return;
    }

    let called = false;

    ws.once("error", function error(err: Error) {
      called = true;
      callback(err);
    });

    ws.once("close", function close() {
      if (!called) callback(err);
      process.nextTick(emitStreamClose, duplex);
    });

    if (terminateOnDestroy) ws.terminate();
  };

  duplex._final = function (callback) {
    if (ws.readyState === ws.CONNECTING) {
      ws.once("open", function open() {
        duplex._final(callback);
      });
      return;
    }

    // The client handshake failed. Wait for the `'error'` event that the websocket will emit.
    if (ws[kNative] === null) return;

    // Upstream checks `ws._socket._writableState.finished`, which is true once the closing handshake is done.
    if (ws.readyState === ws.CLOSED || (ws._closeFrameSent && ws._closeFrameReceived)) {
      callback();
      if (duplex._readableState.endEmitted) duplex.destroy();
    } else {
      // `duplex` is not destroyed here because the `'end'` event will be emitted on `duplex` after this `'finish'`
      // event. The EOF signaling `null` chunk is, in fact, pushed when the websocket emits `'close'`.
      ws[kFinalCallback] = callback;
      ws.close();
    }
  };

  duplex._read = function () {
    if (ws.isPaused) ws.resume();
  };

  duplex._write = function (chunk, encoding, callback) {
    if (ws.readyState === ws.CONNECTING) {
      ws.once("open", function open() {
        duplex._write(chunk, encoding, callback);
      });
      return;
    }

    ws.send(chunk, callback);
  };

  duplex.on("end", duplexOnEnd);
  duplex.on("error", duplexOnError);
  return duplex;
}

class Sender {
  constructor() {
    throw new Error("Not supported yet in Bun");
  }
}

class Receiver {
  constructor() {
    throw new Error("Not supported yet in Bun");
  }
}

export default Object.assign(WebSocket, {
  createWebSocketStream,
  extension: { format: extensionFormat, parse: extensionParse },
  Receiver,
  Sender,
  Server: WebSocketServer,
  subprotocol: { parse: subprotocolParse },
  WebSocket,
  WebSocketServer,
});
