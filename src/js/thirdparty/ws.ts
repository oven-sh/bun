// Hardcoded module "ws"
// The API of https://github.com/websockets/ws on Bun's native WebSocket client and server sockets.
// lib/websocket.js, websocket-server.js, event-target.js, stream.js, extension.js and subprotocol.js are
// ported from ws 8.22.0 (MIT). What they do with Sender and Receiver is native here.

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
const upgradeWebSocket = $newRustFunction("node_http_binding.rs", "upgradeNodeHTTPResponseToWebSocket", 8) as (
  response: unknown,
  websocket: WebSocket,
  handlers: ServerHandlers,
  handshake: string,
  maxPayload: number,
  flags: number,
  compression: number,
  head: Buffer | undefined,
) => NativeServer | undefined;
const serverSendFrame = $newRustFunction("node_http_binding.rs", "sendWebSocketFrame", 5) as (
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
const kHandshakeTimer = Symbol("kHandshakeTimer");
const kHeaders = Symbol("kHeaders");
const kInternalSocketData = Symbol.for("::bunternal::");
const kListener = Symbol("kListener");
const kNative = Symbol("kNative");
const kNativeOptions = Symbol("kNativeOptions");
const kOptions = Symbol("kOptions");
const kRequest = Symbol("kRequest");
const kResponse = Symbol("kResponse");
const kStatusCode = Symbol("status-code");
const kTransport = Symbol("kTransport");
const kUrl = Symbol("kUrl");
const kWebSocket = Symbol("websocket");
const kWriteCallback = Symbol("kWriteCallback");

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

// What `websocket[kNative]` is and who owns the connection.
const DIALLED = 0; // The native client, which connected by itself. `_socket` is a ClientSocket.
const UPGRADED = 1; // The native server socket, which took the connection of a node:http request over.
const STREAM = 2; // The native client's engine. It reads from and writes to `_socket`, which can be any Duplex.

const protocolVersions = [8, 13];
const readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
const subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;
const keyRegex = /^[+/0-9A-Za-z]{22}==$/;

type BinaryType = "nodebuffer" | "arraybuffer" | "fragments" | "blob";
type ReadyState = typeof CONNECTING | typeof OPEN | typeof CLOSING | typeof CLOSED;
type Transport = typeof DIALLED | typeof UPGRADED | typeof STREAM;
type Data = string | Buffer | ArrayBufferLike | Buffer[] | Blob;
type SendCallback = (err?: Error | null) => void;
// A literal with no prototype is written `{ __proto__: null as never }`: to TypeScript `__proto__` is one more key.
type Dictionary<T> = { [key: string]: T };

// node/http.ts has these two as `any`.
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

// What `websocket.listeners()` holds: the wrappers of addEventListener() among the listeners of `on()`.
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
  __proto__?: null;
  servername?: string;
  [option: string]: unknown;
}

type ProxyOption = string | URL | { url: string | URL; headers?: HttpHeaders | globalThis.Headers };

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
  ): void;
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
  handshake(this: WebSocket, statusCode: number, statusMessage: string, rawHeaders: string[], isUpgrade: boolean): void;
  body(this: WebSocket, chunk: Buffer | null, aborted: boolean, reset: boolean): void;
  open(this: WebSocket): void;
  error(this: WebSocket, error: NativeError): void;
  conclude(this: WebSocket, code: number, reason: string): void;
  close(this: WebSocket): void;
  write(this: WebSocket, chunk: Buffer): void;
  end(this: WebSocket): void;
  destroy(this: WebSocket): void;
}

// The socket of a node:http 'upgrade' event, of a server or of a client.
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

// An `http.Agent`, or one of the proxy agents, which keep where they connect to in these.
interface Agent extends HttpAgent {
  addRequest?: unknown;
  connectOpts?: AgentConnectOptions;
  createSocket?: unknown;
  options: AgentConnectOptions;
  proxy?: string | URL;
  proxyHeaders?: HttpHeaders | (() => HttpHeaders);
}

interface AgentConnectOptions extends HttpAgentOptions {
  proxy?: string | URL;
}

interface ClientOptions extends Omit<HttpsRequestOptions, "agent" | "headers" | "host" | "path" | "port"> {
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
type ResolvedClientOptions = ClientOptions & Required<Pick<ClientOptions, ClientDefaults>>;

// The request of `http.request()`, for what the native client cannot dial.
interface HttpClientRequest extends NodeClientRequest {
  [kAborted]: boolean;
  [kOptions]: RequestState;
  [kWebSocket]: WebSocket;
}

type HandshakeRequest = ClientRequest | HttpClientRequest;

// What a request keeps of the initAsClient() call that made it.
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

  // The accepted parameters as uWS CompressOptions: window << 4 | memLevel for the compressor, window << 8 for
  // the decompressor, 1 and 1 << 8 for the ones shared by the event loop. zlib has no 256 byte deflate window.
  get nativeOptions(): number {
    const params = this.params!;
    const deflateBits = Math.max(params.server_max_window_bits || 15, 9);
    const inflateBits = (params.client_max_window_bits as number) || 15;
    // 1 is the stream that the event loop shares: no context takeover, a window of 15 bits.
    // 1 << 12 is uWS::COMPRESSOR_NO_CONTEXT_TAKEOVER.
    const dedicated = (deflateBits << 4) | (deflateBits - 7);
    const compressor = !params.server_no_context_takeover ? dedicated : deflateBits < 15 ? dedicated | (1 << 12) : 1;

    return compressor | (params.client_no_context_takeover ? 1 << 8 : inflateBits << 8);
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
    // Not in npm ws. Bun's `ws` has always taken these two.
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
  declare [kCallbacks]: SendCallback[] | null;
  declare [kFirstFragment]: boolean;
  declare [kHandshakeTimer]: Timer | undefined;
  declare [kNative]: NativeClient | NativeServer | null;
  declare [kTransport]: Transport;
  declare [kWriteCallback]: SendCallback | undefined;

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
    this[kTransport] = DIALLED;
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

  // Sends `options[kHandshake]` and makes `socket` the connection. False, with nothing sent, when `socket` is a
  // connection of node:http that cannot be upgraded any more.
  setSocket(socket: ServerSocket, head: Buffer, options: SetSocketOptions): boolean {
    const perMessageDeflate = this._extensions[extensionName];
    const maxPayload = Math.max(options.maxPayload | 0, 0);

    // The native server socket takes over what the connection receives from now on. Frames that node:http has
    // read already, ahead of a `handleUpgrade()` that came late, are in `head` and in the buffer of `socket`.
    if (options[kResponse] && head.length === 0 && socket.readableLength === 0) {
      const native = upgradeWebSocket(
        options[kResponse],
        this,
        serverHandlers,
        options[kHandshake],
        maxPayload,
        (this._autoPong ? 1 : 0) | (options.skipUTF8Validation ? 2 : 0),
        perMessageDeflate ? perMessageDeflate.nativeOptions : 0,
        head,
      );

      if (native === undefined) return false;

      this[kNative] = native;
      this[kTransport] = UPGRADED;
    } else {
      const params = perMessageDeflate?.params;

      if (options[kHandshake]) socket.write(options[kHandshake]);

      this[kNative] = createWebSocketOverStream(
        {
          isServer: this._isServer,
          url: this._url || "",
          protocol: this._protocol,
          extensions: this.extensions,
          maxPayload,
          autoPong: !!this._autoPong,
          skipUTF8Validation: !!options.skipUTF8Validation,
          deflate: params
            ? {
                serverNoContextTakeover: !!params.server_no_context_takeover,
                clientNoContextTakeover: !!params.client_no_context_takeover,
                serverMaxWindowBits: params.server_max_window_bits || 15,
                clientMaxWindowBits:
                  typeof params.client_max_window_bits === "number" ? params.client_max_window_bits : 15,
              }
            : undefined,
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
    failCallbacks(this);
    this.emit("close", this._closeCode, this._closeMessage);
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

        // What is not UTF-8 became U+FFFD, which takes three bytes.
        if (Buffer.byteLength(data) > 123) {
          throw new RangeError("The message must not be greater than 123 bytes");
        }
      }
    }

    // The peer's answer can arrive inside the call when `_socket` is a stream in memory.
    this._closeFrameSent = true;
    this._readyState = CLOSING;
    setCloseTimer(this);

    // 1005 is the native spelling of a Close frame with no body.
    if (this[kTransport] === UPGRADED) this[kNative]!.close(code === undefined ? 1005 : code, data);
    else if (code === undefined) this[kNative]!.close();
    else this[kNative]!.close(code, data);
  }

  pause(): void {
    if (this.readyState === CONNECTING || this.readyState === CLOSED) {
      return;
    }

    this._paused = true;
    if (this[kTransport] !== DIALLED) (this._socket as ServerSocket).pause();
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
    if (this[kTransport] !== DIALLED) (this._socket as ServerSocket).resume();
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

    this[kFirstFragment] = !!fin;

    const transport = this[kTransport];

    if (transport === UPGRADED) {
      written(this, serverSendFrame(this[kNative] as NativeServer, data, opcode, !!fin, !!compress) === -1, cb);
    } else if (transport === DIALLED) {
      clientSendFrame(this[kNative] as NativeClient, data, opcode, !!fin, !!compress);
      written(this, (this[kNative] as NativeClient).bufferedAmount !== 0, cb);
    } else {
      this[kWriteCallback] = cb;
      clientSendFrame(this[kNative] as NativeClient, data, opcode, !!fin, !!compress);
      writeCallbackNotTaken(this);
    }
  }

  terminate(): void {
    if (this.readyState === CLOSED) return;
    if (this.readyState === CONNECTING) {
      const msg = "WebSocket was closed before the connection was established";
      abortHandshake(this, this._req!, msg);
      return;
    }

    const native = this[kNative];
    if (native === null) return;

    this._readyState = CLOSING;
    native.terminate();
    if (this[kTransport] !== DIALLED) this._socket!.destroy();
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
  const stream = websocket[kTransport] === STREAM;

  if (stream) websocket[kWriteCallback] = cb;

  if (!data) {
    if (opcode === 0x09) native.ping();
    else native.pong();
  } else {
    if (typeof data !== "string" && !isBlob(data)) data = toBuffer(data);

    const byteLength = typeof data === "string" ? Buffer.byteLength(data) : isBlob(data) ? data.size : data.length;

    if (byteLength > 125) {
      websocket[kWriteCallback] = undefined;
      throw new RangeError("The data size must not be greater than 125 bytes");
    }

    if (opcode === 0x09) native.ping(data);
    else native.pong(data);
  }

  if (stream) writeCallbackNotTaken(websocket);
  else written(websocket, nativeBufferedAmount(websocket) !== 0, cb);
}

function nativeBufferedAmount(websocket: WebSocket): number {
  switch (websocket[kTransport]) {
    case DIALLED:
      return (websocket[kNative] as NativeClient).bufferedAmount;
    case UPGRADED:
      return (websocket[kNative] as NativeServer).getBufferedAmount();
    default:
      return (websocket._socket as ServerSocket).writableLength;
  }
}

// A callback runs once its frame has left for the kernel, like the callback of `socket.write()`.
function written(websocket: WebSocket, buffered: boolean, cb: SendCallback | undefined): void {
  if (buffered) {
    if (cb) (websocket[kCallbacks] ??= []).push(cb);
    return;
  }

  // Nothing waits any more, so the frames before this one have left too. Their callbacks come first.
  const earlier = websocket[kCallbacks];
  if (earlier !== null) {
    websocket[kCallbacks] = null;
    for (let i = 0; i < earlier.length; i++) process.nextTick(earlier[i], null);
  }

  if (cb) process.nextTick(cb, null);
}

// The engine has no frame to write any more: the `write` handler did not run.
function writeCallbackNotTaken(websocket: WebSocket): void {
  const cb = websocket[kWriteCallback];
  if (cb === undefined) return;

  websocket[kWriteCallback] = undefined;
  process.nextTick(cb, $ERR_STREAM_DESTROYED("write"));
}

function runCallbacks(websocket: WebSocket): void {
  const callbacks = websocket[kCallbacks];
  if (callbacks === null) return;

  websocket[kCallbacks] = null;
  for (let i = 0; i < callbacks.length; i++) callbacks[i](null);
}

function failCallbacks(websocket: WebSocket): void {
  const callbacks = websocket[kCallbacks];
  if (callbacks === null) return;

  websocket[kCallbacks] = null;
  const err = $ERR_STREAM_DESTROYED("write");
  for (let i = 0; i < callbacks.length; i++) callbacks[i](err);
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

function abortHandshake(websocket: WebSocket, req: HandshakeRequest, message: string): void {
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

  process.nextTick(emitErrorAndClose, websocket, err);
}

function closeTimerOnTimeout(websocket: WebSocket): void {
  websocket[kNative]!.terminate();
  if (websocket[kTransport] !== DIALLED) websocket._socket!.destroy();
}

function setCloseTimer(websocket: WebSocket): void {
  websocket._closeTimer = setTimeout(closeTimerOnTimeout, websocket._closeTimeout, websocket);
}

// [constructor, message, "Invalid WebSocket frame: " prefix, status code] of lib/receiver.js, by error code.
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
} as const;
type ReceiverErrorCode = Exclude<keyof typeof receiverErrors, "__proto__">;

// The order of uWS::WebSocketFailureKind.
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

// The native side has sent the Close frame with the status code of `err` and ends the connection.
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

// The closing handshake is over, or (1006) the connection ended without one. `_socket` is about to close.
function receiverOnConclude(websocket: WebSocket, code: number, reason: Buffer): void {
  if (code !== 1006) {
    websocket._closeFrameReceived = true;
    websocket._closeFrameSent = true;
    websocket._closeMessage = reason;
    websocket._closeCode = code;

    if (websocket._readyState === OPEN) setCloseTimer(websocket);
  }

  if (websocket._readyState !== CLOSED) websocket._readyState = CLOSING;
}

//
// What the native sockets call. `this` is the WebSocket.
//

const serverHandlers: ServerHandlers = {
  message(data, isBinary) {
    this.emit("message", isBinary ? binaryMessage(this, data) : data, isBinary);
  },
  ping(data) {
    this.emit("ping", data);
  },
  pong(data) {
    this.emit("pong", data);
  },
  drain() {
    if (nativeBufferedAmount(this) === 0) runCallbacks(this);
  },
  // `code` is the status code of the peer's Close frame (1005 without one in it), which the native side has
  // answered; 1006 when the connection ended with no Close frame; the negated uWS::WebSocketFailureKind, with its
  // detail in `reason`, when the native side failed the connection.
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
  // `req.on('response')` and `req.on('upgrade')` of initAsClient().
  // `isUpgrade`: a 101 that llhttp takes for an upgrade, which needs an `Upgrade` header and `Connection: upgrade`.
  handshake(statusCode, statusMessage, rawHeaders, isUpgrade) {
    const req = this._req as ClientRequest;

    if (!isUpgrade) {
      if (followRedirect(this, req, statusCode, headerValue(rawHeaders, "location"))) return;

      // All that the native socket still does is to read the body. What happens next is up to the listener, as
      // with a real response.
      clearTimeout(this[kHandshakeTimer]);

      const res = (req.res = makeHandshakeResponse(statusCode, statusMessage, rawHeaders));

      res[kRequest] = req;
      res._read = responseRead;
      res.once("close", responseOnClose);

      if (!this.emit("unexpected-response", req, res)) {
        abortHandshake(this, req, `Unexpected server response: ${statusCode}`);
      }
      return;
    }

    if (this.listenerCount("upgrade") > 0) {
      const res = makeHandshakeResponse(statusCode, statusMessage, rawHeaders);

      res.complete = true;
      res.push(null);
      this.emit("upgrade", res);

      // The user may have closed the connection from a listener of the `'upgrade'` event.
      if (this.readyState !== CONNECTING) return;
    }

    validateUpgrade(this, req, rawHeaders, headerValue(rawHeaders, "upgrade"));
  },
  // The body of a response that is no 101, then `null`. `aborted`: the connection ended before the body did.
  // `reset`: it ended with an error, which fails the request too.
  body(chunk, aborted, reset) {
    const req = this._req as ClientRequest | null;
    const res = req?.res;

    if (!res) return;

    if (aborted) {
      res.destroy(connResetException("aborted"));
    } else {
      if (chunk === null) res.complete = true;
      if (!res.push(chunk) && chunk !== null) req[kNative]?.pause();
    }

    if (reset) {
      const err = connResetException("read ECONNRESET");

      err.errno = -require("node:os").constants.errno.ECONNRESET;
      err.syscall = "read";
      requestOnDestroyed(req, err);
    }
  },
  open() {
    clearTimeout(this[kHandshakeTimer]);
    this._socket = new ClientSocket(this[kNative] as NativeClient);
    this._readyState = OPEN;
    this.emit("open");
  },
  error(error) {
    const { code } = error;

    if (this._readyState !== CONNECTING) {
      receiverOnError(
        this,
        code! in receiverErrors ? createReceiverError(code as ReceiverErrorCode, error.$detail) : error,
      );
      return;
    }

    // What `req.on('error')` gets from node:http.
    const native = this[kNative] as NativeClient;

    clearTimeout(this[kHandshakeTimer]);
    detach(native);
    this[kNative] = null;
    this._req = null;
    emitErrorAndClose(this, connectError(native, error));
  },
  // The peer's Close frame has arrived, and ours is out.
  conclude(code, reason) {
    receiverOnConclude(this, code, Buffer.from(reason));
  },
  // The connection is closed. That of a stream is `_socket`, whose 'close' event says so.
  close() {
    if (this[kTransport] === STREAM) return;

    clearTimeout(this._closeTimer!);
    this.emitClose();
  },
  write(chunk) {
    const cb = this[kWriteCallback];

    this[kWriteCallback] = undefined;
    (this._socket as ServerSocket).write(chunk, cb);
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

    // The socket closed with data still in its buffer: it may hold the Close frame.
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
// The handshake of a client.
//
//
// The native client socket. `this` is the native WebSocket.
//

// `websocket._socket` of a client: the part of a `net.Socket` that people reach for there.
class ClientSocket {
  declare [kNative]: NativeClient;

  constructor(native: NativeClient) {
    this[kNative] = native;
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

function connectError(native: NativeClient, error: NativeError): Error {
  const { code } = error;
  if (code === undefined) {
    return error;
  }

  const detail = error.$detail;
  let err: ConnectError;

  if (detail) {
    err = new Error(detail);
    if (detail.startsWith("read ")) err.syscall = "read";
  } else if (code === "ECONNRESET") {
    err = new Error("socket hang up");
  } else if (code === "HPE_INVALID_CONSTANT") {
    err = new Error("Parse Error: Expected HTTP/, RTSP/ or ICE/");
  } else {
    const url = new URL(native.url);
    if (code === "ENOTFOUND") {
      err = new Error(`getaddrinfo ENOTFOUND ${url.hostname}`);
      err.syscall = "getaddrinfo";
      err.hostname = url.hostname;
    } else if (url.protocol === "ws+unix:" || url.protocol === "wss+unix:") {
      const path = url.pathname.split(":")[0];
      err = new Error(`connect ${code} ${path}`);
      err.syscall = "connect";
      err.address = path;
    } else {
      const port = +url.port || (url.protocol === "wss:" ? 443 : 80);
      const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
      err = new Error(`connect ${code} ${host}:${port}`);
      err.syscall = "connect";
      err.address = host;
      err.port = port;
    }
  }

  const errno = (require("node:os").constants.errno as Dictionary<number | undefined>)[code];
  if (errno !== undefined) err.errno = -errno;
  err.code = code;
  return err;
}

// `_read()` and `'close'` of a response whose body the native client reads.
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

// True when `req` got a redirect, which is followed or fails the handshake.
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

// The checks of `req.on('upgrade')`. False when they fail the handshake.
function validateUpgrade(
  websocket: WebSocket,
  req: HandshakeRequest,
  rawHeaders: string[],
  upgrade: string | undefined,
): boolean {
  const { protocolSet, perMessageDeflate } = req[kOptions];

  websocket._req = null;

  if (upgrade === undefined || upgrade.toLowerCase() !== "websocket") {
    abortHandshake(websocket, req, "Invalid Upgrade header");
    return false;
  }

  if (
    headerValue(rawHeaders, "sec-websocket-accept") !==
    Bun.SHA1.hash(req.getHeader("sec-websocket-key") + GUID, "base64")
  ) {
    abortHandshake(websocket, req, "Invalid Sec-WebSocket-Accept header");
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
    abortHandshake(websocket, req, protError);
    return false;
  }

  if (serverProt) websocket._protocol = serverProt;

  const secWebSocketExtensions = headerValue(rawHeaders, "sec-websocket-extensions");

  if (secWebSocketExtensions !== undefined) {
    if (!perMessageDeflate) {
      const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
      abortHandshake(websocket, req, message);
      return false;
    }

    let extensions: ExtensionOffers;

    try {
      extensions = extensionParse(secWebSocketExtensions);
    } catch {
      const message = "Invalid Sec-WebSocket-Extensions header";
      abortHandshake(websocket, req, message);
      return false;
    }

    const extensionNames = Object.keys(extensions);

    if (extensionNames.length !== 1 || extensionNames[0] !== extensionName) {
      const message = "Server indicated an extension that was not requested";
      abortHandshake(websocket, req, message);
      return false;
    }

    try {
      perMessageDeflate.accept(extensions[extensionName]);
    } catch {
      const message = "Invalid Sec-WebSocket-Extensions header";
      abortHandshake(websocket, req, message);
      return false;
    }

    websocket._extensions[extensionName] = perMessageDeflate;
  }

  return true;
}

function handshakeOnTimeout(websocket: WebSocket): void {
  abortHandshake(websocket, websocket._req!, "Opening handshake has timed out");
}

function extractAgentOptions(agent: Agent): {
  connectOpts: AgentConnectOptions | undefined;
  proxy: ProxyOption | null;
} {
  let connectOpts = Object.hasOwn(agent, "connectOpts") ? agent.connectOpts : undefined;
  connectOpts ||= Object.hasOwn(agent, "options") ? agent.options : undefined;
  if (!$isObject(connectOpts)) connectOpts = undefined;
  let proxy: ProxyOption | null = null;

  // Only an HTTP proxy is something the native client can go through. The `proxy` of a SOCKS agent is no URL.
  const agentProxy = connectOpts?.proxy || agent?.proxy;
  const proxyUrl = (agentProxy as URL)?.href || agentProxy;
  if (typeof proxyUrl === "string" && (proxyUrl.startsWith("http:") || proxyUrl.startsWith("https:"))) {
    if (agent?.proxyHeaders) {
      const proxyHeaders: HttpHeaders = $isCallable(agent.proxyHeaders)
        ? agent.proxyHeaders.$call(agent)
        : agent.proxyHeaders;
      proxy = { url: proxyUrl, headers: proxyHeaders };
    } else {
      proxy = proxyUrl;
    }
  }

  return { connectOpts, proxy };
}

// Whether `agent` has its own way to make a connection.
function connectsItself(agent: Agent): boolean {
  const { prototype } = lazyHttp().Agent as unknown as { prototype: Agent };

  return (
    agent.addRequest !== prototype.addRequest ||
    agent.createSocket !== prototype.createSocket ||
    (agent.createConnection !== prototype.createConnection &&
      agent.createConnection !== require("node:https").Agent.prototype.createConnection)
  );
}

// The `http.ClientRequest` of a handshake that the native client makes, for `'redirect'`, `'unexpected-response'`
// and `websocket._req`. `end()` dials.
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
  declare [kAborted]: boolean;
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
    this[kAborted] = false;
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

      headers[entry[0]] = $isArray(value) ? value.join(", ") : value;
    }
    nativeOptions.headers = headers;
    nativeOptions.extensions = this[kHeaders]["sec-websocket-extensions"]?.[1] as string | undefined;

    let native: NativeClient;
    try {
      native = createWebSocket(this[kUrl], nativeOptions, websocket, clientHandlers);
    } catch (err) {
      // The caller of the constructor catches it. After a redirect there is no caller.
      if (websocket._redirects === 0) throw err;

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

    clearTimeout(this[kWebSocket][kHandshakeTimer]);

    const { res } = this;

    if (res !== null && !res.complete) {
      // What the native client has read along with the head is delivered when the 'unexpected-response' listeners
      // return. The parser of node:http finishes the chunk it holds, too.
      res.resume();
      process.nextTick(releaseNative, this);
    } else {
      releaseNative(this);
    }

    // A request that its owner destroys fails the handshake, as `req.on('error')` would see it. One that got its
    // response has nothing to report but `err`.
    if (!err && res === null) err = connResetException("socket hang up");

    if (err) process.nextTick(requestOnDestroyed, this, err);

    process.nextTick(emitRequestClose, this);
    return this;
  }
}

function connResetException(message: string): ConnectError {
  const err: ConnectError = new Error(message);
  err.code = "ECONNRESET";
  return err;
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

  // As the 'close' of the socket does in node:http.
  if (res !== null && !res.complete) res.destroy(connResetException("aborted"));
}

// The 'error' event of a ClientRequest: the listener of initAsClient() comes first.
function requestOnDestroyed(req: ClientRequest, err: Error): void {
  const aborted = req[kAborted];

  requestFailed(req, err);

  if (!aborted && req.listenerCount("error") > 0) req.emit("error", err);
}

// `req.on('error')` of initAsClient().
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
// The listeners of a request of `http.request()`.
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

// `options` are those of the request, as `http.Agent` hands them to `createConnection()`.
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

  // "wss+unix:" is an addition of Bun.
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
  let connectOpts: AgentConnectOptions | undefined;
  if ($isObject(agent)) {
    const agentOpts = extractAgentOptions(agent);
    connectOpts = agentOpts.connectOpts;
    proxy ||= agentOpts.proxy;
  }

  // What only `http.request()` can do. The native engine takes its socket over after the 101.
  if (
    !proxy &&
    (opts.createConnection ||
      opts.lookup ||
      protocolVersion !== 13 ||
      opts.family ||
      opts.localAddress ||
      opts.localPort ||
      opts.finishRequest ||
      ($isObject(agent) && connectsItself(agent)))
  ) {
    opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
    opts.defaultPort = opts.defaultPort || defaultPort;
    opts.timeout = handshakeTimeout;

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

  if (proxy) nativeOptions.proxy = proxy;

  let tls = opts.tls;
  if ($isObject(tls)) {
    tls = require("internal/tls").unsealPfxForNative(tls);
  } else if (!tls && options) {
    // The agent wins: https://github.com/nodejs/node/blob/v26.3.0/lib/_http_agent.js#L305
    tls = require("internal/tls").nodeClientTlsToNative({ __proto__: null, ...options, ...connectOpts });
  }
  if (tls) nativeOptions.tls = tls;

  // The credentials travel in the Authorization header below, an empty fragment nowhere.
  let url = parsedUrl.href;
  if (username || password || url.endsWith("#")) {
    const bare = new URL(url);
    bare.username = bare.password = bare.hash = "";
    url = bare.href;
  }

  const req = (websocket._req = new ClientRequest(websocket, url, nativeOptions, state));

  const headers = req[kHeaders];
  for (const name in opts.headers) {
    const value = opts.headers[name];
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

  // Throws for a header that cannot be sent.
  if (!opts.finishRequest) req.end();

  if (handshakeTimeout && !req.destroyed) {
    websocket[kHandshakeTimer] = setTimeout(handshakeOnTimeout, handshakeTimeout, websocket);
  }

  if (opts.finishRequest) opts.finishRequest(req, websocket);
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
      abortServerHandshake(socket, 400);
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
            return abortServerHandshake(socket, code || 401, message, headers);
          }

          this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
        });
        return;
      }

      if (!this.options.verifyClient(info)) return abortServerHandshake(socket, 401);
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

    if (this._state > RUNNING) return abortServerHandshake(socket, 503);

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
      return abortServerHandshake(socket, 500);
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

// The native response of `req`. A request that node:http did not make (a framework's own object) stands for the
// one its socket was handed over with.
function nativeResponse(req: ServerRequest, socket: ServerSocket): unknown {
  const response = req[(kHeaderSource ??= require("internal/http").kHeaderSource)];
  return response === undefined ? socket[kInternalSocketData] : response;
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

function abortServerHandshake(socket: ServerSocket, code: number, message?: string, headers?: HttpHeaders): void {
  const { STATUS_CODES } = lazyHttp();
  message = message || STATUS_CODES[code];
  headers = {
    Connection: "close",
    "Content-Type": "text/html",
    "Content-Length": Buffer.byteLength(message),
    ...headers,
  };

  // handleUpgrade() was called from a 'request' listener: answer through its ServerResponse.
  const response = socket._httpMessage;
  if (response) {
    response.writeHead(code, headers);
    response.end(message);
    return;
  }

  // Another WebSocketServer on the same http.Server has already taken this connection.
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
    abortServerHandshake(socket, code, message, headers);
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

    // Prevent `ws.terminate()` from being called by `duplex._destroy()`: the connection is closing already, and
    // a Close frame may be on its way to the other peer.
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

    // The handshake of a client failed: wait for the `'error'` event that the websocket will emit.
    if (ws[kNative] === null) return;

    if (ws.readyState === ws.CLOSED) {
      callback();
      if (duplex._readableState.endEmitted) duplex.destroy();
    } else {
      // The writable side is finished when the closing handshake is, ahead of the EOF signaling `null` chunk
      // that the listener above pushes.
      ws.prependOnceListener("close", function close() {
        callback();
      });
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
