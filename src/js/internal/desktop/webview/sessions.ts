// The web engine has a session for each of the app's. The app's has the cookies, and decides.
const EventEmitter = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const engine = () => require("internal/desktop/webview/engine");

const kMirror = Symbol("mirror");

/** What the app has set, for an engine that starts later. */
class Mirror {
  commands = new Map<string, (engine: any, id: number) => unknown>();
  handlers = new Map<string, Function>();
  extensions = new Map<string, any>();
  engine: any;
  id = 0;
  running = {};
  workers: any[] = [];
  isReceiving = false;
  stored: object[] = [];
  removed: object[] = [];

  constructor(
    readonly session: any,
    readonly state: any,
  ) {}

  directory() {
    return this.session.storagePath && path.join(this.session.storagePath, "Web Engine", "Session");
  }

  remember(key: string, apply: (engine: any, id: number) => unknown) {
    this.commands.$delete(key);
    this.commands.$set(key, apply);
    const ownEngine = this.engine;
    if (ownEngine) return apply(ownEngine, this.id);
  }

  link() {
    if (this.engine) return this;
    listen();
    const started = (this.engine = engine().start());
    started.sessions.set((this.id = started.newId()), this);
    started.send("theme", theme());
    started.send("session", this.id, this.directory(), this.state.jar.all());
    this.commands.$forEach(apply => apply(started, this.id));
    return this;
  }

  engineClosed() {
    this.engine = undefined;
    this.running = {};
    this.workers = [];
  }

  async perform(method: string, args: unknown[]) {
    const release = this.link().engine.hold();
    try {
      return await this.engine.perform("session", this.id, method, args, /^(?:clear|close|force)/.test(method));
    } finally {
      release();
    }
  }

  /** `fetch()` without cookies and redirects, through the network stack of the engine. */
  async fetch(url: URL, { method, headers, body }: any, signal?: AbortSignal) {
    const { engine, id: session } = this.link();
    if (engine.type !== "electron") throw new Error("setWebEngineHosts() needs Electron as the web engine");
    const [id, release] = [engine.newId(), engine.hold()];
    const finish = () => (signal?.removeEventListener("abort", finish), engine.send("cancel", id), release());
    const aborted = new Promise<never>((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason)));
    const ask = (...message: unknown[]) => Promise.race([engine.request(...message), aborted]);
    aborted.catch(() => {});
    signal?.addEventListener("abort", finish);
    try {
      const bytes = body ? Buffer.from(await new Response(body).arrayBuffer()) : undefined;
      const response = await ask("load", id, session, { url: url.href, method, headers: [...headers], body: bytes });
      if (!response.hasBody || [101, 204, 205, 304].includes(response.status))
        return (finish(), new Response(null, response));
      const pull = (controller: ReadableStreamDefaultController) =>
        ask("read", id).then(
          chunk => (chunk ? controller.enqueue(chunk) : (finish(), controller.close())),
          error => (finish(), controller.error(error)),
        );
      return new Response(new ReadableStream({ pull, cancel: finish }), response);
    } catch (error) {
      finish();
      throw error;
    }
  }

  cookieChanged(cookie: object, removed: boolean) {
    if (!this.engine || this.isReceiving) return;
    const isFirst = this.removed.length + this.stored.length === 0;
    if (removed) this.stored = this.stored.filter(it => !isSameCookie(it, cookie));
    (removed ? this.removed : this.stored).push(cookie);
    if (!isFirst) return;
    // Before the promise of `cookies.set()` is seen to be fulfilled.
    process.nextTick(() => this.engine?.send("cookies", this.id, this.stored.splice(0), this.removed.splice(0)));
  }
}

const isSameCookie = (a: any, b: any) => a.name === b.name && a.domain === b.domain && a.path === b.path;
const theme = () => (require("internal/desktop/system").api.nativeTheme.shouldUseDarkColors ? "dark" : "light");

function after(
  prototype: object,
  names: string[],
  run: (self: any, name: string, args: any[], result: any) => unknown,
) {
  for (const name of names) {
    const original = prototype[name];
    prototype[name] = function (...args: unknown[]) {
      const result = original.$apply(this, args);
      if (!$isPromise(result)) return (run(this, name, args, result), result);
      return result.$then(async value => (await run(this, name, args, value)) ?? value);
    };
  }
}

const split = (names: string) => names.split(/\s+/);

function install({ Session, Protocol, WebRequest }: any) {
  const settings = `allowNTLMCredentialsForDomains disableNetworkEmulation enableNetworkEmulation setDownloadPath setProxy
    setSSLConfig setSpellCheckerDictionaryDownloadURL setSpellCheckerEnabled setSpellCheckerLanguages setUserAgent`;
  after(Session.prototype, split(settings), (session, name, args) =>
    // A page that loads without its proxy is worse than one that does not load.
    session[kMirror].remember(name, (engine, id) =>
      engine.perform("session", id, name, args, true).catch(() => name === "setProxy" && engine.close()),
    ),
  );
  const handlers = `setBluetoothPairingHandler setCertificateVerifyProc setDevicePermissionHandler
    setDisplayMediaRequestHandler setPermissionCheckHandler setPermissionRequestHandler setUSBProtectedClassesHandler`;
  after(Session.prototype, split(handlers), (session, name, [handler, options]) => {
    session[kMirror].handlers.set(name, handler);
    const isSync = /Check|Device|USB/.test(name);
    session[kMirror].remember(name, (engine, id) => engine.send("handler", id, name, !!handler, isSync, options));
  });
  after(Session.prototype, ["registerPreloadScript"], (session, name, [script], id) =>
    session[kMirror].remember(`preload ${id}`, (engine, own) =>
      engine.tell("session", own, name, [{ ...script, id, filePath: readable(engine, script.filePath) }]),
    ),
  );
  after(Session.prototype, ["unregisterPreloadScript"], (session, name, [id]) => {
    session[kMirror].commands.delete(`preload ${id}`);
    session[kMirror].engine?.tell("session", session[kMirror].id, name, [id]);
  });
  const clearing = `clearAuthCache clearCache clearCodeCaches clearData clearHostResolverCache clearStorageData
    closeAllConnections forceReloadProxyConfig getCacheSize`;
  after(Session.prototype, split(clearing), (session, name, args) => {
    const mirror: Mirror = session[kMirror];
    const isStored = /^clear(?:Cache|CodeCaches|Data|StorageData)$/.test(name) && mirror.directory();
    if (mirror.engine || (isStored && fs.existsSync(isStored) && engine().isAvailable()))
      return mirror.perform(name, args);
  });
  after(
    Protocol.prototype,
    split("handle unhandle unregisterProtocol uninterceptProtocol"),
    (protocol, name, [scheme]) =>
      protocol[kMirror].remember(`protocol ${scheme}`, (engine, id) =>
        engine.send("protocol", id, scheme, name === "handle"),
      ),
  );
  after(WebRequest.prototype, Object.keys(WebRequest.prototype), (webRequest, name, args) => {
    const [filter, listener] = args.length < 2 ? [{}, args[0]] : args;
    const { urls, excludeUrls, types } = filter ?? {};
    const given = Object.entries({ urls, excludeUrls, types }).filter(it => it[1]?.length);
    webRequest[kMirror].handlers.set(name, listener);
    webRequest[kMirror].remember(name, (engine, id) =>
      engine.send("webRequest", id, name, listener && Object.fromEntries(given)),
    );
  });
}

function created(session: any, state: any) {
  const mirror = new Mirror(session, state);
  session[kMirror] = session.protocol[kMirror] = session.webRequest[kMirror] = mirror;
  state.jar.observe = (cookie: object, removed: boolean) => mirror.cookieChanged(cookie, removed);
  Object.assign(session.serviceWorkers, {
    getAllRunning: () => mirror.running,
    getWorkerFromVersionID: (id: number) => mirror.workers.find(it => it.versionId === id),
    getInfoFromVersionID(id: number) {
      if (!mirror.running[id]) throw new Error("Could not find service worker with that version_id");
      return mirror.running[id];
    },
    startWorkerForScope: (scope: string) => mirror.perform("serviceWorkers.startWorkerForScope", [scope]),
  });
  session.setWebEngineHosts = (hosts: string[]) => {
    const patterns: RegExp[] = hosts.map(require("internal/desktop/electron/policy").glob);
    state.viaWebEngine = (url: URL, options: object, signal?: AbortSignal) =>
      patterns.some(it => it.test(url.hostname) || it.test(url.host)) ? mirror.fetch(url, options, signal) : undefined;
  };
  const holds = new Map<string, () => void>();
  Object.assign(session.extensions, {
    getAllExtensions: () => [...mirror.extensions.values()],
    getExtension: (id: string) => mirror.extensions.$get(id) ?? null,
    async loadExtension(directory: string, options?: object) {
      const extension = await mirror.perform("extensions.loadExtension", [directory, options]);
      mirror.extensions.$set(extension.id, extension);
      holds.$set(extension.id, holds.$get(extension.id) ?? mirror.engine.hold());
      return extension;
    },
    removeExtension(id: string) {
      mirror.engine?.tell("session", mirror.id, "extensions.removeExtension", [id]);
      mirror.extensions.$delete(id);
      holds.$get(id)?.();
      holds.$delete(id);
    },
  });
}

/** A file in the executable is not there for another process. */
function readable(engine: any, file: string) {
  if (!file.startsWith("/$bunfs/") && !file.startsWith("B:/~BUN/") && !file.startsWith("B:\\~BUN\\")) return file;
  const copy = path.join(engine.directory, `${Bun.hash(file)}.js`);
  fs.writeFileSync(copy, fs.readFileSync(file));
  return copy;
}

class DownloadItem extends EventEmitter {
  #release;
  #savePath = "";
  #dialog = {};
  #temporary = "";
  #chosen: Promise<void> | undefined;

  constructor(
    readonly engine: any,
    readonly id: number,
    public state: Record<string, unknown>,
  ) {
    super();
    this.#release = engine.hold();
    for (const name in state) this[name] = () => this.state[name];
    for (const name of ["cancel", "pause", "resume"]) this[name] = () => engine.tell("object", id, name);
    this["getSaveDialogOptions"] = () => this.#dialog;
    this["getSavePath"] = () => this.savePath;
  }

  setSaveDialogOptions(options: object) {
    this.#dialog = options;
  }

  /** The dialog of the engine would belong to no window. */
  askWhereToSave(session: any, webContents: any) {
    if (this.#savePath) return;
    const { kState } = require("internal/desktop/electron/session");
    const directory = session[kState].downloadPath ?? require("internal/desktop/app").app.getPath("downloads");
    const options = { defaultPath: path.join(directory, this.state.getFilename as string), ...this.#dialog };
    this.#temporary = path.join(path.dirname(this.engine.directory), `${crypto.randomUUID()}.download`);
    this.engine.tell("object", this.id, "setSavePath", [this.#temporary]);
    const window = webContents?.getOwnerBrowserWindow() ?? undefined;
    this.#chosen = require("internal/desktop/dialog")
      .showSaveDialog(window, options)
      .then(({ filePath }) => {
        this.#savePath = filePath;
        if (!filePath) this["cancel"]();
      });
  }

  async #move(state: string) {
    await this.#chosen;
    try {
      if (state !== "completed") return state;
      if (!this.#savePath) return "cancelled";
      await fs.promises.copyFile(this.#temporary, this.#savePath);
      return state;
    } catch {
      return "interrupted";
    } finally {
      fs.rm(this.#temporary, { force: true }, () => {});
    }
  }

  setSavePath(file: string) {
    this.#savePath = file;
    this.engine.tell("object", this.id, "setSavePath", [file]);
  }

  get savePath() {
    return this.#savePath;
  }

  set savePath(file: string) {
    this.setSavePath(file);
  }

  async changed(name: string, state: string) {
    if (name === "done") {
      if (this.#chosen) this.state.getState = state = await this.#move(state);
      this.engine.objects.delete(this.id);
      this.#release();
    }
    this.emit(name, new (require("internal/desktop/app").Event)(), state);
  }

  engineClosed() {
    this.state.getState = "interrupted";
    this.changed("done", "interrupted");
  }
}

class ServiceWorkerMain {
  ipc = new (require("internal/desktop/electron/ipc").IpcMain)();
  session: any;

  constructor(
    readonly engine: any,
    readonly id: number,
    readonly scope: string,
    readonly scriptURL: string,
    readonly versionId: number,
  ) {}

  isDestroyed() {
    return !this.engine.objects.has(this.id);
  }

  send(...args: unknown[]) {
    this.engine.tell("object", this.id, "send", args);
  }

  startTask() {
    const task = this.engine.newId();
    this.engine.send("startTask", this.id, task);
    return { end: () => (this.engine.tell("object", task, "end"), this.engine.send("release", task)) };
  }

  event(more?: object) {
    const { session, versionId } = this;
    return new (require("internal/desktop/app").Event)({
      type: "service-worker",
      serviceWorker: this,
      session,
      versionId,
      ...more,
    });
  }

  engineClosed() {
    this.engine.objects.delete(this.id);
  }
}

let isListening = false;

function listen() {
  if (isListening) return;
  isListening = true;
  const { Engine, running } = engine();
  const { nativeImage, nativeTheme } = require("internal/desktop/system").api;
  const responses = new Map<number, { controller: AbortController; reader?: ReadableStreamDefaultReader }>();
  nativeTheme.on("updated", () => running()?.send("theme", theme()));
  Object.assign(Engine.handles, {
    session: (engine: any, id: number) => engine.sessions.get(id).session,
    image: (_: unknown, png: Buffer) => nativeImage.createFromBuffer(png),
    worker(engine: any, id: number, ...about: [string, string, number]) {
      const { objects } = engine;
      if (!objects.has(id)) objects.set(id, new ServiceWorkerMain(engine, id, ...about));
      return engine.objects.get(id);
    },
    download(engine: any, id: number, state: Record<string, unknown>) {
      const { objects } = engine;
      if (!objects.has(id)) objects.set(id, new DownloadItem(engine, id, state));
      return Object.assign(engine.objects.get(id), { state });
    },
  });
  Object.assign(Engine.handlers, {
    handler: (engine: any, id: number, name: string, args: unknown[]) =>
      engine.sessions.get(id).handlers.get(name)(...args),
    webRequest(engine: any, id: number, name: string, details: any, callback?: Function) {
      const listener = engine.sessions.get(id).handlers.get(name);
      details.webContentsId = details.webContents?.id;
      if (listener) listener(details, callback);
      else callback?.({});
    },
    workers(engine: any, id: number, running: object, workers: ServiceWorkerMain[]) {
      const mirror: Mirror = engine.sessions.get(id);
      for (const old of mirror.workers) if (!workers.includes(old)) old.engineClosed();
      for (const worker of workers) worker.session = mirror.session;
      Object.assign(mirror, { running, workers });
    },
    ipcFromWorker: (_: unknown, worker: ServiceWorkerMain, channel: string, args: unknown[], ports: object[]) =>
      worker.ipc.emit(channel, worker.event({ ports, reply: worker.send.bind(worker) }), ...args),
    invokeFromWorker(_: unknown, worker: ServiceWorkerMain, channel: string, args: unknown[]) {
      const handler = worker.ipc._invokeHandlers.get(channel);
      if (!handler) throw new Error(`No handler registered for '${channel}'`);
      return handler(worker.event(), ...args);
    },
    download: (_: unknown, item: DownloadItem, name: string, state: string) => item.changed(name, state),
    cookie(engine: any, id: number, cookie: any, cause: string, removed: boolean) {
      const mirror: Mirror = engine.sessions.get(id);
      const { jar } = mirror.state;
      const known = jar.all().find(it => isSameCookie(it, cookie));
      const isUnchanged = known && Object.keys(cookie).every(key => known[key] === cookie[key]);
      if (removed ? `${cause}`.endsWith("overwrite") || known?.value !== cookie.value : isUnchanged) return;
      mirror.isReceiving = true;
      if (removed) jar.remove(known, cause);
      else jar.store(cookie);
      mirror.isReceiving = false;
    },
    async fetch(
      engine: any,
      id: number,
      scheme: string,
      response: number,
      { url, referrer, initiatorOrigin, ...init }: any,
    ) {
      const entry: any = { controller: new AbortController() };
      responses.$set(response, entry);
      const request = new Request(url, { ...init, signal: entry.controller.signal });
      Object.defineProperties(request, { referrer: { value: referrer }, initiatorOrigin: { value: initiatorOrigin } });
      try {
        const answer = await engine.sessions.get(id).state.handlers.get(scheme + ":")(request);
        const { status, statusText, headers, body, type } = answer;
        if (typeof status !== "number" || type === "error") return;
        entry.reader = body?.getReader();
        return { status, statusText, headers: [...headers], hasBody: !!body };
      } finally {
        if (!entry.reader) responses.$delete(response);
      }
    },
    async pull(_: unknown, response: number) {
      const { value } = (await responses.$get(response)?.reader!.read()) ?? {};
      if (!value) responses.$delete(response);
      return value;
    },
    abort(_: unknown, response: number) {
      const entry = responses.$get(response);
      responses.$delete(response);
      entry?.controller.abort();
      entry?.reader?.cancel().catch(() => {});
    },
  });
}

export default { created, install, link: (session: any): Mirror => session[kMirror].link(), readable };
