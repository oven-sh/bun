const addressFamilies = { A: 4, AAAA: 6 };

const EventEmitter = require("node:events");
const path = require("node:path");
const { app, Event } = require("internal/desktop/app");
const policy = require("internal/desktop/electron/policy");
const loader = require("internal/desktop/electron/loader");
const proxies = require("internal/desktop/electron/proxy");
const { Cookies, kJar, isWithin, withoutDot } = require("internal/desktop/electron/cookies");
const { Storage } = require("internal/desktop/electron/storage");
const { inert, unsupported } = require("internal/desktop/electron/stubs");

const kState = Symbol("state");
const nothing = Object.freeze({});

/** Where `--host-resolver-rules` sends what is for `url`. */
function mapHost(url: URL) {
  if (!app.commandLine.hasSwitch("host-resolver-rules")) return;
  const rules = app.commandLine
    .getSwitchValue("host-resolver-rules")
    .split(",")
    .map(rule => rule.trim().split(/\s+/));
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  const matches = (pattern = "") => {
    const glob = new RegExp(`^${RegExp.escape(pattern).replaceAll("\\*", ".*").replaceAll("\\?", ".?")}$`, "i");
    return glob.test(url.hostname) || glob.test(`${url.hostname}:${port}`);
  };
  if (rules.some(([kind, pattern]) => kind.toLowerCase() === "exclude" && matches(pattern))) return;
  const target = rules.find(([kind, pattern]) => kind.toLowerCase() === "map" && matches(pattern))?.[2];
  if (target === undefined) return;
  if (/^[~^]notfound$/i.test(target)) throw loader.netError("NAME_NOT_RESOLVED");
  const mapped = new URL(url);
  mapped.host = target;
  return mapped;
}

class WebRequest {
  [kState] = new Map<string, { matches(url: URL): boolean; types?: string[]; listener: Function }>();
}
for (const name of [
  "onBeforeRequest",
  "onBeforeSendHeaders",
  "onSendHeaders",
  "onHeadersReceived",
  "onResponseStarted",
  "onBeforeRedirect",
  "onCompleted",
  "onErrorOccurred",
]) {
  WebRequest.prototype[name] = function (filter: any, listener?: Function | null) {
    if (arguments.length < 2) [filter, listener] = [{}, filter];
    if (!listener) return void this[kState].delete(name);
    const included = (filter?.urls ?? []).map(policy.matchPattern);
    const excluded = (filter?.excludeUrls ?? []).map(policy.matchPattern);
    this[kState].set(name, {
      matches: url => (!included.length || included.some(it => it(url))) && !excluded.some(it => it(url)),
      types: filter?.types,
      listener,
    });
  };
}

function webRequestHooks(webRequest: WebRequest) {
  const listeners = webRequest[kState];
  function deliver(name: string, url: URL, describe: () => any, callback?: Function) {
    const found = listeners.$get(name);
    if (!found?.matches(url)) return false;
    const details = describe();
    if (found.types?.length && !found.types.includes(details.resourceType)) return false;
    found.listener(details, callback);
    return true;
  }
  return {
    listens: (name: string, url: URL) => !!listeners.$get(name)?.matches(url),
    tell: deliver,
    ask(name: string, url: URL, describe: () => any) {
      if (!listeners.$has(name)) return nothing;
      return new Promise(resolve => {
        if (!deliver(name, url, describe, response => resolve(response ?? nothing))) resolve(nothing);
      });
    },
  };
}

type Legacy = (value: any) => [body: any, mimeType?: string] | Promise<Response>;
const legacyKinds: Record<string, Legacy> = {
  String: value => [value.data ?? value, value.mimeType ?? "text/plain"],
  Buffer: value => [value.data ?? value, value.mimeType ?? "text/html"],
  Stream: value => [require("node:stream").Readable.toWeb(value.data ?? value), value.mimeType],
  File: value =>
    fetchWith(defaultSession(), Bun.pathToFileURL(value.path ?? value), { bypassCustomProtocolHandlers: true }),
  Http: value =>
    fetchWith(value.session ?? defaultSession(), value.url, {
      method: value.method,
      bypassCustomProtocolHandlers: true,
    }),
};

const kServers = Symbol("servers");

class Protocol {
  [kState] = new Map<string, Function>();
  [kServers] = new Map<string, Function>();

  registerSchemesAsPrivileged(schemes: { scheme: string; privileges?: object }[]) {
    if (app.isReady()) throw new Error("protocol.registerSchemesAsPrivileged should be called before app is ready");
    for (const { scheme, privileges } of schemes) policy.schemes.set(scheme + ":", { ...privileges });
  }

  handle(scheme: string, handler: (request: Request) => Response | Promise<Response>) {
    if (this.isProtocolHandled(scheme)) throw new Error(`Failed to register protocol: ${scheme}`);
    this[kState].$set(scheme + ":", handler);
  }

  /**
   * The app has the files of a web origin, and its own pages get them from `server`. What that returns nothing for
   * goes to the network, but scripts and style sheets are refused, and documents are for the web engine.
   */
  serve(origin: string, server: Function | null) {
    if (server) this[kServers].$set(new URL(origin).origin, server);
    else this[kServers].$delete(new URL(origin).origin);
  }

  unhandle(scheme: string) {
    if (!this[kState].$delete(scheme + ":")) throw new Error(`Failed to unhandle protocol: ${scheme}`);
  }

  isProtocolHandled(scheme: string) {
    return this[kState].$has(scheme + ":");
  }
}
for (const kind in legacyKinds) {
  for (const verb of ["register", "intercept"]) {
    Protocol.prototype[`${verb}${kind}Protocol`] = function (scheme: string, handler: Function) {
      if (this.isProtocolHandled(scheme)) return false;
      this.handle(scheme, async request => {
        const { url, method, referrer } = request;
        const uploadData = request.body ? [{ type: "rawData", bytes: Buffer.from(await request.bytes()) }] : undefined;
        const headers = Object.fromEntries(request.headers);
        const value: any = await new Promise(done => handler({ url, method, referrer, headers, uploadData }, done));
        if (value === undefined || typeof value === "number" || value.error) return Response.error();
        const answer = legacyKinds[kind](value);
        if (!$isArray(answer)) return answer;
        const response = new Response(answer[0], {
          status: value.statusCode,
          headers: loader.flatten(value.headers ?? {}),
        });
        if (answer[1]) response.headers.set("content-type", answer[1]);
        return response;
      });
      return true;
    };
  }
}
for (const name of ["unregisterProtocol", "uninterceptProtocol"]) {
  Protocol.prototype[name] = function (scheme: string) {
    return this[kState].delete(scheme + ":");
  };
}
for (const name of ["isProtocolRegistered", "isProtocolIntercepted"]) {
  Protocol.prototype[name] = Protocol.prototype.isProtocolHandled;
}

function usable(route: (string | null)[]) {
  const found = route.filter(proxy => proxy === null || proxy.startsWith("http"));
  if (found.length === 0) throw loader.netError("NO_SUPPORTED_PROXIES");
  return found;
}

const kRenewPool = Symbol("renewPool");
/** Reading those of the system is slow, so it waits for a server that needs them. */
let authorities: string[] | undefined;

function trustSystemAuthorities() {
  if (authorities) return;
  const { getCACertificates } = require("node:tls");
  authorities = [...getCACertificates("default"), ...getCACertificates("system")];
  sessions.$forEach(session => session[kRenewPool]());
}

const kDisconnect = Symbol("disconnect");
const isOfGuests = /^(bridge|vmenet|vmnet|vboxnet|virbr|veth|docker|br-)/i;
const isLinkLocal = /^(fe80:|169[.]254[.])/i;
const isLoopback = /^(localhost|127[.][\d.]+|.::1.)$/;
let addresses: string[] | undefined;

function readAddresses() {
  const found: string[] = [];
  for (const [name, list] of Object.entries<any>(require("node:os").networkInterfaces())) {
    if (isOfGuests.test(name)) continue;
    for (const { address, internal } of list) if (!internal && !isLinkLocal.test(address)) found.push(address);
  }
  return found;
}

function networkMayHaveChanged() {
  const before = addresses!;
  const now = (addresses = readAddresses());
  if (before.join() === now.join()) return;
  // Temporary IPv6 addresses come and go all the time.
  const isCut = now.length === 0 || before.some(it => !it.includes(":") && !now.includes(it));
  sessions.$forEach(session => session[kDisconnect](isCut ? "NETWORK_CHANGED" : undefined));
  if ((before.length === 0) !== (now.length === 0))
    require("internal/desktop/electron/page").onlineChanged(now.length > 0);
}

function resumed() {
  sessions.$forEach(session => session[kDisconnect]("NETWORK_IO_SUSPENDED"));
  networkMayHaveChanged();
}

function isOnline() {
  if (addresses === undefined) {
    addresses = readAddresses();
    setInterval(networkMayHaveChanged, 3000).unref();
    const watch = () => require("internal/desktop/system").api.powerMonitor.prependListener("resume", resumed);
    if (app.isReady()) watch();
    else app.once("will-finish-launching", watch);
  }
  return addresses.length > 0;
}

/** A root is its own issuer. */
const issuerOf = (certificate: any) =>
  certificate.issuerCertificate === certificate ? undefined : certificate.issuerCertificate;

let bundled: Set<string> | undefined;
function isBundled(certificate: any) {
  while (issuerOf(certificate)) certificate = issuerOf(certificate);
  bundled ??= new Set(require("node:tls").rootCertificates.map(it => it.replace(/-----.*?-----|\s/g, "")));
  return bundled.$has(certificate.raw.toString("base64"));
}

function describeCertificate(certificate: any) {
  const principal = ({ CN = "", O, OU, L = "", ST = "", C = "" }: any = {}) => ({
    commonName: CN,
    organizations: [O ?? []].flat(),
    organizationUnits: [OU ?? []].flat(),
    locality: L,
    state: ST,
    country: C,
  });
  const base64 = certificate.raw.toString("base64").replace(/.{64}(?=.)/g, "$&\n");
  const issuer = issuerOf(certificate);
  return {
    data: `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`,
    fingerprint: "sha256/" + Bun.CryptoHasher.hash("sha256", certificate.raw, "base64"),
    issuer: principal(certificate.issuer),
    issuerName: certificate.issuer?.CN ?? "",
    issuerCert: issuer?.raw && issuer !== certificate ? describeCertificate(issuer) : undefined,
    subject: principal(certificate.subject),
    subjectName: certificate.subject?.CN ?? "",
    serialNumber: certificate.serialNumber,
    validStart: Date.parse(certificate.valid_from) / 1000,
    validExpiry: Date.parse(certificate.valid_to) / 1000,
  };
}

/** Of `navigator.locks`, for one origin. */
class Locks {
  #held: any[] = [];
  #pending: any[] = [];

  #isFree({ name, mode }) {
    return this.#held.every(held => held.name !== name || (held.mode === "shared" && mode === "shared"));
  }

  #grant() {
    const blocked = new Set<string>();
    for (const lock of [...this.#pending]) {
      if (blocked.$has(lock.name) || !this.#isFree(lock)) {
        blocked.$add(lock.name);
        continue;
      }
      this.#pending.splice(this.#pending.indexOf(lock), 1);
      this.#held.push(lock);
      setImmediate(() => this.#held.includes(lock) && lock.notify("granted"));
    }
  }

  request(clientId: string, name: string, mode: string, ifAvailable: boolean, steal: boolean, notify: Function) {
    const lock = { clientId, name, mode, notify };
    if (steal) {
      for (const held of this.#held) if (held.name === name) setImmediate(held.notify, "stolen");
      this.#held = this.#held.filter(held => held.name !== name);
      this.#pending.unshift(lock);
    } else if (ifAvailable && (!this.#isFree(lock) || this.#pending.some(other => other.name === name))) {
      setImmediate(notify, "unavailable");
    } else this.#pending.push(lock);
    this.#grant();
    return {
      release: () => {
        this.#held = this.#held.filter(other => other !== lock);
        this.#pending = this.#pending.filter(other => other !== lock);
        this.#grant();
      },
    };
  }

  async query() {
    const describe = ({ clientId, name, mode }) => ({ clientId, name, mode });
    return { held: this.#held.map(describe), pending: this.#pending.map(describe) };
  }
}

const UPLOADED_PART = 64 << 10;

function withProgress({ body, headers, onUpload }: any) {
  const size = body?.size ?? body?.byteLength;
  if (!onUpload || !(size > UPLOADED_PART)) return;
  let sent = 0;
  const pull = async (controller: ReadableStreamDefaultController) => {
    onUpload(sent);
    if (sent >= size) return controller.close();
    const part = body.slice(sent, (sent = Math.min(sent + UPLOADED_PART, size)));
    controller.enqueue($isTypedArrayView(part) ? part : await Blob.prototype.bytes.$call(part));
  };
  headers = new Headers(headers);
  headers.set("content-length", String(size));
  return { headers, body: new ReadableStream({ pull }, { highWaterMark: 0 }) };
}

async function fetchWith(session: Session, input: any, init?: any) {
  const request = new Request(input instanceof URL ? input.href : input, init);
  let loaded;
  try {
    loaded = await loader.load(session[kState], {
      url: request.url,
      method: request.method,
      headers: [...request.headers],
      body: init?.duplex ? request.body : request.body && (await request.bytes()),
      redirect: request.redirect === "manual" ? "error" : request.redirect,
      credentials: init?.credentials,
      referrer: init?.referrer,
      signal: request.signal,
      bypassCustomProtocolHandlers: init?.bypassCustomProtocolHandlers,
    });
  } catch (error) {
    throw request.signal.aborted ? request.signal.reason : error;
  }
  const { url, redirected, status, statusText, headers } = loaded;
  const response = new Response(loaded.response?.body, { status, statusText, headers });
  return Object.defineProperties(response, { url: { value: url }, redirected: { value: redirected } });
}

class DownloadItem extends EventEmitter {
  savePath = "";
  #loaded;
  #controller: AbortController;
  #state = "progressing";
  #received = 0;
  #started = Date.now() / 1000;
  #ended = 0;
  #dialog = {};
  #resumed: { promise: Promise<void>; resolve(): void } | undefined;
  #origin: string;

  constructor(loaded: any, controller: AbortController, origin = "") {
    super();
    this.#loaded = loaded;
    this.#controller = controller;
    this.#origin = origin;
  }

  static async start(session: Session, loaded: any, controller: AbortController, webContents?: any, fileName?: string) {
    const item = new DownloadItem({ ...loaded, fileName }, controller, webContents?.mainFrame.origin);
    const event = new Event();
    session.emit("will-download", event, item, webContents, webContents?.mainFrame);
    if (event.defaultPrevented) return controller.abort();
    if (!item.savePath && item.#state === "progressing") {
      const defaultPath = path.join(session[kState].downloadPath ?? app.getPath("downloads"), item.getFilename());
      const { filePath } = await require("internal/desktop/dialog").showSaveDialog({ defaultPath, ...item.#dialog });
      if (filePath) item.savePath = filePath;
      else item.cancel();
    }
    let partial = "";
    try {
      controller.signal.throwIfAborted();
      const writer = Bun.file((partial = `${item.savePath}.${crypto.randomUUID().slice(0, 8)}.download`)).writer();
      for await (const chunk of loaded.response?.body ?? []) {
        await item.#resumed?.promise;
        controller.signal.throwIfAborted();
        await writer.write(chunk);
        item.#received += chunk.length;
        item.emit("updated", new Event(), "progressing");
      }
      await writer.end();
      require("node:fs").renameSync(partial, item.savePath);
      item.#state = "completed";
    } catch {
      if (item.#state === "progressing") item.#state = "interrupted";
      if (partial) require("node:fs").rmSync(partial, { force: true });
    }
    item.#ended = Date.now() / 1000;
    item.emit("done", new Event(), item.#state);
  }

  #header = (name: string): string => loader.find(this.#loaded.headers, name) ?? "";

  setSavePath = (file: string) => void (this.savePath = file);
  getSavePath = () => this.savePath;
  setSaveDialogOptions = (options: object) => void (this.#dialog = options);
  getSaveDialogOptions = () => this.#dialog;
  pause = () => void (this.#resumed ??= Promise.withResolvers<void>());
  isPaused = () => this.#resumed !== undefined;
  canResume = () => this.isPaused();
  getURL = () => this.#loaded.url;
  getURLChain = () => [this.#loaded.url];
  getInitiatorOrigin = () => this.#origin;
  getMimeType = () => this.#header("content-type").split(";")[0];
  hasUserGesture = () => true;
  getTotalBytes = () => +this.#header("content-length") || 0;
  getReceivedBytes = () => this.#received;
  getPercentComplete = () => (this.getTotalBytes() ? Math.floor((this.#received / this.getTotalBytes()) * 100) : -1);
  getCurrentBytesPerSecond = () => this.#received / Math.max(Date.now() / 1000 - this.#started, 0.001);
  getContentDisposition = () => this.#header("content-disposition");
  getState = () => this.#state;
  getLastModifiedTime = () => this.#header("last-modified");
  getETag = () => this.#header("etag");
  getStartTime = () => this.#started;
  getEndTime = () => this.#ended;

  resume() {
    this.#resumed?.resolve();
    this.#resumed = undefined;
  }

  cancel() {
    if (this.#state !== "progressing") return;
    this.#state = "cancelled";
    this.#controller.abort();
    this.resume();
  }

  getFilename() {
    const disposition = this.getContentDisposition();
    const plain = /filename="?([^";]+)/i.exec(disposition)?.[1];
    let name = this.#loaded.fileName ?? plain;
    try {
      const encoded = /filename\*=utf-8''([^;]+)/i.exec(disposition)?.[1];
      if (encoded) name = decodeURIComponent(encoded);
      if (/^(?:https?|file):/.test(this.#loaded.url)) {
        name ||= decodeURIComponent(path.posix.basename(new URL(this.#loaded.url).pathname));
      }
    } catch {}
    return (name || "download").replace(/[<>:"/\\|?*\0-\x1f]/g, "_").replace(/^\.+/, "_");
  }
}

let nextPreload = 1;

class ZoomLevels {
  #file: string | null;
  #levels: Record<string, number> | undefined;

  constructor(storagePath: string | null) {
    this.#file = storagePath && path.join(storagePath, "Zoom Levels");
  }

  #all(): Record<string, number> {
    if (this.#levels !== undefined) return this.#levels;
    this.#levels = Object.create(null);
    try {
      if (this.#file !== null)
        Object.assign(this.#levels, JSON.parse(require("node:fs").readFileSync(this.#file, "utf8")));
    } catch {}
    return this.#levels;
  }

  get(host: string): number | undefined {
    const level = this.#all()[host];
    return Number.isFinite(level) ? level : undefined;
  }

  set(host: string, level: number) {
    if (this.get(host) === level) return;
    this.#all()[host] = level;
    if (this.#file !== null) Bun.write(this.#file, JSON.stringify(this.#levels)).catch(() => {});
  }
}

class Session extends EventEmitter {
  [kState]: any;
  cookies;
  protocol = new Protocol();
  webRequest = new WebRequest();
  netLog = netLog;
  availableSpellCheckerLanguages = [];
  spellCheckerEnabled = process.platform === "darwin";
  serviceWorkers = inert(new EventEmitter(), {
    getAllRunning: () => ({}),
    getWorkerFromVersionID: undefined,
    startWorkerForScope: unsupported.rejects("ServiceWorkers.startWorkerForScope"),
  });
  extensions = inert(new EventEmitter(), {
    getAllExtensions: () => [],
    getExtension: null,
    removeExtension: undefined,
    loadExtension: unsupported.rejects("Extensions.loadExtension"),
  });
  #proxy = proxies.fromSwitches(app.commandLine?.appended ?? new Map());
  #pool: Bun.FetchSession | undefined;
  #userAgent: string | undefined;
  #languages: string | undefined;
  #verify: Function | null = null;
  #connections = new AbortController();
  #loopback = new AbortController();
  #spellCheckerLanguages: string[] = [];

  constructor(
    key: string,
    readonly storagePath: string | null,
  ) {
    super();
    const storage = new Storage(storagePath);
    const locks = new Map<string, Locks>();
    let cache: object | undefined;
    this.cookies = new Cookies(storage);
    this[kState] = {
      key,
      storage,
      jar: this.cookies[kJar],
      handlers: this.protocol[kState],
      servers: this.protocol[kServers],
      webRequest: webRequestHooks(this.webRequest),
      preflights: new Map(),
      logins: new Map<string, string>(),
      cache: () => (cache ??= new (require("internal/desktop/web/http_cache").HttpCache)(storagePath)),
      clearSite: async (origin: string, kinds: string[]) => {
        const asksFor = (kind: string) => kinds.includes(`"${kind}"`) || kinds.includes('"*"');
        if (asksFor("cookies")) this.#clear(["cookies"], [origin]);
        if (asksFor("storage")) this.#clear(["localstorage", "indexdb", "cachestorage", "filesystem"], [origin]);
        if (asksFor("cache")) await this[kState].cache().clear();
      },
      preloads: [],
      zoomLevels: new ZoomLevels(storagePath),
      userAgent: () => this.getUserAgent(),
      acceptLanguage: () => this.#languages ?? app.getLocale(),
      send: (url: URL, options: any, signal?: AbortSignal) => this.#send(url, options, signal),
      socketOptions: (url: URL) => {
        const toOptions = (route: (string | null)[]) => ({ proxy: usable(route)[0] ?? undefined, tls: this.#tls() });
        const route = proxies.resolve(url, this.#proxy);
        return $isPromise(route) ? route.then(toOptions) : toOptions(route);
      },
      locksOf(origin: string) {
        if (!locks.$has(origin)) locks.$set(origin, new Locks());
        return locks.$get(origin);
      },
    };
    mirrors.created(this, this[kState]);
  }

  #tls() {
    if (app.commandLine.hasSwitch("ignore-certificate-errors")) return { rejectUnauthorized: false };
    return { ca: authorities, checkServerIdentity: this.#verify ? this.#checkServerIdentity : undefined };
  }

  async #send(url: URL, options: any, given: AbortSignal | undefined) {
    if (addresses === undefined) isOnline();
    const closing = (isLoopback.test(url.hostname) ? this.#loopback : this.#connections).signal;
    const signal = given ? AbortSignal.any([given, closing]) : closing;
    const route = usable(await proxies.resolve(url, this.#proxy));
    const canRepeat = !(options.body instanceof ReadableStream);
    for (let i = 0; ;) {
      const trusted = authorities;
      const proxy = route[i] !== null && {
        url: route[i],
        respectNoProxy: false,
        headers: url.protocol === "https:" ? { "user-agent": this.getUserAgent() } : undefined,
      };
      this.#pool ??= new Bun.FetchSession({
        tls: this.#tls(),
        http2: !app.commandLine.hasSwitch("disable-http2"),
      } as any);
      try {
        const mapped = proxy ? undefined : mapHost(url);
        if (mapped) {
          const headers = new Headers(options.headers);
          headers.set("host", url.host);
          const tls = { ...this.#tls(), serverName: url.hostname };
          return await this.#pool.fetch(mapped.href, {
            ...options,
            ...withProgress(options),
            headers,
            tls,
            signal,
            proxy,
          });
        }
        return await this.#pool.fetch(url.href, { ...options, ...withProgress(options), signal, proxy });
      } catch (error) {
        const { code } = loader.toNetError(error, signal);
        if (code === "ERR_CERT_AUTHORITY_INVALID" && !trusted) {
          trustSystemAuthorities();
          if (canRepeat) continue;
        }
        if (!proxy || !/^ERR_(?:CONNECTION_REFUSED|NAME_NOT|INTERNET|TIMED)/.test(code)) throw error;
        if (!canRepeat || ++i === route.length) throw loader.netError("PROXY_CONNECTION_FAILED", error);
      }
    }
  }

  [kRenewPool]() {
    this.#pool?.close();
    this.#pool = undefined;
  }

  /** The procedure can only refuse more, and has to answer before it returns. */
  #checkServerIdentity = (hostname: string, peer: any) => {
    const mismatch = require("node:tls").checkServerIdentity(hostname, peer);
    if (mismatch) return mismatch;
    const certificate = describeCertificate(peer);
    let verdict = -2;
    this.#verify!(
      {
        hostname,
        certificate,
        validatedCertificate: certificate,
        get isIssuedByKnownRoot() {
          return isBundled(peer);
        },
        verificationResult: "net::OK",
        errorCode: 0,
      },
      (result: number) => (verdict = result),
    );
    if (verdict === -2) return loader.netError("FAILED");
  };

  fetch(input: any, init?: any) {
    return fetchWith(this, input, init);
  }

  isPersistent() {
    return this.storagePath !== null;
  }

  getStoragePath() {
    return this.storagePath;
  }

  getUserAgent() {
    return this.#userAgent ?? app.userAgentFallback;
  }

  setUserAgent(userAgent: string, acceptLanguages?: string) {
    this.#userAgent = userAgent;
    this.#languages = acceptLanguages;
  }

  async setProxy(config: any) {
    this.#proxy = proxies.normalize(config);
  }

  async forceReloadProxyConfig() {
    proxies.reload();
  }

  async resolveProxy(url: string) {
    return proxies.toAnswer(await proxies.resolve(new URL(url), this.#proxy));
  }

  async resolveHost(host: string, options: { queryType?: string } = {}) {
    try {
      const family = addressFamilies[options.queryType!] ?? 0;
      const name =
        mapHost(new URL("http://" + (host.includes(":") ? `[${host}]` : host)))?.hostname.replace(/^\[|\]$/g, "") ??
        host;
      const found = await require("node:dns").promises.lookup(name, { all: true, family });
      return { endpoints: found.map(({ address, family }) => ({ address, family: `ipv${family}` })) };
    } catch (error) {
      throw loader.netError("NAME_NOT_RESOLVED", error);
    }
  }

  /** Without a reason, only the idle ones. */
  [kDisconnect](reason?: string) {
    if (reason) {
      this.#connections.abort(loader.netError(reason));
      this.#connections = new AbortController();
    }
    this.#pool?.close();
  }

  async closeAllConnections() {
    this.#loopback.abort(loader.netError("CONNECTION_CLOSED"));
    this.#loopback = new AbortController();
    this[kDisconnect]("CONNECTION_CLOSED");
  }

  setCertificateVerifyProc(procedure: Function | null) {
    this.#verify = procedure;
    this[kRenewPool]();
  }

  setPermissionRequestHandler(handler: Function | null) {
    this[kState].requestPermission = handler;
  }

  setPermissionCheckHandler(handler: Function | null) {
    this[kState].checkPermission = handler;
  }

  /** Of `only`, or else of all origins but `except`. */
  #clear(kinds: string[] | undefined, only: string[] | undefined, except: string[] = []) {
    const { storage, jar } = this[kState];
    const listed = (only ?? except).map(policy.originOf);
    const matches = (bucket: string) => listed.includes(bucket.split("^")[0]) === (only !== undefined);
    const includes = (pattern: RegExp) => !kinds || kinds.some(kind => pattern.test(kind));
    if (includes(/^localstorage$/i)) storage.clearLocalStorage(matches);
    if (includes(/^index(?:ed)?db$/i)) storage.clearIndexedDB(matches);
    if (includes(/^(?:cachestorage|serviceworkers)$/i)) storage.clearCaches(matches);
    if (includes(/^filesystems?$/i)) storage.clearFiles(listed, only === undefined);
    if (!includes(/^cookies$/)) return;
    const sites = listed.map(origin => policy.siteOf(URL.parse(origin)?.hostname ?? ""));
    for (const cookie of jar.all()) {
      if (sites.includes(policy.siteOf(withoutDot(cookie.domain))) === (only !== undefined))
        jar.remove(cookie, "explicit");
    }
  }

  async clearStorageData({ origin, storages }: { origin?: string; storages?: string[] } = {}) {
    this.#clear(storages, origin ? [origin] : undefined);
  }

  async clearData({ dataTypes, origins, excludeOrigins }: Record<string, string[] | undefined> = {}) {
    this.#clear(dataTypes, origins, excludeOrigins);
    if (!dataTypes || dataTypes.includes("cache")) await this.clearCache();
  }

  async clearAuthCache() {
    this[kState].logins.clear();
  }

  clearCache() {
    return this[kState].cache().clear();
  }

  getCacheSize() {
    return this[kState].cache().size();
  }

  flushStorageData() {
    this[kState].jar.flush();
    this[kState].storage.flush();
  }

  registerPreloadScript(script: { id?: string; type: string; filePath: string }) {
    const id = script.id ?? `preload-${nextPreload++}`;
    if (!path.isAbsolute(script.filePath))
      throw new Error(`Preload script must have absolute path: ${script.filePath}`);
    this[kState].preloads.push({ ...script, id });
    return id;
  }

  unregisterPreloadScript(id: string) {
    this[kState].preloads = this[kState].preloads.filter(script => script.id !== id);
  }

  getPreloadScripts() {
    return this[kState].preloads.map(script => ({ ...script }));
  }

  setPreloads(files: string[]) {
    this[kState].preloads = this[kState].preloads.filter(script => script.type !== "frame");
    for (const filePath of files) this.registerPreloadScript({ type: "frame", filePath });
  }

  getPreloads() {
    return this[kState].preloads.filter(script => script.type === "frame").map(script => script.filePath);
  }

  setDownloadPath(directory: string) {
    this[kState].downloadPath = directory;
  }

  downloadURL(url: string, options?: { headers?: Record<string, string> }, webContents?: unknown, fileName?: string) {
    const controller = new AbortController();
    const headers = loader.flatten(options?.headers ?? {});
    loader.load(this[kState], { url, headers, signal: controller.signal }).then(
      loaded => DownloadItem.start(this, loaded, controller, webContents, fileName),
      () => {},
    );
  }

  setSpellCheckerEnabled(on: boolean) {
    this.spellCheckerEnabled = !!on;
  }

  isSpellCheckerEnabled() {
    return this.spellCheckerEnabled;
  }

  addWordToSpellCheckerDictionary(word: string) {
    if (process.platform !== "darwin") return false;
    const { kPrivate, webContents } = require("internal/desktop/electron/web_contents");
    require("internal/desktop/native")
      .request("spelling.learn", String(word))
      .then(() => webContents.getAllWebContents().forEach(contents => contents[kPrivate].dictionaryChanged()));
    return true;
  }

  setSpellCheckerLanguages(languages: string[]) {
    this.#spellCheckerLanguages = [...languages];
  }

  getSpellCheckerLanguages() {
    return [...this.#spellCheckerLanguages];
  }
}

const netLog = inert(
  { currentlyLogging: false },
  { startLogging: unsupported.rejects("netLog.startLogging"), stopLogging: async () => {} },
);

const resolves = async () => {};
inert(Session.prototype, {
  allowNTLMCredentialsForDomains: undefined,
  clearCodeCaches: resolves,
  clearHostResolverCache: resolves,
  disableNetworkEmulation: undefined,
  enableNetworkEmulation: undefined,
  listWordsInSpellCheckerDictionary: async () => [],
  preconnect: undefined,
  removeWordFromSpellCheckerDictionary: false,
  setBluetoothPairingHandler: undefined,
  setCodeCachePath: undefined,
  setDevicePermissionHandler: undefined,
  setDisplayMediaRequestHandler: undefined,
  setSSLConfig: undefined,
  setSpellCheckerDictionaryDownloadURL: undefined,
  setUSBProtectedClassesHandler: undefined,
});

for (const name of ["getAllExtensions", "getExtension", "loadExtension", "removeExtension"]) {
  Session.prototype[name] = function (...args: unknown[]) {
    return this.extensions[name](...args);
  };
}

const sessions = new Map<string, Session>();

const mirrors = require("internal/desktop/webview/sessions");
mirrors.install({ Session, Protocol, WebRequest });

function open(key: string, directory: () => string | null) {
  let session = sessions.$get(key);
  if (session) return session;
  if (!app.isReady()) throw new TypeError("Session can only be received when app is ready");
  sessions.$set(key, (session = new Session(key, directory())));
  app.emit("session-created", session);
  return session;
}

function fromPartition(partition = "") {
  return open(partition, () => {
    if (partition === "") return app.getPath("sessionData");
    if (!partition.startsWith("persist:")) return null;
    const name = encodeURIComponent(partition.slice(8).toLowerCase()).replace(/^\.+$/, "_");
    return path.join(app.getPath("sessionData"), "Partitions", name);
  });
}

const defaultSession = () => fromPartition("");

process.on("exit", () => sessions.$forEach(session => session.flushStorageData()));

const protocol: any = { registerSchemesAsPrivileged: Protocol.prototype.registerSchemesAsPrivileged };
for (const name of Object.getOwnPropertyNames(Protocol.prototype)) {
  if (name !== "constructor") protocol[name] ??= (...args: unknown[]) => defaultSession().protocol[name](...args);
}

export default {
  isOnline,
  kState,
  DownloadItem,
  defaultSession,
  fromPartition,
  netLog,
  protocol,
  session: {
    fromPartition,
    fromPath(directory: string) {
      if (!path.isAbsolute(directory)) throw new Error("An absolute path must be provided to session.fromPath()");
      return open("path:" + directory, () => directory);
    },
    get defaultSession() {
      return defaultSession();
    },
  },
};
