// Every request of a session: those of its pages, and those of `net`.
const path = require("node:path");
const { app } = require("internal/desktop/app");
const {
  hasIntegrity,
  isSameSite,
  isSecure,
  originOf,
  privilegesOf,
  resolveBlob,
} = require("internal/desktop/electron/policy");
const native = require("internal/desktop/native");
const mime = require("internal/desktop/web/mime");
const nativeFetch = fetch;

type Pairs = [string, string][];
type Load = {
  url: string;
  method?: string;
  headers?: Pairs;
  body?: Uint8Array | Blob | ReadableStream | null;
  isStreamed?: boolean;
  /** Those that do not make it a request that needs a preflight. */
  trustedHeaders?: Pairs;
  redirect?: string;
  credentials?: string;
  cache?: string;
  /** Without it, the request is not one of a page, and the rules of the web do not apply. */
  mode?: string;
  destination?: string;
  frame?: any;
  /** Says whether the page may ask for this URL. */
  allows?(url: string, redirected: boolean): boolean;
  origin?: string;
  referrer?: string;
  referrerPolicy?: string;
  integrity?: string;
  usesPreflight?: boolean;
  /** What a `blob:` URL stood for when it was parsed. */
  blob?: Blob;
  /** The origins of the documents that the page is in, the outermost last. */
  ancestors?: string[];
  upgradesInsecure?: boolean;
  blocksAllMixed?: boolean;
  isImageSet?: boolean;
  isByUser?: boolean;
  embedderPolicy?: string;
  /** By calling `completed` of the result. */
  tellsCompletion?: boolean;
  onUpload?(sent: number): void;
  /** For the user name and the password that the server asks for. */
  login?: [string, string];
  userAgent?: string;
  bypassCustomProtocolHandlers?: boolean;
  signal?: AbortSignal;
  /** False to stop at the redirect. */
  onRedirect?(status: number, method: string, url: string, headers: Pairs): boolean | Promise<boolean>;
};

const errorCodes = {
  FAILED: -2,
  ABORTED: -3,
  FILE_NOT_FOUND: -6,
  TIMED_OUT: -7,
  ACCESS_DENIED: -10,
  BLOCKED_BY_CLIENT: -20,
  NETWORK_CHANGED: -21,
  BLOCKED_BY_RESPONSE: -27,
  BLOCKED_BY_CSP: -30,
  CONNECTION_CLOSED: -100,
  CONNECTION_RESET: -101,
  CONNECTION_REFUSED: -102,
  NAME_NOT_RESOLVED: -105,
  INTERNET_DISCONNECTED: -106,
  PROXY_CONNECTION_FAILED: -130,
  MANDATORY_PROXY_CONFIGURATION_FAILED: -131,
  CERT_COMMON_NAME_INVALID: -200,
  CERT_DATE_INVALID: -201,
  CERT_AUTHORITY_INVALID: -202,
  INVALID_URL: -300,
  UNKNOWN_URL_SCHEME: -302,
  TOO_MANY_REDIRECTS: -310,
  UNSAFE_REDIRECT: -311,
  CACHE_MISS: -400,
  UNSAFE_PORT: -312,
  NETWORK_IO_SUSPENDED: -331,
  NO_SUPPORTED_PROXIES: -336,
};

function netError(name: keyof typeof errorCodes, cause?: unknown) {
  return Object.assign(new Error(`net::ERR_${name}`, cause === undefined ? undefined : { cause }), {
    code: `ERR_${name}`,
    errno: errorCodes[name],
  });
}

function toNetError(error: any, signal?: AbortSignal) {
  if (error?.message?.startsWith?.("net::ERR_")) {
    const name = error.message.slice("net::ERR_".length);
    return error.errno !== undefined ? error : netError(name in errorCodes ? name : "FAILED", error);
  }
  if (signal?.aborted) return netError("ABORTED");
  const code = String(error?.code);
  for (const [pattern, name] of [
    [/^(?:ConnectionRefused|ECONNREFUSED|FailedToOpenSocket)$/, "CONNECTION_REFUSED"],
    [/^(?:ECONNRESET|EPIPE)$/, "CONNECTION_RESET"],
    [/^ConnectionClosed$/, "CONNECTION_CLOSED"],
    [/^(?:ENOTFOUND|EAI_AGAIN|DNS.*)$/, "NAME_NOT_RESOLVED"],
    [/^(?:ENETUNREACH|ENETDOWN|EHOSTUNREACH)$/, "INTERNET_DISCONNECTED"],
    [/^(?:Timeout|ETIMEDOUT|23)$/, "TIMED_OUT"],
    [/ALTNAME|HOSTNAME/, "CERT_COMMON_NAME_INVALID"],
    [/EXPIRED|NOT_YET_VALID/, "CERT_DATE_INVALID"],
    [/CERT|ISSUER|SIGNATURE/, "CERT_AUTHORITY_INVALID"],
    [/^(?:ENOENT|EISDIR|ENOTDIR)$/, "FILE_NOT_FOUND"],
    [/^(?:EACCES|EPERM)$/, "ACCESS_DENIED"],
  ] as [RegExp, keyof typeof errorCodes][]) {
    if (pattern.test(code)) return netError(name, error);
  }
  return netError("FAILED", error);
}

const resourceTypes = {
  __proto__: null,
  document: "mainFrame",
  iframe: "subFrame",
  style: "stylesheet",
  script: "script",
  worker: "script",
  image: "image",
  font: "font",
  audio: "media",
  video: "media",
  track: "media",
  object: "object",
  embed: "object",
  websocket: "webSocket",
  "": "xhr",
};

const titleCase = (name: string) => name.replace(/(?:^|-)\w/g, found => found.toUpperCase());
const flatten = (headers: Record<string, string | string[]>): Pairs =>
  Object.entries(headers).flatMap(([name, values]) => [values].flat().map((value): [string, string] => [name, value]));

function group(headers: Pairs) {
  const grouped: Record<string, string[]> = {};
  for (const [name, value] of headers) (grouped[name] ??= []).push(value);
  return grouped;
}

/** All of its values. */
function find(headers: Pairs, name: string): string | undefined {
  let found: string | undefined;
  for (const header of headers) {
    if (header[0].toLowerCase() === name) found = found === undefined ? header[1] : found + ", " + header[1];
  }
  return found;
}

/** Undefined unless all of them are tokens. */
function tokens(value = ""): string[] | undefined {
  const all = mime.split(value).filter(Boolean);
  if (all.every(mime.isToken)) return all;
}

function allowsOrigin(headers: Pairs, origin: string, withCredentials: boolean) {
  const allowed = find(headers, "access-control-allow-origin");
  if (!withCredentials) return allowed === "*" || allowed === origin;
  return allowed === origin && find(headers, "access-control-allow-credentials") === "true";
}

/** https://fetch.spec.whatwg.org/#port-blocking */
const unsafePorts = new Set(
  `0 1 7 9 11 13 15 17 19 20 21 22 23 25 37 42 43 53 69 77 79 87 95 101 102 103 104 109 110 111 113 115 117 119 123 135
  137 139 143 161 179 389 427 465 512 513 514 515 526 530 531 532 540 548 554 556 563 587 601 636 989 990 993 995 1719
  1720 1723 2049 3659 4045 4190 5060 5061 6000 6566 6665 6666 6667 6668 6669 6679 6697 10080`.split(/\s+/),
);

const isWeb = (url: URL) => url.protocol === "http:" || url.protocol === "https:";
const isScriptLike = (destination = "") =>
  /^(?:script|worker|sharedworker|audioworklet|paintworklet)$/.test(destination);
const isUnsafePort = (url: URL) => unsafePorts.$has(url.port);
const now = () => performance.timeOrigin + performance.now();
const knownPolicy =
  /^(?:no-referrer(?:-when-downgrade)?|same-origin|(?:strict-)?origin(?:-when-cross-origin)?|unsafe-url)$/;

function parseReferrerPolicy(header = "") {
  return (tokens(header.toLowerCase()) ?? []).findLast(it => knownPolicy.test(it)) ?? "";
}

function referrerFor(source: string | undefined, target: string, policy: string): string {
  const url = URL.parse(source ?? "");
  if (!url || !isWeb(url)) return "";
  url.username = url.password = url.hash = "";
  const origin = url.origin + "/";
  const full = url.href.length > 4096 ? origin : url.href.replace(/#$/, "");
  const isSame = url.origin === originOf(target);
  const downgrades = isSecure(url.href) && !isSecure(target);
  switch (policy) {
    case "no-referrer":
      return "";
    case "origin":
      return origin;
    case "unsafe-url":
      return full;
    case "strict-origin":
      return downgrades ? "" : origin;
    case "same-origin":
      return isSame ? full : "";
    case "origin-when-cross-origin":
      return isSame ? full : origin;
    case "no-referrer-when-downgrade":
      return downgrades ? "" : full;
  }
  return isSame ? full : downgrades ? "" : origin;
}

function upgrade(url: URL) {
  if (url.protocol === "http:") url.protocol = "https:";
  else if (url.protocol === "ws:") url.protocol = "wss:";
}

/** Whether a document in these origins may not have what `url` names. */
function isMixed(url: URL, origins: (string | undefined)[]) {
  return /^(?:http|ws):$/.test(url.protocol) && !isSecure(url.href) && origins.some(it => it?.startsWith("https:"));
}

function readData(url: URL) {
  const text = url.href.split("#")[0].slice("data:".length);
  const comma = text.indexOf(",");
  if (comma < 0) throw netError("INVALID_URL");
  let type = text.slice(0, comma).trim();
  let body = text.slice(comma + 1).replace(/%([\da-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  if (/; *base64$/i.test(type)) {
    type = type.replace(/; *base64$/i, "");
    try {
      body = atob(body);
    } catch {
      throw netError("INVALID_URL");
    }
  }
  const parsed = mime.parse(type[0] === ";" ? "text/plain" + type : type);
  const headers = { "content-type": parsed ? mime.serialize(parsed) : "text/plain;charset=US-ASCII" };
  return new Response(Buffer.from(body, "latin1"), { statusText: "OK", headers });
}

function readBlob(blob: Blob | undefined, method: string, range: string | null) {
  if (!blob || method !== "GET") throw netError("FILE_NOT_FOUND");
  const { size, type } = blob;
  if (range === null) {
    return new Response(blob.stream(), {
      statusText: "OK",
      headers: { "content-length": String(size), "content-type": type },
    });
  }
  const [, first, last] = /^bytes[\t ]*=[\t ]*(\d*)[\t ]*-[\t ]*(\d*)$/.exec(range) ?? [];
  const start = first ? +first : Math.max(size - +last, 0);
  const end = first && last ? Math.min(+last, size - 1) : size - 1;
  if (!(first || last) || start >= size || start > end) throw netError("FAILED");
  return new Response(blob.slice(start, end + 1).stream(), {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "content-length": String(end - start + 1),
      "content-type": type,
      "content-range": `bytes ${start}-${end}/${size}`,
    },
  });
}

function defaultAccept(destination = "") {
  if (/^(?:document|i?frame)$/.test(destination)) {
    return "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8";
  }
  if (destination === "image") return "image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";
  if (destination === "json") return "application/json,*/*;q=0.5";
  if (destination === "text") return "text/plain,*/*;q=0.5";
  return destination === "style" ? "text/css,*/*;q=0.1" : "*/*";
}

function isBlockedByType(headers: Pairs, destination: string | undefined) {
  if (destination !== "style" && !isScriptLike(destination)) return false;
  const essence = mime.extract(find(headers, "content-type"))?.essence ?? "";
  if (mime.split(find(headers, "x-content-type-options") ?? "")[0].toLowerCase() === "nosniff") {
    return destination === "style" ? essence !== "text/css" : !mime.isJavaScript(essence);
  }
  return destination !== "style" && /^(?:audio|image|video)[/]|^text[/]csv$/.test(essence);
}

const neverSniffed =
  /^(?:application[/](?:dash[+]xml|gzip|msword|pdf|vnd[.]ms-excel|x-gzip|x-protobuf|zip)|multipart[/](?:byteranges|signed)|text[/](?:csv|event-stream))$/;
const isProtected = /^(?:text[/](?:html|json|xml)|application[/](?:json|xml)|[^/]+[/].+[+](?:json|xml))$/;

/** https://github.com/annevk/orb, as far as headers tell. */
function isOpaqueBlocked(headers: Pairs, status: number) {
  const essence = mime.extract(find(headers, "content-type"))?.essence ?? "";
  if (essence === "image/svg+xml") return false;
  if (neverSniffed.test(essence)) return true;
  const isNoSniff = mime.split(find(headers, "x-content-type-options") ?? "")[0].toLowerCase() === "nosniff";
  return isProtected.test(essence) ? isNoSniff || status === 206 : isNoSniff && essence === "text/plain";
}

async function readFile(url: URL, headers: Headers) {
  const file = Bun.file(Bun.fileURLToPath(url));
  const stat = await file.stat();
  if (!stat.isFile()) throw netError("FILE_NOT_FOUND");
  const type = path.extname(url.pathname) === "" ? "text/plain" : file.type.split(";")[0];
  const common = { "content-type": type, "last-modified": stat.mtime.toUTCString(), "accept-ranges": "bytes" };
  const range = /^bytes=(\d+)-(\d*)$/.exec(headers.get("range") ?? "");
  if (!range) return new Response(file, { headers: { ...common, "content-length": String(stat.size) } });
  const end = Math.min(range[2] ? +range[2] + 1 : stat.size, stat.size);
  return new Response(file.slice(+range[1], end), {
    status: 206,
    headers: { ...common, "content-range": `bytes ${range[1]}-${end - 1}/${stat.size}` },
  });
}

const isActive = /^(?:document|i?frame|script|style|\w*worker|\w*worklet|object|embed)$/;
let nextId = 1;

/** The headers that `webRequest` lets the handshake of a WebSocket go out with. */
async function handshake({ webRequest }: any, frame: any, href: string, headers: Record<string, string>) {
  const url = new URL(href);
  const id = nextId++;
  const details = (more?: object) => ({
    id,
    url: href,
    method: "GET",
    webContentsId: frame.webContents.id,
    webContents: frame.webContents,
    frame: frame.handle,
    initiatorOrigin: headers.origin,
    resourceType: "webSocket",
    referrer: "",
    timestamp: Date.now(),
    ...more,
  });
  if ((await webRequest.ask("onBeforeRequest", url, details)).cancel) throw netError("BLOCKED_BY_CLIENT");
  const titled = Object.fromEntries(Object.entries(headers).map(([name, value]) => [titleCase(name), value]));
  const { cancel, requestHeaders = titled } = await webRequest.ask("onBeforeSendHeaders", url, () =>
    details({ requestHeaders: titled }),
  );
  if (cancel) throw netError("BLOCKED_BY_CLIENT");
  return Object.fromEntries(new Headers(flatten(requestHeaders)));
}

/** `session` is the state that `session.ts` keeps for one. */
async function load(session: any, request: Load) {
  const { jar } = session;
  const { signal, frame, destination, mode, origin, ancestors = [] } = request;
  const observers = frame?.context?.state.network;
  const webRequest = observers
    ? require("internal/desktop/electron/devtools").spy(observers, session.webRequest, destination)
    : session.webRequest;
  const navigates = mode === "navigate";
  let { url: href, method = "GET", body = null, referrer, referrerPolicy = "", login } = request;
  const headers = new Headers(request.headers);
  const urls: string[] = [];
  let redirects = 0;
  let tainting = "basic";
  let isOriginTainted = false;
  let allowsTiming = true;
  const timing = { start: now(), redirectStart: 0, redirectEnd: 0, fetchStart: 0, requestStart: 0, responseStart: 0 };
  const details = (more?: object) => ({
    id,
    url: href,
    method,
    webContentsId: frame?.webContents.id,
    webContents: frame?.webContents,
    frame: frame?.handle,
    initiatorOrigin: origin,
    resourceType: resourceTypes[destination!] ?? "other",
    referrer: referrer ?? "",
    timestamp: Date.now(),
    ...more,
  });
  const id = nextId++;
  const originToSend = () => (isOriginTainted ? "null" : origin!);

  function send(
    url: URL,
    method: string,
    headers: Headers,
    body: any,
    partition?: string,
  ): Promise<Response> | Response {
    const handler = !request.bypassCustomProtocolHandlers && session.handlers.get(url.protocol);
    if (handler) {
      const given = new Request(url.href, { method, headers, body, signal, duplex: "half" } as any);
      if (origin !== undefined) Object.defineProperty(given, "initiatorOrigin", { value: origin, enumerable: true });
      if (request.referrer) Object.defineProperty(given, "referrer", { value: request.referrer });
      return handler(given);
    }
    if (url.protocol === "file:") return readFile(url, headers);
    if (url.protocol === "data:") return readData(url);
    if (url.protocol === "blob:") return readBlob(request.blob ?? resolveBlob(url.href), method, headers.get("range"));
    if (!isWeb(url)) throw netError("UNKNOWN_URL_SCHEME");
    const bare = new URL(url);
    bare.username = bare.password = "";
    const options = {
      method,
      headers,
      body,
      redirect: "manual",
      duplex: "half",
      timeout: false,
      onUpload: request.onUpload,
    };
    let source = "app";
    const connect = (headers: Headers) => {
      options.headers = headers;
      const viaWebEngine = session.viaWebEngine?.(bare, options, signal);
      source = viaWebEngine ? "web-engine" : "network";
      return viaWebEngine ?? session.send(bare, options, signal);
    };
    const network = (pathname = url.pathname) => {
      bare.pathname = pathname;
      if (partition === undefined || pathname !== url.pathname) return connect(headers);
      source = "cache";
      return session.cache().exchange(partition, url, method, headers, request.cache, connect);
    };
    const server = request.mode && session.servers.get(url.origin);
    const answer = server ? serve(server, url, options, network) : network();
    if (app.listenerCount("request-answered") === 0) return answer;
    const started = performance.now();
    const report = (more: object) =>
      app.emit("request-answered", {
        url: url.href,
        method,
        destination,
        source,
        duration: performance.now() - started,
        ...more,
      });
    answer.then(
      response => report({ status: response?.status, headers: response?.headers }),
      error => report({ error: toNetError(error, signal).code }),
    );
    return answer;
  }

  async function serve(server: Function, url: URL, { method, headers }: any, network: () => Promise<Response>) {
    const own = await server({ url: url.href, method, headers, destination, webContents: frame?.webContents }, network);
    if (own?.url === "" && destination === "style") {
      const body = await own.blob();
      if (body.name) native.mapResource(body.name);
      return new Response(body, own);
    }
    if (own) return own;
    if (!isActive.test(destination!)) return network();
    if (destination !== "document")
      throw Object.assign(netError("BLOCKED_BY_CLIENT"), { needsWebEngine: destination === "iframe" });
    const response = method === "GET" ? await network() : undefined;
    if (
      response?.headers.has("location") ||
      /^\s*attachment/i.test(response?.headers.get("content-disposition") ?? "")
    ) {
      return response!;
    }
    response?.body?.cancel();
    throw Object.assign(netError("BLOCKED_BY_CLIENT"), { needsWebEngine: true });
  }

  function addCommonHeaders(sent: Headers, url: URL) {
    const setDefault = (name: string, value?: string) => value && !sent.has(name) && sent.set(name, value);
    setDefault("user-agent", request.userAgent ?? session.userAgent());
    setDefault("accept", defaultAccept(destination));
    setDefault("accept-language", session.acceptLanguage());
    setDefault("referer", referrer);
    if (!mode || !isSecure(href)) return;
    const site =
      origin === undefined
        ? "none"
        : urls.every(it => originOf(it) === origin)
          ? "same-origin"
          : urls.every(it => isSameSite(it, origin))
            ? "same-site"
            : "cross-site";
    sent.set("sec-fetch-dest", destination || "empty");
    sent.set("sec-fetch-mode", mode);
    sent.set("sec-fetch-site", site);
    if (navigates && (request.isByUser || origin === undefined)) sent.set("sec-fetch-user", "?1");
  }

  async function preflight(url: URL) {
    const withCredentials = request.credentials === "include";
    let unsafe = [...headers].filter(header => !mime.isSafelisted(header[0], header[1])).map(header => header[0]);
    const safe = [...headers].filter(header => !unsafe.includes(header[0]));
    if (safe.reduce((length, header) => length + header[1].length, 0) > 1024) unsafe = [...headers.keys()];
    const isSimple = /^(?:GET|HEAD|POST)$/.test(method);
    if (isSimple && unsafe.length === 0 && !request.usesPreflight) return;
    const covers = ({ methods, names }: { methods: string[]; names: string[] }) =>
      (isSimple || methods.includes(method) || (!withCredentials && methods.includes("*"))) &&
      unsafe.every(name => names.includes(name) || (!withCredentials && names.includes("*")));
    const key = `${originToSend()}\n${href}\n${withCredentials}`;
    const known = session.preflights.get(key);
    if (known && known.until > Date.now() && covers(known)) return;
    const asked = new Headers({ origin: originToSend(), accept: "*/*", "access-control-request-method": method });
    if (unsafe.length > 0) asked.set("access-control-request-headers", unsafe.join(","));
    addCommonHeaders(asked, url);
    const response = await send(url, "OPTIONS", asked, null);
    response.body?.cancel();
    const answer = [...response.headers] as Pairs;
    const methods = tokens(find(answer, "access-control-allow-methods"));
    const names = tokens(find(answer, "access-control-allow-headers")?.toLowerCase());
    if (!response.ok || !allowsOrigin(answer, originToSend(), withCredentials) || !methods || !names)
      throw netError("FAILED");
    if (!covers({ methods, names })) throw netError("FAILED");
    const seconds = find(answer, "access-control-max-age") ?? "";
    if (session.preflights.size >= 1024) session.preflights.clear();
    session.preflights.set(key, {
      methods,
      names,
      until: Date.now() + 1000 * (/^-?\d+$/.test(seconds) ? Math.min(+seconds, 7200) : 5),
    });
  }

  function redirectTo(target: string) {
    if (++redirects > 20) throw netError("TOO_MANY_REDIRECTS");
    if (originOf(target) !== originOf(href)) {
      headers.delete("authorization");
      login = undefined;
      isOriginTainted ||= origin !== originOf(href);
    }
    timing.redirectStart ||= timing.fetchStart;
    timing.redirectEnd = now();
    href = target;
  }

  function isSharedWithPage(received: Pairs) {
    if (mode !== "no-cors" || originOf(href) === origin) return true;
    const sharedWith = find(received, "cross-origin-resource-policy");
    if (sharedWith === "same-site")
      return isSameSite(href, origin!, true) && (origin!.startsWith("https:") || !href.startsWith("https:"));
    if (sharedWith === "same-origin") return false;
    return sharedWith === "cross-origin" || request.embedderPolicy !== "require-corp";
  }

  function checkAndTaint(url: URL) {
    if (request.upgradesInsecure) upgrade(url);
    if (destination !== "document" && isMixed(url, [origin, ...ancestors])) {
      const isAddress = /^\[|^[\d.]+$/.test(url.hostname);
      const isPassive = /^(?:image|audio|video)$/.test(destination!) && !request.isImageSet && !request.blocksAllMixed;
      if (!isPassive) throw netError("ACCESS_DENIED");
      if (!isAddress) upgrade(url);
    }
    href = url.href;
    if (request.allows?.(href, redirects > 0) === false) throw netError("BLOCKED_BY_CSP");
    if (navigates || url.protocol === "data:") return;
    if (tainting === "basic" && origin !== "null" && originOf(href) === origin) {
      if (!isWeb(url) && url.protocol !== "blob:" && url.protocol !== "file:" && destination === "") {
        if (!privilegesOf(url.protocol).supportFetchAPI) throw netError("ACCESS_DENIED");
      }
      return;
    }
    const { supportFetchAPI, corsEnabled } = privilegesOf(url.protocol);
    if (url.protocol === "blob:") {
      if (origin !== "null" || originOf(href) !== "null") throw netError("FAILED");
      return;
    }
    if (url.protocol === "file:" || (!isWeb(url) && destination === "" && !supportFetchAPI))
      throw netError("ACCESS_DENIED");
    if (mode === "same-origin" || (mode === "cors" && !isWeb(url) && !corsEnabled)) throw netError("FAILED");
    if (mode === "no-cors" && request.redirect !== undefined && request.redirect !== "follow") throw netError("FAILED");
    tainting = mode === "cors" ? "cors" : "opaque";
  }

  try {
    while (true) {
      signal?.throwIfAborted();
      const url = URL.parse(href);
      if (!url) throw netError("INVALID_URL");
      const isLocal = url.protocol === "data:" || url.protocol === "blob:";
      if (isWeb(url) && isUnsafePort(url)) throw netError("UNSAFE_PORT");
      if (mode) checkAndTaint(url);
      else if (request.allows?.(href, redirects > 0) === false) throw netError("BLOCKED_BY_CSP");
      referrer = referrerFor(referrer, href, referrerPolicy);
      urls.push(href);
      timing.fetchStart = redirects > 0 ? now() : timing.start;

      if (!isLocal) {
        const uploadData = $isTypedArrayView(body)
          ? [{ type: "rawData", bytes: Buffer.from(body as Uint8Array) }]
          : undefined;
        const { cancel, redirectURL } = await webRequest.ask("onBeforeRequest", url, () => details({ uploadData }));
        if (cancel) throw netError("BLOCKED_BY_CLIENT");
        if (redirectURL && redirectURL !== href) {
          if (request.onRedirect && !(await request.onRedirect(307, method, redirectURL, [])))
            throw netError("ABORTED");
          redirectTo(redirectURL);
          continue;
        }
      }

      const usesCors = tainting === "cors";
      const withCredentials =
        request.credentials === "include"
          ? request.embedderPolicy !== "credentialless" || tainting !== "opaque"
          : request.credentials !== "omit" && tainting === "basic";
      if (usesCors && isWeb(url)) await preflight(url);

      let sent = new Headers(headers);
      for (const [name, value] of request.trustedHeaders ?? []) sent.set(name, value);
      addCommonHeaders(sent, url);
      if (origin !== undefined && !sent.has("origin") && (usesCors || !/^(?:GET|HEAD)$/.test(method))) {
        const hides =
          mode !== undefined &&
          mode !== "cors" &&
          !referrerFor(origin, href, referrerPolicy) &&
          origin.startsWith("http");
        sent.set("origin", hides ? "null" : originToSend());
      }
      if (navigates) sent.set("upgrade-insecure-requests", "1");
      if (sent.has("range") && !sent.has("accept-encoding")) sent.set("accept-encoding", "identity");
      const isSameSiteRequest =
        !mode || [...(origin === undefined ? [] : [origin]), ...ancestors].every(it => isSameSite(href, it));
      const cookieContext = {
        isSameSite: isSameSiteRequest,
        navigates: destination === "document",
        isSafe: method === "GET" || method === "HEAD",
        partition: destination === "document" ? href : (ancestors.at(-1) ?? origin),
      };
      if (withCredentials) {
        const cookie = !sent.has("cookie") && jar.header(url, cookieContext);
        if (cookie) sent.set("cookie", cookie);
        const known = session.logins.get(url.origin);
        if (known && !login && !url.username && !sent.has("authorization")) sent.set("authorization", known);
      }
      if (!isLocal) {
        const titled = () => Object.fromEntries([...sent].map(([name, value]) => [titleCase(name), value]));
        const { cancel, requestHeaders } = await webRequest.ask("onBeforeSendHeaders", url, () =>
          details({ requestHeaders: titled() }),
        );
        if (cancel) throw netError("BLOCKED_BY_CLIENT");
        if (requestHeaders) sent = new Headers(flatten(requestHeaders));
        webRequest.tell("onSendHeaders", url, () => details({ requestHeaders: titled() }));
      }

      timing.requestStart = now();
      const sendAs = (method: string, headers: Headers, body: any) =>
        send(url, method, headers, body, mode && `${cookieContext.partition}`);
      const exchange = () =>
        observers ? webRequest.exchange(href, method, sent, body, sendAs) : sendAs(method, sent, body);
      let response: any = await exchange();
      if (response === undefined) throw netError("CACHE_MISS");
      if (url.username || url.password) login ??= [unescape(url.username), unescape(url.password)];
      if (response.status === 401 && request.isStreamed) throw netError("FAILED");
      if (
        response.status === 401 &&
        login &&
        withCredentials &&
        !usesCors &&
        response.headers.has("www-authenticate")
      ) {
        response.body?.cancel();
        sent.set("authorization", "Basic " + Buffer.from(login.join(":")).toString("base64"));
        response = await exchange();
        if (response.status !== 401) session.logins.set(url.origin, sent.get("authorization"));
      }
      timing.responseStart = now();
      if (typeof response?.status !== "number" || response.type === "error") throw netError("FAILED");
      const { fromCache = false } = response;
      let { status, statusText } = response;
      let received = [...response.headers] as Pairs;
      const refuse = (name: keyof typeof errorCodes) => {
        response.body?.cancel();
        return netError(name);
      };
      const answered = (more?: object) =>
        details({
          statusCode: status,
          statusLine: `HTTP/1.1 ${status} ${statusText}`.trimEnd(),
          responseHeaders: group(received),
          fromCache,
          ...more,
        });
      if (!isLocal) {
        const { cancel, responseHeaders, statusLine } = await webRequest.ask("onHeadersReceived", url, answered);
        if (cancel) throw refuse("BLOCKED_BY_CLIENT");
        if (responseHeaders) received = flatten(responseHeaders);
        const line = /^\S+ (\d+) ?(.*)$/.exec(statusLine ?? "");
        if (line) [status, statusText] = [+line[1], line[2]];
      }
      if (withCredentials && !fromCache) {
        for (const [name, value] of received)
          if (name.toLowerCase() === "set-cookie") jar.receive(value, url, cookieContext);
        const cleared = mode && isSecure(href) && find(received, "clear-site-data");
        if (cleared) await session.clearSite(url.origin, mime.split(cleared));
      }
      if (status === 407 || (usesCors && !allowsOrigin(received, originToSend(), request.credentials === "include"))) {
        throw refuse("FAILED");
      }
      if (!isLocal && !isSharedWithPage(received)) throw refuse("BLOCKED_BY_RESPONSE");
      if (tainting !== "basic" || (navigates && originOf(href) !== (origin ?? originOf(urls[0])))) {
        const allowed = mime.split(find(received, "timing-allow-origin") ?? "");
        allowsTiming &&= allowed.includes("*") || allowed.includes(originToSend());
      }

      const isRedirect = [301, 302, 303, 307, 308].includes(status);
      const location = isRedirect ? find(received, "location") : undefined;
      if (isRedirect && request.redirect === "error") throw refuse("FAILED");
      if (location !== undefined && request.redirect !== "manual") {
        response.body?.cancel();
        const target = URL.parse(Buffer.from(location, "latin1").toString(), href);
        if (!target) throw netError("FAILED");
        if (isWeb(url) && /^(?:about|file|data|blob|javascript):$/.test(target.protocol))
          throw netError("UNSAFE_REDIRECT");
        if (mode === "cors" && (target.username || target.password) && (usesCors || target.origin !== origin)) {
          throw netError("FAILED");
        }
        if (status !== 303 && request.isStreamed) throw netError("FAILED");
        if (!target.href.includes("#")) target.hash = url.hash;
        webRequest.tell("onBeforeRedirect", url, () => answered({ redirectURL: target.href }));
        if (status === 303 ? !/^(?:GET|HEAD)$/.test(method) : status < 303 && method === "POST") {
          [method, body] = ["GET", null];
          for (const name of ["encoding", "language", "location", "type"]) headers.delete("content-" + name);
        }
        if (request.onRedirect && !(await request.onRedirect(status, method, target.href, received))) {
          throw netError("ABORTED");
        }
        referrerPolicy = parseReferrerPolicy(find(received, "referrer-policy")) || referrerPolicy;
        redirectTo(target.href);
        continue;
      }

      if (mode && isBlockedByType(received, destination)) throw refuse("BLOCKED_BY_RESPONSE");
      if (tainting === "opaque" && destination !== "" && isWeb(url) && isOpaqueBlocked(received, status))
        throw refuse("BLOCKED_BY_RESPONSE");
      if (tainting === "opaque" && status === 206 && !headers.has("range")) throw refuse("BLOCKED_BY_RESPONSE");
      webRequest.tell("onResponseStarted", url, answered);
      const completed = () => webRequest.tell("onCompleted", url, () => answered({ error: "net::OK" }));
      const isManual = !!mode && isRedirect;
      const isHidden = (isManual && request.redirect === "manual") || (tainting === "opaque" && destination === "");
      const hasBody = method !== "HEAD" && ![101, 103, 204, 205, 304].includes(status) && !isHidden;
      if (request.integrity) {
        const bytes = hasBody && tainting !== "opaque" && (await response.bytes());
        if (!bytes || !hasIntegrity(bytes, request.integrity)) throw refuse("FAILED");
        response = new Response(bytes);
      }
      const about = {
        timing,
        allowsTiming,
        fromCache,
        tainting,
        redirects,
        referrer,
        /** What a script must not see unless `tainting` and `allowsTiming` say so. */
        internal: {
          status,
          url: href,
          headers: received,
          crossedOrigins: urls.some(it => originOf(it) !== originOf(href)),
        },
      };
      if (!hasBody) {
        response.body?.cancel();
        if (isHidden || !request.tellsCompletion) completed();
      }
      if (isHidden) {
        const type = tainting === "opaque" ? "opaque" : "opaqueredirect";
        return {
          ...about,
          url: tainting === "opaque" ? "" : href,
          status: 0,
          statusText: "",
          headers: [],
          redirected: false,
          type,
          response: null,
        };
      }
      if (mode && destination === "") {
        const exposed = tokens(find(received, "access-control-expose-headers")?.toLowerCase()) ?? [];
        received = received.filter(([name]) => {
          name = name.toLowerCase();
          return (
            !/^set-cookie2?$/.test(name) &&
            (!usesCors ||
              /^(?:cache-control|content-(?:language|length|type)|expires|last-modified|pragma)$/.test(name) ||
              exposed.includes(name) ||
              (exposed.includes("*") && request.credentials !== "include"))
          );
        });
      }
      return {
        ...about,
        url: href,
        status,
        statusText,
        headers: received,
        redirected: redirects > 0,
        type: tainting,
        completed,
        /** In place of `completed`. */
        failed: (caught: unknown) =>
          webRequest.tell("onErrorOccurred", url, () => answered({ error: toNetError(caught, signal).message })),
        /** Only for its body. */
        response: !hasBody
          ? null
          : !request.tellsCompletion && webRequest.listens("onCompleted", url) && response.body
            ? new Response(response.body!.pipeThrough(new TransformStream({ flush: completed })))
            : response,
      };
    }
  } catch (caught) {
    const error = toNetError(caught, signal);
    const url = URL.parse(href);
    if (url) webRequest.tell("onErrorOccurred", url, () => details({ fromCache: false, error: error.message }));
    throw error;
  }
}

export default {
  nextRequestId: () => nextId++,
  find,
  flatten,
  group,
  handshake,
  isMixed,
  isUnsafePort,
  load,
  netError,
  parseReferrerPolicy,
  referrerFor,
  resolveBlob,
  toNetError,
  upgrade,
};
