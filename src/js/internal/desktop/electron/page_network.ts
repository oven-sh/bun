// A document or a worker, as the main realm of the main thread sees it: what it loads and stores.
const { app } = require("internal/desktop/app");
const compiled = require("internal/desktop/electron/compiled");
const loader = require("internal/desktop/electron/loader");
const policy = require("internal/desktop/electron/policy");
const { kState } = require("internal/desktop/electron/session");
const { ContentSecurityPolicy, forReport } = require("internal/desktop/web/csp");
const mime = require("internal/desktop/web/mime");
const tasks = require("internal/desktop/tasks");

const isWeb = /^https?:/;
const MAX_UNREAD_TIMINGS = 250;

function languages(session: any): string[] {
  return session
    .acceptLanguage()
    .split(",")
    .map(language => language.split(";")[0].trim());
}

const tokenAtStart = new RegExp("^[\\w!#$%&'*+.^`|~-]*");
const quotedAtStart = new RegExp('^"((?:\\\\.|[^"\\\\])*)"');
const escaped = new RegExp("\\\\(.)", "g");
const assigned = new RegExp("^\\s*=\\s*(.*)");

function serverTiming(header = "") {
  const metrics: object[] = [];
  for (const metric of mime.split(header)) {
    const [name, ...parameters] = mime.split(metric, ";");
    const token = tokenAtStart.exec(name)![0];
    if (!token) break;
    const value = (wanted: string) => {
      const found = token === name && parameters.find(it => tokenAtStart.exec(it)![0].toLowerCase() === wanted);
      const text = (found && assigned.exec(found.slice(wanted.length))?.at(1)) || "";
      return quotedAtStart.exec(text)?.at(1)!.replace(escaped, "$1") ?? tokenAtStart.exec(text)![0];
    };
    metrics.push({ name: token, duration: +value("dur") || 0, description: value("desc") });
    if (token !== name) break;
  }
  return metrics;
}

function timingOf(name: string, initiatorType: string, loaded: any, size: number) {
  const { status, headers } = loaded.internal;
  const isReadable = loaded.tainting !== "opaque";
  const encoding = loader.find(headers, "content-encoding") ?? "";
  const encoded = encoding ? +loader.find(headers, "content-length")! || size : size;
  return {
    ...loaded.timing,
    name,
    initiatorType,
    responseEnd: performance.timeOrigin + performance.now(),
    allowsTiming: loaded.allowsTiming,
    fromCache: loaded.fromCache,
    redirects: loaded.redirects,
    isSecure: (loaded.internal.url ?? name).startsWith("https:"),
    protocol: loaded.fromCache === "local" ? "" : "http/1.1",
    contentType: isReadable ? mime.minimize(mime.extract(loader.find(headers, "content-type"))?.essence) : "",
    contentEncoding: isReadable ? nameOfEncoding(encoding) : "",
    status: isReadable ? status : 0,
    encodedBodySize: isReadable ? encoded : 0,
    decodedBodySize: isReadable ? size : 0,
    transferSize: loaded.fromCache === "local" ? 0 : loaded.fromCache ? 300 : encoded + 300,
    serverTiming: serverTiming(loader.find(headers, "server-timing")),
  };
}

const preloadedTypes = {
  __proto__: null,
  fetch: /^/,
  font: /^font[/]|^application[/](?:x-)?font-/,
  image: /^image[/](?:apng|bmp|gif|jpeg|png|svg[+]xml|webp|x-icon)$/,
  json: /json$/,
  script: /script/,
  style: /^text[/]css$/,
  track: /^text[/]vtt$/,
};
const canPreload = (as: string, type?: string | null) =>
  !!preloadedTypes[as] && (!type || preloadedTypes[as].test(type.toLowerCase()));

/** So that a request ends of which nothing reads the response. */
const MAX_READ_AHEAD = 1 << 20;
let unread: (() => Promise<void>)[] = [];

function readAhead() {
  const all = unread;
  unread = [];
  for (const read of all) read().then(undefined, () => {});
}

function soon(read: () => Promise<void>) {
  if (unread.push(read) === 1) setTimeout(readAhead, 10).unref();
}

function nameOfEncoding(value: string) {
  if (value.includes(",")) return "multiple";
  return /^(?:br|dcb|dcz|deflate|gzip|zstd|)$/.test((value = value.trim().toLowerCase())) ? value : "@unknown";
}

let systemVersion: string | undefined;

function failedLoad(start: number) {
  const timing = { start, fetchStart: start };
  return { timing, allowsTiming: false, tainting: "opaque", internal: { status: 0, headers: [] } };
}

class Client {
  token = crypto.randomUUID().replaceAll("-", "").toUpperCase();
  session: any;
  origin = "null";
  disposed = false;
  cleanups = new Set<() => void>();
  csp;
  status = 200;
  /** Of the document. */
  referrer = "";
  referrerPolicy = "";
  embedderPolicy = "";
  isIsolated = false;
  checksOrigins = true;
  /** The document that it is a frame or a worker of. */
  parent: Client | undefined;
  aborter = new AbortController();
  #endpoints = "";
  #sentReports = new Set<string>();
  #timings: object[] = [];
  #preloaded = new Map<string, Promise<any>>();
  #timingWatcher: ((timing: object) => void) | undefined;

  constructor(
    readonly webContents: any,
    public url: string,
  ) {
    this.session = webContents.session[kState];
  }

  /** `creator` is for what has no response that could say. */
  setPolicies(headers: any, creator?: Client) {
    const csp = (this.csp = creator?.csp.copy() ?? new ContentSecurityPolicy(this.url));
    csp.onViolation = (violation: object, urls: string[], group?: string, element?: object) =>
      this.#violated(violation, urls, group, element);
    csp.addFrom(headers);
    this.referrerPolicy = loader.find(headers, "referrer-policy") ?? creator?.referrerPolicy ?? "";
    this.#endpoints = loader.find(headers, "reporting-endpoints") ?? (creator ? creator.#endpoints : "");
    const embedderPolicy =
      this.isSecure() && loader.find(headers, "cross-origin-embedder-policy")?.split(";")[0].trim();
    this.embedderPolicy = /^(?:require-corp|credentialless)$/.test(embedderPolicy)
      ? embedderPolicy
      : (creator?.embedderPolicy ?? "");
  }

  /** What a document inherits from it, for when that is loaded again. */
  bequest(more: object) {
    const copy = Object.assign(new Client(this.webContents, this.url), { origin: this.origin }, more);
    copy.setPolicies([], this);
    return copy;
  }

  log(_level: string, _message: string, _line?: number, _source?: string, _args?: unknown[]) {}
  tellScripts(_type: string, _body: object, _element?: object) {}
  /** The URL, line and column of the script that is running. */
  whereNow(): [string, number, number] {
    return ["", 0, 0];
  }

  /** The origins of the documents that it is in, the outermost last. */
  ancestors(): string[] {
    return this.parent ? [this.parent.origin, ...this.parent.ancestors()] : [];
  }

  isSecure(): boolean {
    return policy.isSecure(this.origin === "null" ? this.url : this.origin + "/") && (this.parent?.isSecure() ?? true);
  }

  upgradesInsecure(): boolean {
    return this.csp.has("upgrade-insecure-requests") || !!this.parent?.upgradesInsecure();
  }

  /** What it is the referrer as. */
  referrerUrl(): string {
    return this.url === "about:srcdoc" && this.parent
      ? this.parent.referrerUrl()
      : this.origin === "null"
        ? ""
        : this.url;
  }

  #violated(violation: any, urls: string[], group: string | undefined, element: object | undefined) {
    const [source, lineNumber, columnNumber] = this.whereNow();
    const documentURI = forReport(this.url);
    const body = {
      ...violation,
      documentURI,
      referrer: this.referrer,
      statusCode: isWeb.test(this.url) ? this.status : 0,
      sourceFile: source && forReport(source),
      lineNumber,
      columnNumber,
    };
    this.log(
      "error",
      `Refused ${body.blockedURI}: it violates the directive ${body.effectiveDirective} of "${body.originalPolicy}"`,
    );
    this.tellScripts("csp-violation", body, element);
    if (urls.length === 0 && group === undefined) return;
    const legacy = JSON.stringify({
      "csp-report": {
        "document-uri": documentURI,
        "referrer": body.referrer,
        "violated-directive": body.effectiveDirective,
        "effective-directive": body.effectiveDirective,
        "original-policy": body.originalPolicy,
        "disposition": body.disposition,
        "blocked-uri": body.blockedURI,
        ...(source && { "line-number": lineNumber, "column-number": columnNumber, "source-file": body.sourceFile }),
        "status-code": body.statusCode,
        "script-sample": body.sample,
      },
    });
    if (this.#sentReports.$has(legacy) || this.#sentReports.$size >= 1000) return;
    this.#sentReports.$add(legacy);
    for (const url of urls) this.#sendReport(url, "application/csp-report", legacy);
    if (group === undefined) return;
    const { blockedURI: blockedURL, documentURI: documentURL, violatedDirective, ...rest } = body;
    this.report(group, "csp-violation", { ...rest, blockedURL, documentURL });
  }

  /** To an endpoint that `Reporting-Endpoints` has named. */
  report(group: string, type: string, body: object) {
    const named = mime.split(this.#endpoints).find(endpoint => endpoint.startsWith(group + '="'));
    const url = named && URL.parse(named.slice(group.length + 2, named.indexOf('"', group.length + 2)), this.url);
    if (!url || !policy.isSecure(url.href)) return;
    const report = { age: 0, body, type, url: forReport(this.url), user_agent: this.webContents.getUserAgent() };
    this.#sendReport(url.href, "application/reports+json", JSON.stringify([report]));
  }

  #sendReport(url: string, type: string, text: string) {
    const isLegacy = type === "application/csp-report";
    this.request({
      url: URL.parse(url, this.url)?.href ?? "",
      method: "POST",
      destination: "report",
      mode: isLegacy ? "no-cors" : "cors",
      credentials: "same-origin",
      redirect: isLegacy ? undefined : "error",
      onRedirect: () => false,
      headers: [["content-type", type]],
      body: Buffer.from(text),
      signal: undefined,
    }).then(
      loaded => loaded.response?.body?.cancel(),
      () => {},
    );
  }

  /** Whatever the policy of the page allows, no script of another party runs in this process. */
  allowsUrl(url: string, destination: string, more: object) {
    if (!this.csp.allowsUrl(url, destination, more)) return false;
    if (destination !== "script" && destination !== "worker" && destination !== "sharedworker") return true;
    if (compiled.isExclusive) return compiled.pathOf(url) !== undefined;
    if (url.startsWith("blob:")) return true;
    return url.startsWith("data:")
      ? this.csp.restrictsScripts() || policy.trustsInjectedScripts()
      : policy.isTrusted(url, app.getAppPath());
  }

  /** `done` of the result has to be called with the size of the body, when that has been read. */
  request = ({ initiator, fetched, blocksRendering, ...options }: any) => {
    const start = performance.timeOrigin + performance.now();
    const name = options.url;
    const record = (loaded: object, size: number) => {
      if (initiator && isWeb.test(name))
        this.recordTiming({ ...timingOf(name, initiator, loaded, size), blocksRendering });
    };
    let first: string | undefined;
    return loader
      .load(this.session, {
        origin: this.origin,
        userAgent: this.webContents.getUserAgent(),
        frame: this,
        signal: this.aborter.signal,
        ancestors: this.ancestors(),
        upgradesInsecure: this.upgradesInsecure(),
        blocksAllMixed: this.csp.has("block-all-mixed-content"),
        embedderPolicy: this.embedderPolicy,
        tellsCompletion: true,
        allows: (target: string, redirected: boolean) =>
          this.allowsUrl(target, options.destination, {
            ...fetched,
            redirectedFrom: redirected ? first : void (first = target),
          }),
        ...options,
        referrer: options.referrer ?? this.referrerUrl(),
        referrerPolicy: options.referrerPolicy || loader.parseReferrerPolicy(this.referrerPolicy),
        ...(!this.checksOrigins && { mode: undefined }),
      })
      .then(
        loaded => Object.assign(loaded, { done: (size: number) => void (loaded.completed?.(), record(loaded, size)) }),
        error => {
          if (error.code !== "ERR_ABORTED") {
            this.log("error", `Failed to load ${options.url}: ${error.message}`);
            record(failedLoad(start), 0);
          }
          throw error;
        },
      );
  };

  /** What a preload has got is for the first request that is like it. */
  async requestBytes({ isPreload, ...options }: any) {
    if (!isPreload && this.#preloaded.$size === 0) return this.#readAll(options);
    const key = [options.url.split("#")[0], options.destination, options.mode, options.credentials].join(" ");
    const known = this.#preloaded.$get(key);
    if (isPreload) {
      if (!known) this.#preloaded.$set(key, this.#readAll(options));
      return this.#preloaded.$get(key);
    }
    if (!known || !this.allowsUrl(options.url, options.destination, options.fetched)) return this.#readAll(options);
    this.#preloaded.$delete(key);
    const loaded = await known;
    const { integrity } = options;
    if (integrity && (loaded.tainting === "opaque" || !policy.hasIntegrity(loaded.bytes, integrity)))
      throw loader.netError("FAILED");
    return loaded;
  }

  async #readAll(options: object) {
    const loaded = await this.request(options);
    const bytes: Uint8Array = (await loaded.response?.bytes()) ?? new Uint8Array();
    loaded.done(bytes.length);
    return Object.assign(loaded, { bytes });
  }

  recordTiming(timing: object) {
    if (this.#timingWatcher) this.#timingWatcher(timing);
    else if (this.#timings.length < MAX_UNREAD_TIMINGS) this.#timings.push(timing);
  }

  #takePreloaded({ url, destination, mode, credentials, method }: any) {
    const key = [url.split("#")[0], destination, mode, credentials].join(" ");
    const known = method === "GET" ? this.#preloaded.$get(key) : undefined;
    this.#preloaded.$delete(key);
    return known?.then(({ bytes, ...loaded }) => ({
      ...loaded,
      response: loaded.response && new Response(bytes),
      done() {},
    }));
  }

  load = ({ headers, keepalive, ...rest }: any) => {
    const controller = new AbortController();
    let fail: ((error: unknown) => void) | undefined;
    const stop = () => (controller.abort(), fail?.(controller.signal.reason));
    if (!keepalive) this.cleanups.$add(stop);
    const ownHeaders = Array.from(headers, (header: string[]) => [header[0], header[1]]);
    const preloaded = this.#preloaded.$size > 0 ? this.#takePreloaded(rest) : undefined;
    const promise = (preloaded ?? this.request({ ...rest, headers: ownHeaders, signal: controller.signal })).then(
      ({ response, done, completed, failed, internal, timing, ...loaded }) => {
        const end = () => void (this.cleanups.$delete(stop), (fail = undefined));
        const finish = (size: number) => fail && (end(), done(size));
        fail = error => (end(), failed?.(error));
        const rethrow = (error: unknown) => {
          fail?.(error);
          throw error;
        };
        if (!response) return (finish(0), loaded);
        let reader;
        let size = 0;
        const count = (chunk: any) => {
          if (chunk.done) finish(size);
          else size += chunk.value.length;
          return chunk;
        };
        const ahead: Promise<any>[] = [];
        let isWanted = false;
        const next = () => (reader ??= (response.body ?? new Blob().stream()).getReader()).read().then(count, rethrow);
        const read = () => ((isWanted = true), ahead.shift() ?? next());
        const readAll = async () => {
          isWanted = true;
          if (!reader) return response.bytes().then(bytes => (finish(bytes.length), bytes), rethrow);
          const chunks: Uint8Array[] = [];
          for (let chunk; !(chunk = await read()).done;) chunks.push(chunk.value);
          return Bun.concatArrayBuffers(chunks, Infinity, true);
        };
        soon(async () => {
          while (!isWanted && size < MAX_READ_AHEAD) {
            const reading = next();
            ahead.push(reading);
            if ((await reading).done) return;
          }
        });
        return { ...loaded, reader: { read, readAll } };
      },
      error => {
        this.cleanups.$delete(stop);
        throw error;
      },
    );
    return { promise, abort: stop };
  };

  /** What is neither sent nor canceled is sent when the document goes away. */
  deferLoad = (options: any, size: number) => {
    if (!isWeb.test(options.url) || !policy.isSecure(options.url)) return;
    let control: any = this;
    while (control.parent?.origin === this.origin && this.origin !== "null") control = control.parent;
    const deferred: Set<{ origin: string; size: number }> = (control.deferred ??= new Set());
    const entry = { origin: policy.originOf(options.url), size };
    const minimal = control.allowsFeature("deferred-fetch-minimal") ? 8 << 10 : 0;
    let left = !control.allowsFeature("deferred-fetch")
      ? control.parent
        ? minimal
        : 0
      : control.parent
        ? 64 << 10
        : 512 << 10;
    let leftForOrigin = 64 << 10;
    for (const it of deferred) {
      left -= it.size;
      if (it.origin === entry.origin) leftForOrigin -= it.size;
    }
    const quota = Math.max(0, Math.min(left, leftForOrigin));
    if (size > quota) return { quota };
    const cancel = () => (this.cleanups.$delete(send), deferred.$delete(entry));
    const send = () => cancel() && (this.load(options).promise.then(undefined, () => {}), true);
    deferred.$add(entry);
    this.cleanups.$add(send);
    return { send, cancel };
  };

  /** All of the response, or the type of the event that says why not. */
  loadWhole = async (options: object, timeout: number) => {
    const { promise, abort } = this.load(options);
    let failure = "error";
    const timer = timeout > 0 ? setTimeout(() => ((failure = "timeout"), abort()), timeout) : undefined;
    try {
      const { reader, ...loaded } = await promise;
      return { ...loaded, bytes: reader ? await reader.readAll() : new Uint8Array() };
    } catch {
      return { failure };
    } finally {
      clearTimeout(timer);
    }
  };

  /** `type` is that of the import, or "classic". */
  loadScript = async (url: string, type: string, { nonce, byScript, credentials, ...options }: any = {}) => {
    const source = type === "" ? await compiled.sourceOf?.(url) : undefined;
    if (source !== undefined)
      return { url, source: `${source}`, headers: [], isMuted: false, referrerPolicy: undefined };
    const isScript = type === "" || type === "classic";
    const loaded = await this.requestBytes({
      url,
      destination: isScript ? "script" : type === "css" ? "style" : type,
      mode: type === "classic" ? "no-cors" : "cors",
      credentials: credentials ?? (type === "classic" ? "include" : "same-origin"),
      initiator: "script",
      fetched: { nonce, byScript, integrity: options.integrity },
      ...options,
    });
    const essence = mime.extract(loader.find(loaded.headers, "content-type"))?.essence ?? "";
    const isLenient = type === "classic" && options.destination !== undefined && !isWeb.test(loaded.url);
    const hasType = isScript
      ? isLenient || mime.isJavaScript(essence)
      : type === "json"
        ? mime.isJson(essence)
        : type === "text" || essence === "text/css";
    if (loaded.status < 200 || loaded.status > 299 || !hasType) {
      throw new Error(`Failed to load ${url}: status ${loaded.status}, type "${essence}"`);
    }
    return {
      url: loaded.url,
      source: new TextDecoder().decode(loaded.bytes),
      headers: loaded.headers,
      isMuted: loaded.tainting === "opaque",
      referrerPolicy: loader.parseReferrerPolicy(loader.find(loaded.headers, "referrer-policy")),
    };
  };

  fetchResource = async (url: string, destination: string, element: any = {}) => {
    if (destination === "script" && compiled.pathOf(url)) {
      return { ok: true, status: 200, url, mime: "text/javascript", bytes: new Uint8Array() };
    }
    const { nonce, parserInserted, crossOrigin, integrity, isPrefetch, isQuirky, type: _, ...more } = element;
    const loaded = await this.requestBytes({
      url,
      destination,
      mode: crossOrigin != null || (destination === "font" && !more.isPreload) ? "cors" : "no-cors",
      credentials:
        crossOrigin?.toLowerCase() === "use-credentials" ||
        (crossOrigin == null && (destination !== "font" || more.isPreload))
          ? "include"
          : "same-origin",
      integrity,
      ...(isPrefetch && { trustedHeaders: [["sec-purpose", "prefetch"]] }),
      fetched: { nonce, integrity, byScript: !parserInserted, isPrefetch },
      ...more,
    });
    const type = mime.extract(loader.find(loaded.headers, "content-type"));
    const isReadable = loaded.tainting !== "opaque";
    if (destination === "style" && type && type.essence !== "text/css" && !(isQuirky && isReadable)) {
      throw new TypeError(`${url} is not a style sheet`);
    }
    return {
      ok: destination === "image" || isPrefetch || (loaded.internal.status >= 200 && loaded.internal.status <= 299),
      status: loaded.status,
      url: loaded.url,
      mime: type?.essence ?? "",
      charset: type?.parameters.get("charset"),
      isReadable,
      referrerPolicy: loader.parseReferrerPolicy(loader.find(loaded.headers, "referrer-policy")),
      bytes: loaded.bytes,
    };
  };

  /** The preloads that `Link` headers ask for. */
  followLinks(header = "") {
    for (const link of mime.split(
      header.replace(/<[^>]*>/g, url => url.replaceAll(",", "%2C").replaceAll(";", "%3B")),
    )) {
      const [target, ...parameters] = mime.split(link, ";");
      const given: any = { __proto__: null };
      for (const it of parameters)
        given[it.split("=")[0].trim().toLowerCase()] ??= it.replace(/^[^=]*=?\s*/, "").replace(/^"|"$/g, "");
      const url = URL.parse(target.slice(1, -1).replaceAll("%3B", ";"), this.url)?.href;
      const { as, crossorigin: crossOrigin, integrity, nonce, referrerpolicy: referrerPolicy, rel } = given;
      const isModule = rel === "modulepreload";
      if (!url || !(isModule || (rel === "preload" && canPreload(as, given.type)))) continue;
      const details = { crossOrigin: isModule ? (crossOrigin ?? "") : crossOrigin, integrity, nonce, referrerPolicy };
      const destination = isModule ? "script" : as === "fetch" ? "" : as;
      this.fetchResource(url, destination, { ...details, initiator: "link", isPreload: true }).catch(() => {});
    }
  }

  cookieContext(url: string) {
    const ancestors = this.ancestors();
    return {
      isSameSite: [this.origin, ...ancestors].every(origin => policy.isSameSite(url, origin)),
      partition: ancestors.at(-1) ?? this.origin,
    };
  }

  #webSocket(href: string) {
    const url = new URL(href);
    if (this.upgradesInsecure()) loader.upgrade(url);
    if (loader.isMixed(url, [this.origin, ...this.ancestors()])) return { refusal: "mixed" };
    if (loader.isUnsafePort(url) || !this.csp.allowsUrl(url.href, "")) return { refusal: "blocked" };
    const cookie = this.session.jar.header(url, this.cookieContext(url.href));
    const headers = {
      "origin": this.origin,
      "user-agent": this.webContents.getUserAgent(),
      "accept-language": this.session.acceptLanguage(),
      ...(cookie && { cookie }),
    };
    return { url: url.href, headers };
  }

  checkPermission = (name: string, more?: object) => {
    const check = this.session.checkPermission;
    const details = { isMainFrame: !this.parent, requestingUrl: this.url, embeddingOrigin: this.origin, ...more };
    return !check || check(this.webContents, name, this.origin + "/", details) ? "granted" : "denied";
  };

  /** What can be cloned. */
  about() {
    const origins = [this.origin, ...this.ancestors()];
    const top = origins.at(-1)!;
    const isThirdParty = !origins.every(origin => origin === top || policy.isSameSite(origin, top));
    const bucket = isThirdParty ? `${this.origin}^${top}` : this.origin;
    return {
      url: this.url,
      origin: this.origin,
      token: this.token,
      secure: this.isSecure(),
      isIsolated: this.isIsolated,
      bucket,
      storageKey: `${this.session.key}\n${this.origin === "null" ? this.token : bucket}`,
      userAgent: this.webContents.getUserAgent(),
      languages: languages(this.session),
      chromeVersion: process.versions.chrome,
    };
  }

  /** What a worker can ask for with messages. */
  services() {
    const { session } = this;
    const { bucket, storageKey } = this.about();
    const workers = () => require("internal/desktop/electron/workers");
    const forScript = () => ({ ...this.cookieContext(this.url), forScript: true });
    return {
      load: this.load,
      deferLoad: this.deferLoad,
      loadScript: this.loadScript,
      fetchResource: this.fetchResource,
      webSocket: (url: string) => this.#webSocket(url),
      socketOptions: async (url: string, headers: Record<string, string>) => ({
        headers: await loader.handshake(session, this, url, headers),
        ...(await session.socketOptions(new URL(url))),
      }),
      createWorker: (options: object, port: MessagePort, onError: Function) =>
        workers().create(this, options, port, onError),
      connectSharedWorker: (options: object, port: MessagePort, onError: Function) =>
        workers().connect(this, storageKey, options, port, onError),
      requestLock: (...args: unknown[]) => session.locksOf(bucket).request(this.token, ...args),
      requestFileLock: (name: string, granted: Function) =>
        session.locksOf("files\n" + bucket).request(this.token, name, "shared", false, false, granted),
      queryLocks: (ofFiles?: boolean) => session.locksOf((ofFiles ? "files\n" : "") + bucket).query(),
      checkPermission: this.checkPermission,
      isOnline: () => require("internal/desktop/electron/session").isOnline(),
      systemVersion: () =>
        process.platform === "darwin" ? (systemVersion ??= (process as any).getSystemVersion()) : "",
      watchResourceTimings: (watcher: (timing: object) => void) => {
        this.#timingWatcher = watcher;
        for (const timing of this.#timings.splice(0)) watcher(timing);
      },
      allowsEval: (code?: string) => this.csp.allowsEval(code) && !compiled.isExclusive,
      allowsStringFor: (sink: string, value: string) => this.csp.allowsStringFor(sink, value),
      allowsTypePolicy: (name: string, isTaken: boolean) => this.csp.allowsTypePolicy(name, isTaken),
      allowsTrustedTypesEval: () => this.csp.allowsTrustedTypesEval(),
      cookies: (url: string) => session.jar.matching(new URL(url), forScript()),
      setCookie: (header: string) => session.jar.receive(header, new URL(this.url), forScript()),
      caches: (method: string, ...args: unknown[]) => session.storage.caches(bucket)[method](...args),
      originDirectory: () => session.storage.directoryOf(bucket),
      usage: () => session.storage.usageOf(bucket),
    };
  }

  dispose() {
    this.disposed = true;
    this.aborter.abort();
    for (const cleanup of [...this.cleanups]) cleanup();
    this.cleanups.$clear();
    this.#timingWatcher = undefined;
  }
}

export default { Client, canPreload, languages, timingOf };
