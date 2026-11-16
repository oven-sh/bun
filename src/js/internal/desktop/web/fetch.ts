// `Headers`, `Request`, `Response` and `fetch()`. The requests are made by `electron/loader`, in the main realm.
const idl = require("internal/desktop/web/idl");
const mime = require("internal/desktop/web/mime");
const { NativeFormData } = require("internal/desktop/web/dom").core;
const isDisturbed = $newCppFunction("DesktopRealm.cpp", "jsFunctionDesktopRealmIsDisturbed", 1);

const { byteString, dictionary, expose, internal, need, oneOf, scope, usv } = idl;
const encoder = new TextEncoder();
const isStream = (value: unknown) => isDisturbed(value) !== undefined;

type Pair = [string, string];

const enum Guard {
  None,
  Request,
  NoCors,
  Response,
  Immutable,
}

class HeaderList {
  /** The names are as they were first given. */
  pairs: Pair[] = [];
  #sorted: Pair[] | undefined;

  constructor(from?: Iterable<string[]>) {
    if (from) for (const pair of from) this.pairs.push([pair[0], pair[1]]);
  }

  get(lower: string): string | null {
    let found: string | null = null;
    for (const [name, value] of this.pairs) {
      if (name.toLowerCase() === lower) found = found === null ? value : found + ", " + value;
    }
    return found;
  }

  append(name: string, value: string) {
    const lower = name.toLowerCase();
    this.pairs.push([this.pairs.find(pair => pair[0].toLowerCase() === lower)?.[0] ?? name, value]);
    this.#sorted = undefined;
  }

  remove(lower: string) {
    this.pairs = this.pairs.filter(pair => pair[0].toLowerCase() !== lower);
    this.#sorted = undefined;
  }

  set(name: string, value: string) {
    const lower = name.toLowerCase();
    const first = this.pairs.find(pair => pair[0].toLowerCase() === lower);
    this.pairs = this.pairs.filter(pair => pair === first || pair[0].toLowerCase() !== lower);
    if (first) first[1] = value;
    else this.pairs.push([name, value]);
    this.#sorted = undefined;
  }

  sorted(): Pair[] {
    if (this.#sorted) return this.#sorted;
    const sorted: Pair[] = (this.#sorted = []);
    for (const name of [...new Set(this.pairs.map(pair => pair[0].toLowerCase()))].sort()) {
      if (name !== "set-cookie") sorted.push([name, this.get(name)!]);
      else for (const pair of this.pairs) if (pair[0].toLowerCase() === name) sorted.push([name, pair[1]]);
    }
    return sorted;
  }
}

function headerName(given: unknown): string {
  const name = byteString(given);
  if (!mime.isToken(name)) throw new TypeError(`Invalid header name: '${name}'`);
  return name;
}

function headerValue(given: unknown): string {
  const value = mime.trim(byteString(given));
  if (/[\0\n\r]/.test(value)) throw new TypeError("Invalid header value");
  return value;
}

function pairsOf(init: any): unknown[][] {
  if (!$isObject(init)) throw new TypeError("The provided value is not of type 'HeadersInit'.");
  if (init[Symbol.iterator] != null) return idl.sequence(init).map(pair => idl.sequence(pair).map(byteString));
  const pairs: unknown[][] = [];
  for (const key of Reflect.ownKeys(init)) {
    if (Reflect.getOwnPropertyDescriptor(init, key)?.enumerable) pairs.push([byteString(key), byteString(init[key])]);
  }
  return pairs;
}

const isNoCorsName = (lower: string) => /^(?:accept|accept-language|content-language|content-type)$/.test(lower);

let makeHeaders: (list: HeaderList, guard: Guard) => Headers;
let listOf: (headers: any) => HeaderList | undefined;

class Headers {
  #list = new HeaderList();
  #guard = Guard.None;

  constructor(init: any = undefined) {
    if (init !== undefined) fill(this, pairsOf(init));
  }

  static {
    makeHeaders = (list, guard) => {
      const headers = new Headers();
      headers.#list = list;
      headers.#guard = guard;
      return headers;
    };
    listOf = headers => ($isObject(headers) && #list in headers ? headers.#list : undefined);
    idl.iterable(this, (self: Headers) => self.#list.sorted());
  }

  #allows(lower: string, value: string) {
    if (this.#guard === Guard.Immutable) throw new TypeError("Headers are immutable");
    if (this.#guard === Guard.Request) return !mime.isForbiddenHeader(lower, value);
    return this.#guard !== Guard.Response || !/^set-cookie2?$/.test(lower);
  }

  append(name: string, value: string) {
    const list = this.#list;
    need(arguments.length, 2);
    const lower = (name = headerName(name)).toLowerCase();
    if (!this.#allows(lower, (value = headerValue(value)))) return;
    if (this.#guard === Guard.NoCors) {
      const before = list.get(lower);
      if (!isNoCorsName(lower) || !mime.isSafelisted(lower, before === null ? value : before + ", " + value)) return;
      list.remove("range");
    }
    list.append(name, value);
  }

  delete(name: string) {
    const list = this.#list;
    need(arguments.length, 1);
    const lower = headerName(name).toLowerCase();
    if (!this.#allows(lower, "")) return;
    if (this.#guard === Guard.NoCors && !isNoCorsName(lower) && lower !== "range") return;
    if (list.get(lower) === null) return;
    list.remove(lower);
    if (this.#guard === Guard.NoCors) list.remove("range");
  }

  get(name: string) {
    const list = this.#list;
    need(arguments.length, 1);
    return list.get(headerName(name).toLowerCase());
  }

  getSetCookie() {
    return this.#list.pairs.filter(pair => pair[0].toLowerCase() === "set-cookie").map(pair => pair[1]);
  }

  has(name: string) {
    const list = this.#list;
    need(arguments.length, 1);
    return list.get(headerName(name).toLowerCase()) !== null;
  }

  set(name: string, value: string) {
    const list = this.#list;
    need(arguments.length, 2);
    const lower = (name = headerName(name)).toLowerCase();
    if (!this.#allows(lower, (value = headerValue(value)))) return;
    if (this.#guard === Guard.NoCors) {
      if (!isNoCorsName(lower) || !mime.isSafelisted(lower, value)) return;
      list.remove("range");
    }
    list.set(name, value);
  }
}
expose(Headers);
const { append } = Headers.prototype;

function fill(headers: Headers, pairs: unknown[][]) {
  for (const pair of pairs) {
    if (pair.length !== 2) throw new TypeError("A header has to be a pair of a name and a value.");
    append.$call(headers, pair[0], pair[1]);
  }
}

// ───────────────────────────── bodies ─────────────────────────────

type Reader = {
  read(): Promise<{ done: boolean; value: Uint8Array }>;
  cancel(reason?: unknown): unknown;
  /** In place of `read`. The result is of another realm. */
  readAll?(): Promise<Uint8Array>;
};

function byteStream(next: () => Reader, started: (controller: any) => void, highWaterMark: number): ReadableStream {
  let reader: Reader | undefined;
  const source = {
    type: "bytes",
    start: started,
    async pull(controller: any) {
      while (true) {
        const { done, value } = await (reader ??= next()).read();
        if (done) break;
        if (value.byteLength > 0) return controller.enqueue(value);
      }
      controller.close();
      controller.byobRequest?.respond(0);
    },
    cancel: (reason: unknown) => void (reader ??= next()).cancel(reason),
  };
  return new ReadableStream(source as any, { highWaterMark });
}

function concatenate(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const all = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.byteLength, 0));
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return all;
}

async function readAll(reader: Reader): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) return concatenate(chunks);
    if (!(value instanceof Uint8Array)) throw new TypeError("The chunks of a body have to be of type Uint8Array.");
    chunks.push(value);
  }
}

/** The stream is only made for those who ask for it. */
class Body {
  source: Uint8Array | Blob | null = null;
  incoming: Reader | null = null;
  #stream: ReadableStream | undefined;
  #controller: any;
  #isConsumed = false;
  #failure: { reason: unknown } | undefined;
  #reject: ((reason: unknown) => void) | undefined;

  constructor(source: Uint8Array | Blob | null, stream?: ReadableStream) {
    this.source = source;
    this.#stream = stream;
  }

  get length(): number | null {
    const { source } = this;
    return source === null ? null : source instanceof Uint8Array ? source.byteLength : source.size;
  }

  #reader(): Reader {
    const { source } = this;
    if (this.incoming !== null) return this.incoming;
    if (!(source instanceof Uint8Array)) return source!.stream().getReader() as any;
    let done = false;
    return { read: async () => ({ done, value: ((done = true), source.slice()) }), cancel() {} };
  }

  get stream(): ReadableStream {
    if (this.#stream) return this.#stream;
    if (this.#isConsumed) {
      const reader = (this.#stream = new ReadableStream()).getReader();
      reader.cancel();
      return this.#stream;
    }
    return (this.#stream = byteStream(
      () => this.#reader(),
      controller => (this.#failure ? controller.error(this.#failure.reason) : (this.#controller = controller)),
      this.incoming === null ? 0 : 1 << 16,
    ));
  }

  get isUsed(): boolean {
    return this.#isConsumed || (this.#stream !== undefined && isDisturbed(this.#stream));
  }

  get isUnusable(): boolean {
    return this.isUsed || (this.#stream !== undefined && this.#stream.locked);
  }

  fail(reason: unknown) {
    this.#failure = { reason };
    this.#controller?.error(reason);
    this.#reject?.(reason);
  }

  cancel(reason: unknown) {
    if (this.#stream && !this.#stream.locked) $pokePromiseAsHandled(this.#stream.cancel(reason));
  }

  /** Only to be looked at, unless `owns`. */
  bytes(owns = true): Promise<Uint8Array> | Uint8Array {
    const reader = this.#stream?.getReader();
    this.#isConsumed = true;
    if (this.#failure) throw this.#failure.reason;
    if (reader) return readAll(reader as any);
    const { source, incoming } = this;
    if (incoming === null)
      return source instanceof Uint8Array ? (owns ? source.slice() : source) : (source as any).bytes();
    if (incoming.readAll === undefined) return readAll(incoming);
    const { promise, resolve, reject } = Promise.withResolvers<Uint8Array>();
    this.#reject = reject;
    incoming.readAll().then(bytes => resolve(owns ? new Uint8Array(bytes) : bytes), reject);
    return promise;
  }

  /** For who uses it from now on. */
  take(): Body {
    if (this.#stream) return new Body(this.source, this.#stream.pipeThrough(new TransformStream()));
    this.#isConsumed = true;
    return new Body(this.source);
  }

  clone(): Body {
    if (!this.#stream && this.incoming === null) return new Body(this.source);
    const [own, other] = this.stream.tee();
    this.#stream = own;
    return new Body(this.source, other);
  }
}

const withCrlf = (text: string) => text.replace(/\r\n|\r|\n/g, "\r\n");
const escapeName = (name: string) => name.replaceAll("\n", "%0A").replaceAll("\r", "%0D").replaceAll('"', "%22");

function multipart(data: FormData): [Blob, string] {
  const boundary = "----WebKitFormBoundary" + crypto.randomUUID().replaceAll("-", "").slice(16);
  const parts: (string | Blob)[] = [];
  for (const [name, value] of NativeFormData.prototype.entries.$call(data) as Iterable<[string, any]>) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${escapeName(withCrlf(name))}"`);
    if (typeof value === "string") parts.push(`\r\n\r\n${withCrlf(value)}\r\n`);
    else {
      const type = value.type || "application/octet-stream";
      parts.push(`; filename="${escapeName(value.name ?? "blob")}"\r\nContent-Type: ${type}\r\n\r\n`, value, "\r\n");
    }
  }
  parts.push(`--${boundary}--\r\n`);
  return [new Blob(parts), `multipart/form-data; boundary=${boundary}`];
}

function extractBody(init: any, keepalive = false): [Body, string | null] {
  if ($isObject(init)) {
    if (isStream(init)) {
      if (keepalive) throw new TypeError("A keepalive request cannot have a ReadableStream body.");
      if (isDisturbed(init) || init.locked) throw new TypeError("The stream is disturbed or locked.");
      return [new Body(null, init), null];
    }
    if ($inheritsBlob(init)) return [new Body(init), init.type || null];
    const bytes = idl.bytesOf(init);
    if (bytes) return [new Body(bytes.slice()), null];
    if (idl.isBranded(NativeFormData, "keys", init)) {
      const [blob, type] = multipart(init);
      return [new Body(blob), type];
    }
    if (idl.isBranded(URLSearchParams, "toString", init)) {
      const text = URLSearchParams.prototype.toString.$call(init);
      return [new Body(encoder.encode(text)), "application/x-www-form-urlencoded;charset=UTF-8"];
    }
  }
  return [new Body(encoder.encode(`${init}`)), "text/plain;charset=UTF-8"];
}

function parseMultipart(bytes: Uint8Array, boundary: string | undefined) {
  const fail = () => new TypeError("Failed to parse the body as FormData.");
  if (boundary === undefined) throw fail();
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isAt = (text: string, at: number) => buffer.latin1Slice(at, at + text.length) === text;
  const unescape = (text: string) => text.replace(/%0A|%0D|%22/gi, decodeURIComponent);
  const data = new scope.global.FormData();
  let at = isAt("\r\n", 0) ? 2 : 0;
  while (true) {
    if (!isAt("--" + boundary, at)) throw fail();
    at += boundary.length + 2;
    if (isAt("--", at)) return data;
    while (isAt(" ", at) || isAt("\t", at)) at++;
    const content = buffer.indexOf("\r\n\r\n", at) + 4;
    const end = buffer.indexOf("\r\n--" + boundary, content - 2);
    if (!isAt("\r\n", at) || content < 4 || end < content) throw fail();
    const headers = buffer.utf8Slice(at, content - 2);
    const disposition = /\r\ncontent-disposition:[\t ]*form-data[\t ]*;([^\r]*)/i.exec(headers)?.[1] ?? "";
    const parameter = (name: string) => {
      const found = new RegExp(`(?:^|;)[\\t ]*${name}=(?:"([^"]*)"|([^;"]+))`, "i").exec(disposition);
      return found === null ? undefined : unescape(found[1] ?? found[2]);
    };
    const name = parameter("name");
    const filename = parameter("filename");
    if (name === undefined) throw fail();
    const value = bytes.subarray(content, end);
    if (filename === undefined) data.append(name, new TextDecoder("utf-8", { ignoreBOM: true }).decode(value));
    else {
      const type = /\r\ncontent-type:[\t ]*([^\r]*)/i.exec(headers)?.[1] ?? "text/plain";
      data.append(name, new File([value], filename, { type }), filename);
    }
    at = end + 2;
  }
}

const decoder = new TextDecoder();
const whole = (bytes: Uint8Array) => (bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice());

function toBlob(bytes: Uint8Array, header: string | null) {
  const type = mime.extract(header);
  return require("internal/desktop/web/files").blobOfType([bytes], type ? mime.serialize(type) : "");
}

function toFormData(bytes: Uint8Array, header: string | null) {
  const type = mime.extract(header);
  if (type?.essence === "multipart/form-data") return parseMultipart(bytes, type.parameters.get("boundary"));
  if (type?.essence !== "application/x-www-form-urlencoded") throw new TypeError("The body is not a form.");
  const data = new scope.global.FormData();
  const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  for (const [name, value] of new URLSearchParams("&" + text)) data.append(name, value);
  return data;
}

function mixInBody(prototype: object, bodyOf: (self: any) => Body | null, listFrom: (self: any) => HeaderList) {
  function consume<T>(self: object, owns: boolean, convert: (bytes: Uint8Array, type: any) => T): Promise<T> {
    try {
      const body = bodyOf(self);
      if (body?.isUnusable) throw new TypeError("The body is locked, or it has already been read.");
      const bytes = body === null ? new Uint8Array() : body.bytes(owns);
      const type = listFrom(self).get("content-type");
      return Promise.$resolve(bytes).$then(bytes => convert(bytes, type));
    } catch (thrown) {
      return Promise.$reject(thrown);
    }
  }
  const members = {
    get body() {
      return bodyOf(this)?.stream ?? null;
    },
    get bodyUsed() {
      return bodyOf(this)?.isUsed ?? false;
    },
    arrayBuffer() {
      return consume(this, true, bytes => whole(bytes).buffer);
    },
    blob() {
      return consume(this, false, toBlob);
    },
    bytes() {
      return consume(this, true, whole);
    },
    formData() {
      return consume(this, false, toFormData);
    },
    json() {
      return consume(this, false, bytes => JSON.parse(decoder.decode(bytes)));
    },
    text() {
      return consume(this, false, bytes => decoder.decode(bytes));
    },
    textStream() {
      const body = bodyOf(this);
      if (body === null) return new ReadableStream({ start: controller => controller.close() });
      if (body.isUnusable) throw new TypeError("The body is locked, or it has already been read.");
      return body.stream.pipeThrough(new TextDecoderStream() as any);
    },
  };
  Object.defineProperties(prototype, Object.getOwnPropertyDescriptors(members));
}

// ───────────────────────────── Request ─────────────────────────────

const referrerPolicies = [
  "",
  "no-referrer",
  "no-referrer-when-downgrade",
  "same-origin",
  "origin",
  "strict-origin",
  "origin-when-cross-origin",
  "strict-origin-when-cross-origin",
  "unsafe-url",
];

/** What `env.load` takes, besides the headers and the body. */
class Options {
  url = "";
  method = "GET";
  mode = "cors";
  credentials = "same-origin";
  cache = "default";
  redirect = "follow";
  /** Undefined for the URL of the document, and empty for none. */
  referrer: string | undefined = undefined;
  referrerPolicy = "";
  integrity = "";
  keepalive = false;
  priority = "auto";
  destination = "";
  initiator = "fetch";
  usesPreflight = false;
  /** What a `blob:` URL stood for when it was parsed. */
  blob: unknown = undefined;
}

const enums = {
  cache: ["default", "no-store", "reload", "no-cache", "force-cache", "only-if-cached"],
  credentials: ["omit", "same-origin", "include"],
  duplex: ["half"],
  mode: ["navigate", "same-origin", "no-cors", "cors"],
  priority: ["high", "low", "auto"],
  redirect: ["follow", "error", "manual"],
  referrerPolicy: referrerPolicies,
};

function requestInit(given: any) {
  const init: any = { __proto__: null };
  given = dictionary(given);
  for (const key of [
    "body",
    "cache",
    "credentials",
    "duplex",
    "headers",
    "integrity",
    "keepalive",
    "method",
    "mode",
    "priority",
    "redirect",
    "referrer",
    "referrerPolicy",
    "signal",
    "window",
  ]) {
    const value = given[key];
    if (value === undefined) continue;
    if (key in enums) init[key] = oneOf(value, enums[key]);
    else if (key === "headers") init.headers = listOf(value)?.pairs ?? pairsOf(value);
    else if (key === "method") init.method = byteString(value);
    else if (key === "signal") init.signal = value === null ? null : idl.signalOf(value);
    else init[key] = key === "integrity" || key === "referrer" ? usv(value) : value;
  }
  return init;
}

let partsOf: (request: Request) => [Options, HeaderList, Body | null, AbortSignal | null];

class Request {
  #options = new Options();
  #list = new HeaderList();
  #headers: Headers;
  #body: Body | null = null;
  #followed: AbortSignal | null = null;
  #signal: AbortSignal | undefined;

  constructor(input: any, init: any = undefined) {
    need(arguments.length, 1);
    const other: Request | undefined = $isObject(input) && #options in input ? input : undefined;
    const options = this.#options;
    if (other && init === internal) {
      Object.assign(options, other.#options);
      this.#list = new HeaderList(other.#list.pairs);
      this.#headers = makeHeaders(this.#list, options.mode === "no-cors" ? Guard.NoCors : Guard.Request);
      this.#followed = other.#followed;
      this.#body = other.#body?.clone() ?? null;
      return;
    }
    if (!other) input = usv(input);
    init = requestInit(init);
    if (other) {
      Object.assign(options, other.#options);
      this.#followed = other.#followed;
    } else {
      const url = idl.parseUrl(input);
      if (!url) throw new TypeError(`Failed to parse URL from ${input}`);
      if (url.username || url.password) throw new TypeError("A request cannot have a URL that includes credentials.");
      options.url = url.href;
      if (url.protocol === "blob:") options.blob = scope.env.resolveBlob(url.href);
    }
    if (init.window != null) throw new TypeError("The window of a request can only be null.");
    const hasInit = Object.keys(init).length > 0;
    if (hasInit) {
      options.referrer = undefined;
      options.referrerPolicy = "";
    }
    if (init.referrer === "") options.referrer = "";
    else if (init.referrer !== undefined) {
      const referrer = idl.parseUrl(init.referrer);
      if (!referrer) throw new TypeError(`The referrer '${init.referrer}' is not a valid URL.`);
      if (referrer.href !== "about:client" && referrer.origin === scope.env.origin) options.referrer = referrer.href;
    }
    if (init.mode === "navigate") throw new TypeError("The mode of a request cannot be 'navigate'.");
    for (const key of ["referrerPolicy", "mode", "credentials", "cache", "redirect", "integrity", "priority"]) {
      if (key in init) options[key] = init[key];
    }
    if (options.cache === "only-if-cached" && options.mode !== "same-origin") {
      throw new TypeError("'only-if-cached' can only be set with the mode 'same-origin'.");
    }
    if ("keepalive" in init) options.keepalive = !!init.keepalive;
    if ("method" in init) {
      if (!mime.isToken(init.method) || mime.isForbiddenMethod(init.method)) {
        throw new TypeError(`'${init.method}' is not a method that can be used.`);
      }
      options.method = mime.normalizeMethod(init.method);
    }
    if ("signal" in init) this.#followed = init.signal;
    const isNoCors = options.mode === "no-cors";
    if (isNoCors && !/^(?:GET|HEAD|POST)$/.test(options.method)) {
      throw new TypeError(`'${options.method}' is not supported in no-cors mode.`);
    }
    if (other && !hasInit) this.#list = new HeaderList(other.#list.pairs);
    this.#headers = makeHeaders(this.#list, isNoCors ? Guard.NoCors : Guard.Request);
    if (hasInit) fill(this.#headers, init.headers ?? (other ? other.#list.pairs : []));

    const inherited = other ? other.#body : null;
    if ((init.body != null || inherited !== null) && /^(?:GET|HEAD)$/.test(options.method)) {
      throw new TypeError("A request with the method GET or HEAD cannot have a body.");
    }
    let body = inherited;
    if (init.body != null) {
      const [extracted, type] = extractBody(init.body, options.keepalive);
      body = extracted;
      if (type !== null && this.#list.get("content-type") === null) append.$call(this.#headers, "Content-Type", type);
    }
    if (body !== null && body.source === null) {
      if (body !== inherited && init.duplex === undefined)
        throw new TypeError("A streaming body needs the duplex member.");
      if (isNoCors) throw new TypeError("A request with a streaming body needs the mode 'same-origin' or 'cors'.");
      options.usesPreflight = true;
    }
    if (body === inherited && body?.isUnusable) throw new TypeError("The body of the request has already been used.");
    const taken = inherited !== null && !inherited.isUnusable ? inherited.take() : null;
    this.#body = body === inherited ? taken : body;
  }

  static {
    mixInBody(
      this.prototype,
      self => self.#body,
      self => self.#list,
    );
    partsOf = request => [request.#options, request.#list, request.#body, request.#followed];
  }

  get method() {
    return this.#options.method;
  }
  get url() {
    return this.#options.url;
  }
  get headers() {
    return this.#headers;
  }
  get destination() {
    return this.#options.destination;
  }
  get referrer() {
    return this.#options.referrer ?? "about:client";
  }
  get referrerPolicy() {
    return this.#options.referrerPolicy;
  }
  get mode() {
    return this.#options.mode;
  }
  get credentials() {
    return this.#options.credentials;
  }
  get cache() {
    return this.#options.cache;
  }
  get redirect() {
    return this.#options.redirect;
  }
  get integrity() {
    return this.#options.integrity;
  }
  get keepalive() {
    return this.#options.keepalive;
  }
  get isReloadNavigation() {
    return !this.#options;
  }
  get isHistoryNavigation() {
    return !this.#options;
  }
  get signal() {
    return (this.#signal ??= AbortSignal.any(this.#followed ? [this.#followed] : []));
  }
  get duplex() {
    return this.#options && "half";
  }

  clone() {
    if (this.#body?.isUnusable) throw new TypeError("The body of the request has already been used.");
    return new Request(this, internal);
  }
}
expose(Request);

// ───────────────────────────── Response ─────────────────────────────

const hasNoBody = (status: number) => [101, 103, 204, 205, 304].includes(status);

let makeResponse: (loaded: any, body: Body | null, guard?: Guard) => Response;
let responseParts: (response: any) => { list: HeaderList; status: number };

class Response {
  #type = "default";
  #url = "";
  #redirected = false;
  #status = 200;
  #statusText = "";
  #list = new HeaderList();
  #guard = Guard.Response;
  #headers: Headers | undefined;
  #body: Body | null = null;

  constructor(body: any = null, init: any = undefined) {
    this.#initialize(init, body === null ? undefined : () => extractBody(body));
  }

  static {
    mixInBody(
      this.prototype,
      self => self.#body,
      self => self.#list,
    );
    makeResponse = ({ type, url, redirected, status, statusText, headers }, body, guard = Guard.Immutable) => {
      const response = new Response();
      response.#type = type;
      response.#url = url;
      response.#redirected = redirected;
      response.#status = status;
      response.#statusText = statusText;
      response.#list = new HeaderList(headers);
      response.#guard = guard;
      response.#body = body;
      return response;
    };
    responseParts = response => ({
      list: response.#list,
      type: response.#type,
      url: response.#url,
      redirected: response.#redirected,
      status: response.#status,
      statusText: response.#statusText,
    });
  }

  #initialize(init: any, extract?: () => [Body, string | null]) {
    const { headers, status = 200, statusText = "" } = dictionary(init);
    const pairs = headers === undefined ? [] : (listOf(headers)?.pairs ?? pairsOf(headers));
    this.#status = status & 0xffff;
    this.#statusText = byteString(statusText);
    const extracted = extract?.();
    if (this.#status < 200 || this.#status > 599) throw new RangeError("The status is outside the range [200, 599].");
    if (!/^[\t -~\x80-\xff]*$/.test(this.#statusText)) throw new TypeError("Invalid statusText");
    if (pairs.length > 0) fill(makeHeaders(this.#list, Guard.Response), pairs);
    if (!extracted) return;
    if (hasNoBody(this.#status)) throw new TypeError("A response with a null body status cannot have a body.");
    this.#body = extracted[0];
    if (extracted[1] !== null && this.#list.get("content-type") === null)
      this.#list.append("Content-Type", extracted[1]);
  }

  static error() {
    return makeResponse({ type: "error", url: "", redirected: false, status: 0, statusText: "" }, null);
  }

  static redirect(url: string, status: number = 302) {
    need(arguments.length, 1);
    const parsed = idl.parseUrl(usv(url));
    if (!parsed) throw new TypeError(`Failed to parse URL from ${url}`);
    status &= 0xffff;
    if (![301, 302, 303, 307, 308].includes(status)) throw new RangeError("Invalid status code");
    const headers = [["Location", parsed.href]];
    return makeResponse({ type: "default", url: "", redirected: false, status, statusText: "", headers }, null);
  }

  static json(data: unknown, init: any = undefined) {
    need(arguments.length, 1);
    const response = new Response();
    response.#initialize(init, () => {
      const text = JSON.stringify(data);
      if (text === undefined) throw new TypeError("The data is not JSON serializable.");
      return [new Body(encoder.encode(text)), "application/json"];
    });
    return response;
  }

  get type() {
    return this.#type;
  }
  get url() {
    return this.#url.split("#")[0];
  }
  get redirected() {
    return this.#redirected;
  }
  get status() {
    return this.#status;
  }
  get ok() {
    return this.#status >= 200 && this.#status <= 299;
  }
  get statusText() {
    return this.#statusText;
  }
  get headers() {
    return (this.#headers ??= makeHeaders(this.#list, this.#guard));
  }

  clone() {
    if (this.#body?.isUnusable) throw new TypeError("The body of the response has already been used.");
    const about = {
      type: this.#type,
      url: this.#url,
      redirected: this.#redirected,
      status: this.#status,
      statusText: this.#statusText,
      headers: this.#list.pairs,
    };
    return makeResponse(about, this.#body?.clone() ?? null, this.#guard);
  }
}
expose(Response);

// ───────────────────────────── fetch ─────────────────────────────

type Load = { promise: Promise<any>; abort(): void };

const KEEPALIVE_BYTES = 64 << 10;
let keptAlive = 0;

function mayKeepAlive(length: number) {
  return keptAlive + length <= KEEPALIVE_BYTES;
}

function start(options: Options, list: HeaderList, body: unknown, length = 0, onUpload?: (sent: number) => void): Load {
  const load: Load = scope.env.load({ ...options, headers: list.pairs, body, isStreamed: isStream(body), onUpload });
  if (options.keepalive) {
    const done = () => void (keptAlive -= length);
    keptAlive += length;
    load.promise.then(done, done);
  }
  return load;
}

/** The chunks become arrays of this realm. */
function ownReader(load: Load, reader: Reader, failure: () => unknown, ended: () => void): Reader {
  const convert = ({ done, value }: any) => {
    if (done) ended();
    return { done, value: done || value instanceof Uint8Array ? value : new Uint8Array(value) };
  };
  return {
    read: () => idl.adopt(reader.read(), convert, failure),
    readAll: reader.readAll && (() => idl.adopt(reader.readAll!(), bytes => (ended(), bytes), failure)),
    cancel: () => (ended(), load.abort()),
  };
}

function checkedChunks() {
  return new TransformStream({
    transform(chunk, controller) {
      if (!(chunk instanceof Uint8Array)) throw new TypeError("The chunks of a body have to be of type Uint8Array.");
      controller.enqueue(chunk);
    },
  });
}

function send(request: Request, initiator: string): Promise<Response> {
  const [options, list, body, signal] = partsOf(request);
  if (signal?.aborted) {
    body?.cancel(signal.reason);
    return Promise.$reject(signal.reason);
  }
  options.initiator = initiator;
  if (options.keepalive && !mayKeepAlive(body?.length ?? 0)) return Promise.$reject(new TypeError("Failed to fetch"));
  const load = start(
    options,
    list,
    body && (body.source ?? body.stream.pipeThrough(checkedChunks())),
    body?.length ?? 0,
  );
  let received: Body | undefined;
  const { promise, resolve, reject } = Promise.withResolvers<Response>();
  const abort = () => {
    reject(signal!.reason);
    received?.fail(signal!.reason);
    load.abort();
  };
  const ended = () => signal?.removeEventListener("abort", abort);
  const failure = () => (ended(), signal?.aborted ? signal.reason : new TypeError("Failed to fetch"));
  signal?.addEventListener("abort", abort, { once: true });
  load.promise.then(
    loaded => {
      if (loaded.reader) (received = new Body(null)).incoming = ownReader(load, loaded.reader, failure, ended);
      else ended();
      resolve(makeResponse(loaded, received ?? null));
    },
    () => reject(failure()),
  );
  return promise;
}

function fetch(input: any, init: any = undefined) {
  try {
    need(arguments.length, 1);
    return send(new Request(input, init), "fetch");
  } catch (thrown) {
    return Promise.$reject(thrown);
  }
}

let activate: (result: FetchLaterResult) => void;

class FetchLaterResult {
  #activated = false;

  constructor(key: unknown = undefined) {
    idl.illegal(key);
  }

  static {
    activate = result => void (result.#activated = true);
  }

  get activated() {
    return this.#activated;
  }
}
idl.expose(FetchLaterResult);

function fetchLater(input: any, init: any = undefined) {
  need(arguments.length, 1);
  const { activateAfter } = dictionary(init);
  const [options, list, body, signal] = partsOf(new Request(input, init));
  if (signal?.aborted) throw signal.reason;
  const delay = activateAfter === undefined ? -1 : idl.finite(activateAfter);
  if (activateAfter !== undefined && delay < 0) throw new RangeError("activateAfter cannot be negative.");
  if (scope.disposed) throw new TypeError("The document is not fully active.");
  if (body && body.length === null) throw new TypeError("The body cannot be a ReadableStream.");
  let size = options.url.split("#")[0].length + (options.referrer ?? "about:client").length + (body?.length ?? 0);
  for (const [name, value] of list.pairs) size += name.length + value.length;
  const deferred = scope.env.deferLoad(
    { ...options, headers: list.pairs, body: body && body.source, keepalive: true },
    size,
  );
  if (!deferred) throw new TypeError("The URL has to be a potentially trustworthy HTTP(S) URL.");
  if (!deferred.send) {
    const { QuotaExceededError } = require("internal/desktop/web/navigator");
    throw new QuotaExceededError("The quota of fetchLater() is exceeded.", { quota: deferred.quota, requested: size });
  }
  const result = new FetchLaterResult(idl.internal);
  signal?.addEventListener("abort", () => deferred.cancel(), { once: true });
  if (delay >= 0) scope.env.tasks.postDelayed(delay, false, () => deferred.send() && activate(result));
  return result;
}

function sendBeacon(url: string, data: any = null) {
  need(arguments.length, 1);
  const parsed = idl.parseUrl(usv(url));
  if (!parsed || !/^https?:$/.test(parsed.protocol))
    throw new TypeError("The URL of a beacon has to be an HTTP(S) URL.");
  const options = new Options();
  const list = new HeaderList();
  const [body, type] = data === null ? [null, null] : extractBody(data, true);
  if (!mayKeepAlive(body?.length ?? 0)) return false;
  if (type !== null) list.append("Content-Type", type);
  options.url = parsed.href;
  options.method = "POST";
  options.mode = type === null || mime.isSafelisted("content-type", type) ? "no-cors" : "cors";
  options.credentials = "include";
  options.keepalive = true;
  options.initiator = "beacon";
  const load = start(options, list, body && body.source, body?.length ?? 0);
  load.promise.then(undefined, () => {});
  return true;
}

export default {
  Body,
  HeaderList,
  Headers,
  Options,
  Request,
  Response,
  concatenate,
  extractBody,
  fetch,
  headerName,
  headerValue,
  isStream,
  makeResponse,
  ownReader,
  partsOf,
  responseParts,
  restoreRequest({ url, method, headers }: any) {
    const request = new Request(url, { method });
    for (const [name, value] of headers) partsOf(request)[1].append(name, value);
    return request;
  },
  restoreResponse: ({ body, ...about }: any) => makeResponse(about, body && new Body(new Uint8Array(body))),
  send,
  FetchLaterResult,
  fetchLater,
  sendBeacon,
  start,
};
