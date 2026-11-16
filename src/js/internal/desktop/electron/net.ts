const { Readable, Writable } = require("node:stream");
const loader = require("internal/desktop/electron/loader");
const { originOf } = require("internal/desktop/electron/policy");
const { kState, defaultSession, fromPartition } = require("internal/desktop/electron/session");

const sessionOf = (options: any) => options.session ?? fromPartition(options.partition);
const firstWins =
  /^(?:age|authorization|content-length|content-type|etag|expires|from|host|if-modified-since|if-unmodified-since|last-modified|location|max-forwards|proxy-authorization|referer|retry-after|server|user-agent)$/;

class IncomingMessage extends Readable {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string | string[]> = {};
  rawHeaders: string[];
  httpVersion = "1.1";
  httpVersionMajor = 1;
  httpVersionMinor = 1;
  #reader: ReadableStreamDefaultReader | undefined;

  constructor(loaded: any) {
    super();
    this.statusCode = loaded.status;
    this.statusMessage = loaded.statusText;
    this.rawHeaders = loaded.headers.flat();
    for (const [given, value] of loaded.headers) {
      const name = given.toLowerCase();
      if (name === "set-cookie") ((this.headers[name] ??= []) as string[]).push(value);
      else if (!Object.hasOwn(this.headers, name)) this.headers[name] = value;
      else if (!firstWins.test(name)) this.headers[name] += ", " + value;
    }
    this.#reader = loaded.response?.body.getReader();
  }

  _read() {
    if (!this.#reader) return void this.push(null);
    this.#reader.read().then(
      ({ done, value }) => this.push(done ? null : Buffer.from(value.buffer, value.byteOffset, value.byteLength)),
      error => this.destroy(loader.toNetError(error)),
    );
  }

  _destroy(error: Error | null, callback: Function) {
    this.#reader?.cancel().catch(() => {});
    callback(error);
  }
}

function urlOf(options: any) {
  const { url } = options;
  if (url) return String(url);
  const host = options.host ?? `${options.hostname ?? "localhost"}${options.port ? ":" + options.port : ""}`;
  if (/ /.test(options.path ?? "")) throw new TypeError("Request path contains unescaped characters");
  return new URL(options.path ?? "/", `${options.protocol ?? "http:"}//${host}`).href;
}

class ClientRequest extends Writable {
  chunkedEncoding = false;
  #options;
  #headers = new Map<string, [string, string]>();
  #controller = new AbortController();
  #chunks: Buffer[] = [];
  #upload: WritableStreamDefaultWriter | undefined;
  #started = false;
  #follows = false;
  #response: IncomingMessage | undefined;

  constructor(options: any, callback?: (response: IncomingMessage) => void) {
    super({ autoDestroy: false });
    options = typeof options === "string" ? { url: options } : options;
    this.#options = { ...options, url: urlOf(options), session: sessionOf(options) };
    for (const name in options.headers) this.setHeader(name, options.headers[name]);
    if (callback) this.once("response", callback);
  }

  setHeader(name: string, value: unknown) {
    if (this.#started) throw new Error("Can't set headers after they are sent");
    if (value == null) throw new Error('`value` required in setHeader("' + name + '", value)');
    require("node:http").validateHeaderName(name);
    require("node:http").validateHeaderValue(name, value as any);
    this.#headers.$set(name.toLowerCase(), [name, $isArray(value) ? value.join(", ") : String(value)]);
  }

  getHeader(name: string) {
    return this.#headers.$get(name.toLowerCase())?.[1];
  }

  removeHeader(name: string) {
    if (this.#started) throw new Error("Can't remove headers after they are sent");
    this.#headers.$delete(name.toLowerCase());
  }

  followRedirect() {
    this.#follows = true;
  }

  getUploadProgress() {
    return { active: false, started: false, current: 0, total: 0 };
  }

  abort() {
    if (this.#controller.signal.aborted) return;
    this.#controller.abort();
    process.nextTick(() => {
      this.emit("abort");
      this.#response?.emit("aborted");
      this.destroy();
    });
    this.#response?.destroy();
  }

  _write(chunk: Buffer, _: string, callback: (error?: Error) => void) {
    if (!this.chunkedEncoding) {
      this.#chunks.push(chunk);
      return callback();
    }
    if (!this.#upload) {
      const { readable, writable } = new TransformStream();
      this.#upload = writable.getWriter();
      this.#start(readable);
    }
    this.#upload.write(chunk).then(
      () => callback(),
      () => callback(),
    );
  }

  _final(callback: () => void) {
    if (this.#upload) this.#upload.close().catch(() => {});
    else this.#start(this.#chunks.length > 0 ? Buffer.concat(this.#chunks) : null);
    callback();
  }

  #start(body: unknown) {
    this.#started = true;
    const { url, method = "GET", session, origin, redirect = "follow", credentials, useSessionCookies } = this.#options;
    const sendsCookies =
      credentials === undefined
        ? useSessionCookies
        : credentials === "include" || (credentials === "same-origin" && origin === originOf(url));
    const { signal } = this.#controller;
    let refused: Error | undefined;
    const request = {
      url,
      method: method.toUpperCase(),
      headers: [...this.#headers.values()],
      body,
      origin,
      signal,
      credentials: sendsCookies ? "include" : "omit",
      bypassCustomProtocolHandlers: this.#options.bypassCustomProtocolHandlers,
      onRedirect: (status: number, method: string, target: string, headers: [string, string][]) => {
        if (redirect === "error") {
          refused = new Error("Attempted to redirect, but redirect policy was 'error'");
          return false;
        }
        this.#follows = redirect === "follow";
        this.emit("redirect", status, method, target, loader.group(headers));
        if (!this.#follows) refused = new Error("Redirect was cancelled");
        return this.#follows;
      },
    };
    loader.load(session[kState], request).then(
      loaded => {
        if (signal.aborted) return;
        this.#response = new IncomingMessage(loaded);
        this.#response.once("close", () => this.destroy());
        this.emit("response", this.#response);
      },
      error => signal.aborted || this.destroy(refused ?? error),
    );
  }
}

/** It connects once the proxy is known. */
class SessionWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  url: string;
  onopen = null;
  onmessage = null;
  onerror = null;
  onclose = null;
  #socket: WebSocket | undefined;
  #binaryType = "nodebuffer";
  #state = 0;

  constructor(url: string | URL, options: any = {}) {
    super();
    if (typeof options === "string" || $isArray(options)) options = { protocols: options };
    const { jar, socketOptions, userAgent } = sessionOf(options)[kState];
    const parsed = new URL(url);
    if (!/^wss?:$/.test(parsed.protocol))
      throw new DOMException("The URL's scheme must be 'ws' or 'wss'.", "SyntaxError");
    this.url = parsed.href;
    for (const type of ["open", "message", "error", "close"]) {
      this.addEventListener(type, event => this["on" + type]?.(event));
    }
    Promise.try(socketOptions, parsed)
      .then(connection => {
        if (this.#state !== 0) throw loader.netError("ABORTED");
        const cookie = options.useSessionCookies && jar.header(parsed, {});
        const socket = (this.#socket = new WebSocket(parsed.href, {
          ...(connection as object),
          protocols: [options.protocols ?? []].flat(),
          headers: {
            "user-agent": userAgent(),
            ...(options.origin && { origin: options.origin }),
            ...(cookie && { cookie }),
            ...options.headers,
          },
        } as any));
        socket.binaryType = this.#binaryType as any;
        (socket as any).onopen = () => this.dispatchEvent(new Event("open"));
        (socket as any).onmessage = ({ data }) => this.dispatchEvent(new MessageEvent("message", { data }));
        (socket as any).onerror = () => this.dispatchEvent(new Event("error"));
        (socket as any).onclose = event => this.dispatchEvent(new CloseEvent("close", event));
      })
      .catch(() => {
        this.#state = 3;
        this.dispatchEvent(new Event("error"));
        this.dispatchEvent(new CloseEvent("close", { code: 1006 }));
      });
  }

  get readyState() {
    return this.#socket?.readyState ?? this.#state;
  }
  get bufferedAmount() {
    return this.#socket?.bufferedAmount ?? 0;
  }
  get protocol() {
    return this.#socket?.protocol ?? "";
  }
  get extensions() {
    return this.#socket?.extensions ?? "";
  }
  get binaryType() {
    return this.#binaryType;
  }
  set binaryType(type) {
    this.#binaryType = type;
    if (this.#socket) this.#socket.binaryType = type as any;
  }

  send(data: any) {
    if (this.readyState === 0) throw new DOMException("Still in CONNECTING state.", "InvalidStateError");
    this.#socket?.send(data);
  }

  close(code?: number, reason?: string) {
    if (this.#socket) this.#socket.close(code, reason);
    else this.#state ||= 2;
  }
}

const net = {
  WebSocket: SessionWebSocket,
  fetch: (input: any, init?: any) => defaultSession().fetch(input, init),
  request: (options: any, callback?: any) => new ClientRequest(options, callback),
  resolveHost: (host: string, options?: any) => defaultSession().resolveHost(host, options),
  isOnline: () => require("internal/desktop/electron/session").isOnline(),
  get online() {
    return net.isOnline();
  },
};

export default { net };
