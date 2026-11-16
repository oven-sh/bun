// An installed Chrome, Chromium or Edge as the web engine: what the helper does with Electron's API, as far as the
// DevTools protocol goes.
const fs = require("node:fs");
const path = require("node:path");
const native = require("internal/desktop/native");
const { originOf, privilegesOf } = require("internal/desktop/electron/policy");

const WORLD = "bun:desktop:frame";
/** Chrome has no custom schemes. `app://host/` is `https://host.app.invalid/` to it. */
const SUFFIX = ".invalid";
const isBuiltIn = /^(?:https?|file|data|blob|about|wss?|javascript|chrome-error):/;
const resourceTypes = { Stylesheet: "stylesheet", Script: "script", Image: "image", Font: "font", Media: "media" };
Object.assign(resourceTypes, { XHR: "xhr", Fetch: "xhr", EventSource: "xhr", Ping: "ping", WebSocket: "webSocket" });
const errnos = {
  ABORTED: -3,
  BLOCKED_BY_CLIENT: -20,
  CONNECTION_REFUSED: -102,
  NAME_NOT_RESOLVED: -105,
  FILE_NOT_FOUND: -6,
};
const levels = { debug: "debug", verbose: "debug", warning: "warning", error: "error", assert: "error" };
const sameSites = { strict: "Strict", lax: "Lax", no_restriction: "None" };

function toEngine(href: string) {
  const url = isBuiltIn.test(href) ? null : URL.parse(href);
  if (!url?.host || !privilegesOf(url.protocol).standard) return href;
  return `https://${url.host}.${url.protocol.slice(0, -1)}${SUFFIX}${href.slice(originOf(href).length)}`;
}

function fromEngine(href: string) {
  const match = /^https:\/\/([^/]+)\.([^./]+)\.invalid(?=\/|$)/.exec(href);
  if (!match || !privilegesOf(match[2] + ":").standard) return href;
  return `${match[2]}://${match[1]}${href.slice(match[0].length)}`;
}

const switches = (profile: string) => [
  "--headless",
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--no-startup-window",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-sync",
  "--deny-permission-prompts",
  // The handler of the app decides.
  "--disable-popup-blocking",
];

type Session = {
  id: number;
  context?: string;
  schemes: Set<string>;
  filters: Map<string, Function>;
  userAgent?: string;
};
type Frame = { id: number; key: string; view: number; parent?: number; url: string; origin: string; name: string };

class Page {
  frames = new Map<string, Frame & { session: string; world?: number }>();
  state: any = { url: "", title: "", isLoading: false, zoomLevel: 0, entries: [], index: 0 };
  session = "";
  stub: { url: string; html: string } | undefined;
  /** The app has asked for the navigation that is under way. */
  isExpected = false;
  loading: PromiseWithResolvers<void> | undefined;
  statuses = new Map<string, [number, string]>();
  opening: any;
  acknowledge: number | undefined;
  userAgent: string | undefined;

  constructor(
    readonly backend: Backend,
    readonly options: any,
    readonly target: string,
    readonly owner: Session,
  ) {}

  inspect(method: string, params?: object, session = this.session) {
    return this.backend.engine.inspect(method, params, session);
  }

  tell(method: string, params?: object, session = this.session) {
    return this.inspect(method, params, session).catch(() => {});
  }

  handle(key: string) {
    const frame = this.frames.$get(key);
    if (!frame) return null;
    const { session: _, world: __, ...rest } = frame;
    const ids = { processId: -this.options.id, routingId: frame.id, frameTreeNodeId: frame.id, frameToken: key };
    return this.backend.handle("frame", { ...rest, ...ids, osProcessId: 0 });
  }

  sendState() {
    const ids = { processId: -this.options.id, osProcessId: 0 };
    const frames = Array.from(this.frames.values(), ({ session: _, world: __, ...frame }) => ({
      ...{ ...frame, ...ids, routingId: frame.id, frameTreeNodeId: frame.id, frameToken: frame.key },
    }));
    this.backend.receive("state", this.options.id, { ...this.state, isLoadingMainFrame: this.state.isLoading, frames });
  }

  emit(name: string, details: object | false, ...args: unknown[]): boolean {
    this.sendState();
    return !!(this.backend.receive("ask", "event", "view", this.options.id, name, details, args) as any)?.isPrevented;
  }

  emitForFrame(name: string, key: string, details: object, ...args: unknown[]) {
    return this.emit(name, details, ...args, key === this.target, -this.options.id, this.frames.$get(key)?.id);
  }

  emitNavigation(name: string, key: string, url: string, isSameDocument = false) {
    const details = { url, isSameDocument, isMainFrame: key === this.target, frame: this.handle(key) };
    return this.emitForFrame(name, key, { ...details, initiator: this.handle(key) }, url, isSameDocument);
  }

  addFrame(key: string, session: string, parent?: string) {
    const known = this.frames.$get(key);
    if (known) return void Object.assign(known, { session, world: undefined });
    const id = this.backend.nextId++;
    const about = { url: "", origin: "null", name: "", parent: parent ? this.frames.$get(parent)?.id : undefined };
    this.frames.$set(key, { id, key, view: this.options.id, session, ...about });
    this.backend.pages.$set(key, this);
    this.backend.objects.$set(id, {
      executeJavaScript: code => this.evaluate(code, key),
      reload: () => this.tell("Page.reload"),
    });
    if (parent) this.emit("frame-created", {}, { frame: this.handle(key) });
  }

  removeFrame(key: string) {
    const frame = this.frames.$get(key);
    if (!frame) return;
    this.frames.$delete(key);
    this.backend.pages.$delete(key);
    this.backend.objects.$delete(frame.id);
    this.frames.$forEach(other => other.parent === frame.id && this.removeFrame(other.key));
  }

  async attach(session: string) {
    this.backend.engine.inspected.set(session, (method: string, params: any) => this.events[method]?.(params, session));
    const { javascript, images: _ } = this.options.preferences;
    const userAgent = this.userAgent ?? this.owner.userAgent ?? this.backend.userAgent;
    await Promise.all([
      ...["Page", "Runtime", "Network", "Log"].map(domain => this.tell(domain + ".enable", {}, session)),
      this.tell("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, session),
      userAgent && this.tell("Emulation.setUserAgentOverride", { userAgent }, session),
      this.tell("Emulation.setEmulatedMedia", this.backend.media, session),
      this.tell("Emulation.setScriptExecutionDisabled", { value: javascript === false }, session),
    ]);
    this.tell("Runtime.runIfWaitingForDebugger", {}, session);
  }

  resize() {
    const { width, height, scale } = this.options;
    const zoom = 1.2 ** this.state.zoomLevel;
    const size = { width: Math.round(width / zoom), height: Math.round(height / zoom) };
    return this.tell("Emulation.setDeviceMetricsOverride", { ...size, deviceScaleFactor: scale * zoom, mobile: false });
  }

  async updateHistory() {
    const { entries, currentIndex } = (await this.tell("Page.getNavigationHistory")) ?? { entries: [] };
    const first = +(entries[0]?.url === "about:blank" && entries.length > 1);
    const title = entries[currentIndex]?.title ?? "";
    this.state.entries = entries.slice(first).map(({ id, url, title }) => ({ id, url: fromEngine(url), title }));
    this.state.index = currentIndex - first;
    if (title === this.state.title) return this.sendState();
    this.emit("page-title-updated", {}, (this.state.title = title), true);
  }

  fail(key: string, url: string, text: string) {
    const code = text.replace("net::", "");
    const errno = errnos[code.slice(4)] ?? -2;
    this.emitForFrame("did-fail-provisional-load", key, {}, errno, code, url);
    if (errno !== -3) this.emitForFrame("did-fail-load", key, {}, errno, code, url);
    if (key !== this.target) return;
    this.loading?.reject(Object.assign(new Error(`${code} (${errno}) loading '${url}'`), { errno, code, url }));
    this.loading = undefined;
  }

  documents = new Map<string, [frame: string, url: string]>();
  events = {
    __proto__: null,
    "Target.attachedToTarget": ({ sessionId, targetInfo }) => {
      if (targetInfo.type !== "iframe") return void this.tell("Runtime.runIfWaitingForDebugger", {}, sessionId);
      this.addFrame(targetInfo.targetId, sessionId, targetInfo.parentFrameId);
      this.attach(sessionId);
    },
    "Target.detachedFromTarget": ({ sessionId }) => this.backend.engine.inspected.delete(sessionId),
    "Inspector.targetCrashed": (_, session) => {
      if (session !== this.session) return;
      this.state.isCrashed = true;
      this.emit("render-process-gone", {}, { reason: "crashed", exitCode: -1 });
    },
    "Page.frameAttached": ({ frameId, parentFrameId }, session) => this.addFrame(frameId, session, parentFrameId),
    "Page.frameDetached": ({ frameId, reason }) => {
      if (reason !== "swap") this.removeFrame(frameId);
      this.sendState();
    },
    "Page.frameStartedLoading": ({ frameId }) => {
      if (frameId !== this.target) return;
      this.state.isLoading = true;
      this.emit("did-start-loading", false);
    },
    "Page.frameStoppedLoading": async ({ frameId }) => {
      this.backend.readCookies(this.owner);
      this.emitForFrame("did-frame-finish-load", frameId, {});
      if (frameId !== this.target) return;
      await this.updateHistory();
      this.state.isLoading = false;
      this.emit("did-stop-loading", false);
    },
    "Page.frameNavigated": async ({ frame }, session) => {
      this.addFrame(frame.id, session, frame.parentId);
      const known = this.frames.$get(frame.id)!;
      for (const other of [...this.frames.values()]) if (other.parent === known.id) this.removeFrame(other.key);
      const url = fromEngine(frame.unreachableUrl ?? frame.url + (frame.urlFragment ?? ""));
      // Until the context of its scripts tells whether it is sandboxed.
      Object.assign(known, { url, name: frame.name ?? "", origin: "null", world: undefined });
      if (frame.id === this.target) Object.assign(this.state, { url, isCrashed: (this.isExpected = false) });
      if (frame.unreachableUrl) return;
      const status = this.statuses.$get(frame.loaderId) ?? [200, "OK"];
      this.statuses.$delete(frame.loaderId);
      this.emitForFrame("did-frame-navigate", frame.id, {}, url, ...status);
      if (frame.id !== this.target) return;
      this.emit("did-navigate", {}, url, ...status);
      this.updateHistory();
    },
    "Page.navigatedWithinDocument": async ({ frameId, url }) => {
      Object.assign(this.frames.$get(frameId) ?? {}, { url: (url = fromEngine(url)) });
      if (frameId === this.target) {
        this.state.url = url;
        await this.updateHistory();
        this.events["Page.loadEventFired"](undefined, this.session, false);
      }
      this.emitNavigation("did-start-navigation", frameId, url, true);
      this.emitForFrame("did-navigate-in-page", frameId, {}, url);
    },
    "Page.domContentEventFired": (_, session) => session === this.session && this.emit("dom-ready", {}),
    "Page.loadEventFired": async (_, session, isDocument = true) => {
      if (session !== this.session) return;
      const { loading } = this;
      this.loading = undefined;
      await this.updateHistory();
      if (isDocument) this.emit("did-finish-load", false);
      loading?.resolve();
    },
    "Page.windowOpen": params => (this.opening = params),
    "Page.screencastFrame": ({ data, sessionId }) => {
      this.acknowledge = sessionId;
      this.backend.receive("paint", this.options.id, { blob: native.putBlob(Buffer.from(data, "base64")) });
    },
    "Page.javascriptDialogOpening": ({ type, message, frameId }, session) => {
      const close = (accept: boolean) => this.tell("Page.handleJavaScriptDialog", { accept }, session);
      if (type === "beforeunload") return close(this.emit("will-prevent-unload", {}));
      const info = { dialogType: type, messageText: message, frame: this.handle(frameId) };
      this.backend.receive("dialog", this.options.id, info, close);
    },
    "Runtime.executionContextCreated": ({ context }) => {
      const frame = this.frames.$get(context.auxData?.frameId);
      if (frame && context.name === WORLD) frame.world = context.id;
      if (!frame || !context.auxData.isDefault) return;
      frame.origin = context.origin === "://" ? "null" : fromEngine(context.origin);
      this.sendState();
    },
    "Runtime.bindingCalled": ({ payload, executionContextId }, session) => {
      if (session !== this.session || executionContextId !== this.frames.$get(this.target)?.world) return;
      this.backend.receive("frame", this.options.id, Buffer.from(payload, "base64"));
    },
    "Runtime.consoleAPICalled": ({ type, args, stackTrace }) => {
      const { url = "", lineNumber = -1 } = stackTrace?.callFrames[0] ?? {};
      this.log(levels[type], args.map(it => it.value ?? it.description ?? it.type).join(" "), lineNumber + 1, url);
    },
    "Runtime.exceptionThrown": ({ exceptionDetails: { text, exception, lineNumber, url } }) =>
      this.log("error", `${text} ${exception?.description?.split("\n")[0] ?? ""}`.trim(), lineNumber + 1, url ?? ""),
    "Log.entryAdded": ({ entry }) => this.log(levels[entry.level], entry.text, entry.lineNumber ?? 0, entry.url ?? ""),
    "Network.requestWillBeSent": ({ type, requestId, frameId, request, redirectResponse }) => {
      if (type !== "Document") return;
      const url = fromEngine(request.url + (request.urlFragment ?? ""));
      this.documents.$set(requestId, [frameId, url]);
      this.emitNavigation(redirectResponse ? "did-redirect-navigation" : "did-start-navigation", frameId, url);
    },
    "Network.responseReceived": ({ type, loaderId, response }) => {
      if (type === "Document") this.statuses.$set(loaderId, [response.status, response.statusText]);
    },
    "Network.responseReceivedExtraInfo": ({ headers }) => {
      if (Object.keys(headers).some(name => /^set-cookie$/i.test(name))) this.backend.readCookies(this.owner);
    },
    "Network.loadingFinished": ({ requestId }) => this.documents.$delete(requestId),
    "Network.loadingFailed": ({ requestId, errorText, blockedReason }) => {
      const document = this.documents.$get(requestId);
      this.documents.$delete(requestId);
      if (document) this.fail(...document, errorText || `ERR_BLOCKED_BY_${blockedReason.toUpperCase()}`);
    },
  };

  log(level = "info", message: string, lineNumber: number, sourceId: string) {
    const number = ["debug", "info", "warning", "error"].indexOf(level);
    this.emit("console-message", { message, level, lineNumber, sourceId }, number, message, lineNumber, sourceId);
  }

  async evaluate(expression: string, key = this.target, worldName?: string, userGesture?: boolean) {
    const { session } = this.frames.$get(key)!;
    const contextId =
      worldName &&
      (await this.inspect("Page.createIsolatedWorld", { frameId: key, worldName }, session)).executionContextId;
    if (!worldName && key !== this.target && session === this.session)
      throw unsupported("executeJavaScript in this frame");
    const params = { expression, contextId, userGesture, awaitPromise: true, returnByValue: true };
    const { result, exceptionDetails } = await this.inspect("Runtime.evaluate", params, session);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }

  async whenLoaded() {
    await this.loading?.promise.catch(() => {});
  }

  methods = {
    __proto__: null,
    loadURL: async (url: string, { extraHeaders, postData, httpReferrer, baseURLForDataURL }: any = {}) => {
      if (baseURLForDataURL) {
        this.stub = {
          url: toEngine(baseURLForDataURL).split("#")[0],
          html: decodeURIComponent(url.slice(url.indexOf(",") + 1)),
        };
        if (this.stub.url.startsWith("file:")) {
          const file = path.join(this.backend.engine.directory, `page${this.options.id}.html`);
          fs.writeFileSync(file, this.stub.html);
          this.stub.url = Bun.pathToFileURL(file).href;
        }
        url = this.stub.url;
        // A response that is made up counts as one from the internet.
        const where = { setting: "granted", origin: originOf(url), browserContextId: this.owner.context };
        const grant = (name: string) =>
          this.backend.engine.inspect("Browser.setPermission", { permission: { name }, ...where });
        await Promise.allSettled(["local-network-access", "local-network", "loopback-network"].map(grant));
      }
      this.loading?.reject(
        Object.assign(new Error(`ERR_ABORTED (-3) loading '${url}'`), { errno: -3, code: "ERR_ABORTED", url }),
      );
      const { promise } = (this.loading = Promise.withResolvers<void>());
      this.isExpected = true;
      this.options.request = { extraHeaders, postData };
      this.tell("Page.navigate", { url: toEngine(url), referrer: httpReferrer }).then(result => {
        if (result?.errorText && this.loading?.promise === promise) this.fail(this.target, url, result.errorText);
      });
      return promise;
    },
    reload: (ignoreCache?: boolean) => ((this.isExpected = true), this.tell("Page.reload", { ignoreCache })),
    reloadIgnoringCache: () => this.methods.reload(true),
    stop: () => this.tell("Page.stopLoading"),
    close: () => this.tell("Page.close"),
    forcefullyCrashRenderer: () => void this.tell("Page.crash"),
    "navigationHistory.goToIndex": (index: number) => {
      this.isExpected = true;
      this.tell("Page.navigateToHistoryEntry", { entryId: this.state.entries[index].id });
    },
    "navigationHistory.clear": () => this.tell("Page.resetNavigationHistory").then(() => this.updateHistory()),
    executeJavaScript: (code: string, userGesture?: boolean) =>
      this.whenLoaded().then(() => this.evaluate(code, this.target, undefined, userGesture)),
    executeJavaScriptInIsolatedWorld: (world: number, scripts: { code: string }[]) =>
      this.whenLoaded().then(() =>
        this.evaluate(scripts.map(it => it.code).join(";\n"), this.target, world ? `world ${world}` : ""),
      ),
    insertCSS: async (css: string) => {
      const key = String(this.backend.nextId++);
      const add = `{const s=new CSSStyleSheet;s.replaceSync(${JSON.stringify(css)});(globalThis.sheets??={})[${key}]=s;document.adoptedStyleSheets.push(s)}`;
      await this.evaluate(add, this.target, "css");
      return key;
    },
    removeInsertedCSS: (key: string) =>
      this.evaluate(
        `void(document.adoptedStyleSheets=document.adoptedStyleSheets.filter(s=>s!==globalThis.sheets?.[${+key}]))`,
        this.target,
        "css",
      ),
    insertText: (text: string) => this.tell("Input.insertText", { text }),
    capturePage: async (rect?: object) => {
      const { data } = await this.inspect("Page.captureScreenshot", { clip: rect && { ...rect, scale: 1 } });
      return this.backend.handle("image", Buffer.from(data, "base64"));
    },
    printToPDF: async ({ landscape, printBackground, scale, pageRanges, preferCSSPageSize }: any = {}) => {
      const options = { landscape, printBackground, scale, pageRanges, preferCSSPageSize };
      return Buffer.from((await this.inspect("Page.printToPDF", options)).data, "base64");
    },
    downloadURL: (url: string) => this.backend.download(this, url),
    setUserAgent: (userAgent: string) =>
      this.tell("Emulation.setUserAgentOverride", { userAgent: (this.userAgent = userAgent) }),
    setZoomLevel: (level: number) => ((this.state.zoomLevel = level), this.resize()),
    setZoomFactor: (factor: number) => this.methods.setZoomLevel(Math.log(factor) / Math.log(1.2)),
    setBackgroundColor: (argb: string) => {
      const [a, r, g, b] = Buffer.from(argb.slice(1), "hex");
      this.tell("Emulation.setDefaultBackgroundColorOverride", { color: { r, g, b, a: a / 255 } });
    },
    setContentSize: (width: number, height: number) => (Object.assign(this.options, { width, height }), this.resize()),
    startPainting: () => this.tell("Page.startScreencast", { format: "png" }),
    stopPainting: () => this.tell("Page.stopScreencast"),
  };
}
for (const name of ["undo", "redo", "cut", "copy", "paste", "pasteAndMatchStyle", "delete", "selectAll", "unselect"]) {
  Page.prototype[name] = function () {
    return this.tell("Input.dispatchKeyEvent", { type: "rawKeyDown", commands: [name] });
  };
}

const unsupported = (what: string) => new Error(`${what} needs Electron as the web engine. See app.setWebEngine().`);
const toHeaders = (headers: object) =>
  Object.entries(headers).flatMap(([name, value]) => [value].flat().map(value => ({ name, value: String(value) })));

class Backend {
  nextId = 1;
  userAgent = require("internal/desktop/app").app.userAgentFallback;
  media = {};
  sessions = new Map<number, Session>();
  views = new Map<number, Page>();
  /** By the ids of their frames. */
  pages = new Map<string, Page>();
  objects = new Map<number, any>();
  /** The calls for the windows that a page is about to open. */
  #expected = new Map<number, any[][]>();
  #waiting = new Map<number, PromiseWithResolvers<any>>();
  #queue: Promise<unknown>;
  #clipboard: Promise<string> | undefined;

  constructor(
    readonly engine: any,
    readonly receive: (...message: unknown[]) => unknown,
    readonly handle: (...handle: unknown[]) => any,
  ) {
    engine.inspected.set(undefined, (method: string, params: any) => {
      if (method === "Fetch.requestPaused") this.#intercept(params).catch(() => this.#refuse(params, "Failed"));
      else if (method === "Target.attachedToTarget" && params.waitingForDebugger) this.#opened(params);
      else if (method === "Target.targetDestroyed") this.#destroyed(params.targetId);
      else if (method === "Browser.downloadWillBegin")
        this.download(this.pages.$get(params.frameId), params.url, params.suggestedFilename);
    });
    const pages = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: "page" }] };
    this.#queue = Promise.all([
      engine.inspect("Target.setDiscoverTargets", { discover: true, filter: pages.filter }),
      engine.inspect("Target.setAutoAttach", pages),
      this.#updateInterception(),
    ]);
  }

  run([name, ...args]: any[]) {
    if (name === "answer" || name === "painted") return this.#commands[name](...(args as [any, any, any]));
    this.#queue = this.#queue.then(() => this.#commands[name](...args)).catch(() => {});
  }

  #updateInterception() {
    const listens = (name: string) => [...this.sessions.values()].some(it => it.filters.$has(name));
    const isHandled = (scheme: string) => [...this.sessions.values()].some(it => it.schemes.$has(scheme));
    const seesAll =
      listens("onBeforeRequest") || listens("onBeforeSendHeaders") || isHandled("https") || isHandled("http");
    const patterns: object[] = seesAll ? [{}] : [{ resourceType: "Document" }, { urlPattern: `https://*${SUFFIX}/*` }];
    if (listens("onHeadersReceived")) patterns.push({ requestStage: "Response" });
    return this.engine.inspect("Fetch.enable", { patterns });
  }

  #refuse({ requestId }: any, errorReason: string) {
    return this.engine.inspect("Fetch.failRequest", { requestId, errorReason }).catch(() => {});
  }

  #request(...message: unknown[]) {
    const id = this.nextId++;
    const waiting = Promise.withResolvers<any>();
    this.#waiting.$set(id, waiting);
    this.receive("request", id, ...message);
    return waiting.promise;
  }

  async #intercept(params: any) {
    const { requestId, request, frameId, resourceType, responseStatusCode, responseHeaders, redirectedRequestId } =
      params;
    const reply = (method: string, more?: object) => this.engine.inspect("Fetch." + method, { requestId, ...more });
    const fulfill = (responseCode: number, headers: object, body = "") =>
      reply("fulfillRequest", {
        responseCode,
        responseHeaders: toHeaders(headers),
        body: Buffer.from(body).toString("base64"),
      });
    if (request.url === `https://clipboard${SUFFIX}/` || request.url === `https://media${SUFFIX}/`)
      return fulfill(200, { "content-type": "text/html" });
    const page = this.pages.$get(frameId);
    const isDocument = resourceType === "Document";
    const isMainFrame = isDocument && frameId === page?.target;
    if (isMainFrame && page.stub && page.isExpected) {
      return page.stub.url.startsWith("file:")
        ? reply("continueRequest")
        : fulfill(200, { "content-type": "text/html" }, page.stub.html);
    }
    // A worker has no frame. What cannot be put to the listeners of a session that has some does not go out.
    const only = this.sessions.size === 1 ? [...this.sessions.values()][0] : undefined;
    const session = page?.owner ?? only;
    if (!session) return this.#refuse(params, "BlockedByClient");
    const url = fromEngine(request.url);
    const ask = (name: string, more?: object) => {
      const details = {
        ...{ id: +requestId.replace(/\D/g, "").slice(-15), url, method: request.method, timestamp: Date.now() },
        resourceType: isMainFrame ? "mainFrame" : isDocument ? "subFrame" : (resourceTypes[resourceType] ?? "other"),
        referrer: fromEngine(request.headers.Referer ?? ""),
        webContents: page && this.handle("view", page.options.id),
        frame: page?.handle(frameId),
        ...more,
      };
      if (!session.filters.$get(name)?.(details)) return {};
      return new Promise<any>(resolve =>
        this.receive("webRequest", session.id, name, details, it => resolve(it ?? {})),
      );
    };
    if (responseStatusCode !== undefined) {
      const grouped = {};
      for (const { name, value } of responseHeaders) (grouped[name] ??= []).push(value);
      const statusLine = `HTTP/1.1 ${responseStatusCode} ${params.responseStatusText}`;
      const answer = await ask("onHeadersReceived", {
        responseHeaders: grouped,
        statusCode: responseStatusCode,
        statusLine,
      });
      if (answer.cancel) return this.#refuse(params, "BlockedByClient");
      if (!answer.responseHeaders) return reply("continueResponse");
      return reply("continueResponse", {
        responseCode: responseStatusCode,
        responseHeaders: toHeaders(answer.responseHeaders),
      });
    }
    if (params.responseErrorReason) return reply("continueRequest");
    if (isDocument && page) {
      const names = redirectedRequestId
        ? ["will-redirect"]
        : isMainFrame
          ? ["will-frame-navigate", "will-navigate"]
          : ["will-frame-navigate"];
      const isAsked = redirectedRequestId || !isMainFrame || !page.isExpected;
      const href = url + (request.urlFragment ?? "");
      if (isAsked && names.some(name => page.emitNavigation(name, frameId, href)))
        return this.#refuse(params, "Aborted");
    }
    const before = await ask("onBeforeRequest");
    if (before.cancel) return this.#refuse(params, "BlockedByClient");
    if (before.redirectURL) return fulfill(307, { location: toEngine(before.redirectURL) });
    const { extraHeaders, postData } =
      (isMainFrame && page.isExpected && !redirectedRequestId && page.options.request) || {};
    let headers = { ...request.headers };
    for (const line of extraHeaders?.split("\n") ?? [])
      if (line) headers[line.split(":")[0]] = line.slice(line.indexOf(":") + 1).trim();
    const sending = await ask("onBeforeSendHeaders", { requestHeaders: headers });
    if (sending.cancel) return this.#refuse(params, "BlockedByClient");
    headers = sending.requestHeaders ?? headers;
    const scheme = url.slice(0, url.indexOf(":"));
    if (!session.schemes.$has(scheme)) {
      const posts = postData && { method: "POST", postData: postData[0].bytes.toString("base64") };
      return reply("continueRequest", { headers: toHeaders(headers), ...posts });
    }
    const parts = request.postDataEntries?.map(it => Buffer.from(it.bytes ?? "", "base64"));
    const description = { url, method: request.method, headers, body: parts && Buffer.concat(parts) };
    const id = this.nextId++;
    const response = await this.#request("fetch", session.id, scheme, id, description);
    if (!response) return this.#refuse(params, "Failed");
    const chunks: Uint8Array[] = [];
    for (let chunk; response.hasBody && (chunk = await this.#request("pull", id));) chunks.push(chunk);
    return reply("fulfillRequest", {
      responseCode: response.status,
      responseHeaders: response.headers.map(([name, value]) => ({
        name,
        value: name === "location" ? toEngine(value) : value,
      })),
      body: Buffer.concat(chunks).toString("base64"),
    });
  }

  async #adopt(options: any, target: string, session: string) {
    const page = new Page(this, options, target, this.sessions.$get(options.session)!);
    page.session = session;
    page.isExpected = true;
    this.views.$set(options.id, page);
    page.addFrame(target, session);
    page.sendState();
    if (options.isFrame) {
      const { wire, frame } = native.ask("webview.helper", {});
      const source = `{
        const wire = (() => {${wire.replace("export default", "return")}})();
        const send = (_, bytes) => toApp(bytes.toBase64());
        const on = (_, listener) => (globalThis.fromApp = text => listener(0, Uint8Array.fromBase64(text)));
        const require = () => ({ ipcRenderer: { send, on } });
        ${frame}
      }`;
      page.tell("Runtime.addBinding", { name: "toApp", executionContextName: WORLD });
      page.tell("Page.addScriptToEvaluateOnNewDocument", { source, worldName: WORLD });
    }
    page.tell("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    page.resize();
    await page.attach(session);
    page.methods.startPainting();
    this.receive("created", options.id, target);
    const calls = this.#expected.$get(options.id);
    this.#expected.$delete(options.id);
    for (const call of calls ?? []) this.run(["call", ...call]);
  }

  #opened({ sessionId, targetInfo: { targetId, openerId, url } }: any) {
    const opener = this.pages.$get(openerId);
    if (!opener) {
      this.engine.inspect("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
      return void this.engine.inspect("Target.detachFromTarget", { sessionId }).catch(() => {});
    }
    const { url: wanted = url, windowName = "", windowFeatures = [] } = opener.opening ?? {};
    opener.opening = undefined;
    const options = this.receive("ask", "open", opener.options.id, {
      url: fromEngine(wanted),
      frameName: windowName === "_blank" ? "" : windowName,
      features: windowFeatures.join(),
      disposition: "new-window",
      referrer: { url: opener.state.url, policy: "strict-origin-when-cross-origin" },
    });
    if (options) this.#adopt(options, targetId, sessionId);
    else {
      this.engine.inspect("Target.closeTarget", { targetId }).catch(() => {});
      this.engine.inspect("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
    }
  }

  #destroyed(target: string) {
    const page = this.pages.$get(target);
    if (!page) return;
    page.removeFrame(target);
    this.views.$delete(page.options.id);
    this.engine.inspected.delete(page.session);
    this.readCookies(page.owner);
    this.receive("destroyed", page.options.id);
  }

  download(page: Page | undefined, url: string, name?: string) {
    const webContents = page && this.handle("view", page.options.id);
    webContents?.session.downloadURL(fromEngine(url), undefined, webContents, name);
  }

  #known = new WeakMap<Session, Map<string, any>>();
  async readCookies(session: Session) {
    const { cookies } = await this.engine
      .inspect("Storage.getCookies", { browserContextId: session.context })
      .catch(() => ({}));
    if (!cookies) return;
    const before = this.#known.get(session) ?? new Map();
    const now = new Map<string, any>();
    for (const {
      name,
      value,
      domain,
      path,
      secure,
      httpOnly,
      session: isSession,
      expires,
      sameSite,
      partitionKey,
    } of cookies) {
      if (partitionKey) continue;
      now.$set(`${domain}\n${path}\n${name}`, {
        ...{ name, value, domain, hostOnly: domain[0] !== ".", path, secure, httpOnly, session: isSession },
        sameSite: Object.keys(sameSites).find(it => sameSites[it] === sameSite) ?? "unspecified",
        ...(!isSession && { expirationDate: expires }),
      });
    }
    this.#known.set(session, now);
    before.$forEach((cookie, key) => now.$has(key) || this.receive("cookie", session.id, cookie, "explicit", true));
    now.$forEach(
      (cookie, key) =>
        Bun.deepEquals(before.$get(key), cookie) || this.receive("cookie", session.id, cookie, "explicit", false),
    );
  }

  /** The browser has a clipboard of its own, which only a page can use. */
  async #useClipboard(expression: string) {
    const session = await (this.#clipboard ??= (async () => {
      const origin = `https://clipboard${SUFFIX}`;
      const { browserContextId } = await this.engine.inspect("Target.createBrowserContext");
      const permissions = ["clipboardReadWrite", "clipboardSanitizedWrite"];
      await this.engine.inspect("Browser.grantPermissions", { origin, permissions, browserContextId });
      const { targetId } = await this.engine.inspect("Target.createTarget", { url: "about:blank", browserContextId });
      const { sessionId } = await this.engine.inspect("Target.attachToTarget", { targetId, flatten: true });
      await this.engine.inspect("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId);
      await this.engine.inspect("Page.navigate", { url: origin + "/" }, sessionId);
      return sessionId;
    })());
    const params = { expression, awaitPromise: true, returnByValue: true };
    return (await this.engine.inspect("Runtime.evaluate", params, session)).result.value;
  }

  #target(kind: string, id: any, method: string): Function | undefined {
    if (kind === "object") return this.objects.$get(id)?.[method];
    if (kind === "module") {
      if (method === "readText") return () => this.#useClipboard("navigator.clipboard.readText()");
      return (text: string) => this.#useClipboard(`navigator.clipboard.writeText(${JSON.stringify(text)})`);
    }
    if (kind !== "session") {
      const page = this.views.$get(id);
      return page?.methods[method] ?? page?.[method]?.bind(page);
    }
    const session = this.sessions.$get(id)!;
    if (method === "setUserAgent") return (userAgent: string) => (session.userAgent = userAgent);
    if (method === "setProxy") return (config: any) => this.#setProxy(session, config);
    if (/^clear(?:Storage)?Data$/.test(method)) return () => this.#renew(session);
    if (/^(?:clear|close|force|setSpell|disableNetwork)/.test(method)) return () => {};
  }

  async #renew(session: Session, proxy?: object) {
    const old = session.context;
    ({ browserContextId: session.context } = await this.engine.inspect("Target.createBrowserContext", proxy));
    const downloads = { behavior: "deny", eventsEnabled: true, browserContextId: session.context };
    await this.engine.inspect("Browser.setDownloadBehavior", downloads);
    const { jar } = this.engine.sessions.get(session.id).state;
    await this.#commands.cookies(session.id, jar.all(), []);
    if (old) this.engine.inspect("Target.disposeBrowserContext", { browserContextId: old }).catch(() => {});
  }

  #setProxy(session: Session, { mode, proxyRules, proxyBypassRules, pacScript }: any) {
    if (pacScript || mode === "auto_detect") throw unsupported("A PAC script");
    const proxyServer = mode === "direct" ? "direct://" : mode === "system" ? undefined : proxyRules;
    return this.#renew(session, { proxyServer, proxyBypassList: proxyBypassRules });
  }

  #commands = {
    __proto__: null,
    call: (reply: number, kind: string, id: unknown, method: string, args: unknown[], holdsUp: boolean) => {
      if (this.#expected.$has(id as number))
        return void this.#expected.$get(id as number)!.push([reply, kind, id, method, args]);
      const target = this.#target(kind, id, method);
      const done = (target ? Promise.try(target as any, ...args) : Promise.$reject(unsupported(method))).then(
        value => reply && this.receive("reply", reply, false, value),
        error => reply && this.receive("reply", reply, true, error),
      );
      if (holdsUp || method === "setContentSize") return done;
    },
    media: async (reply: number) => {
      const origin = `https://media${SUFFIX}`;
      const { browserContextId } = await this.engine.inspect("Target.createBrowserContext");
      await this.engine.inspect("Browser.grantPermissions", {
        origin,
        permissions: ["audioCapture", "speakerSelection"],
        browserContextId,
      });
      const { targetId } = await this.engine.inspect("Target.createTarget", { url: "about:blank", browserContextId });
      const { sessionId } = await this.engine.inspect("Target.attachToTarget", { targetId, flatten: true });
      await this.engine.inspect("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId);
      await this.engine.inspect("Page.navigate", { url: origin + "/" }, sessionId);
      this.receive("reply", reply, false, targetId);
    },
    answer: (id: number, isError: boolean, value: unknown) => {
      this.#waiting.$get(id)![isError ? "reject" : "resolve"](value);
      this.#waiting.$delete(id);
    },
    session: (id: number) => {
      this.sessions.$set(id, { id, schemes: new Set(), filters: new Map() });
      return this.#renew(this.sessions.$get(id)!);
    },
    cookies: async (id: number, stored: any[], removed: any[]) => {
      const session = this.sessions.$get(id)!;
      const convert =
        (expires?: number) =>
        ({ name, value, domain, path, secure, httpOnly, sameSite, expirationDate }: any) => ({
          ...{
            name,
            value,
            domain,
            path,
            secure,
            httpOnly,
            sameSite: sameSites[sameSite],
            expires: expires ?? expirationDate,
          },
        });
      const set = (cookie: object) =>
        this.engine.inspect("Storage.setCookies", { cookies: [cookie], browserContextId: session.context });
      await Promise.allSettled([...removed.map(convert(1)), ...stored.map(convert())].map(set));
    },
    sendCookies: async (reply: number, id: number) => {
      await this.readCookies(this.sessions.$get(id)!);
      this.receive("reply", reply, false);
    },
    expect: (id: number) => void (this.views.$has(id) || this.#expected.$set(id, [])),
    handle() {},
    handler() {},
    webRequest: (id: number, name: string, filter?: any) => {
      const { filters } = this.sessions.$get(id)!;
      const { matchPattern } = require("internal/desktop/electron/policy");
      const [included, excluded] = [filter?.urls, filter?.excludeUrls].map(it => it?.map(matchPattern));
      const matches = ({ url, resourceType }) =>
        (included?.some(it => it(new URL(url))) ?? true) &&
        !excluded?.some(it => it(new URL(url))) &&
        (filter.types?.includes(resourceType) ?? true);
      if (filter) filters.$set(name, matches);
      else filters.$delete(name);
      return this.#updateInterception();
    },
    protocol: (id: number, scheme: string, isHandled: boolean) => {
      this.sessions.$get(id)!.schemes[isHandled ? "add" : "delete"](scheme);
      return this.#updateInterception();
    },
    theme: (value: string) => {
      this.media = { features: [{ name: "prefers-color-scheme", value }] };
      this.pages.$forEach((page, key) =>
        page.tell("Emulation.setEmulatedMedia", this.media, page.frames.$get(key)!.session),
      );
    },
    create: async (options: any) => {
      const where = {
        url: "about:blank",
        newWindow: true,
        browserContextId: this.sessions.$get(options.session)!.context,
      };
      const { targetId } = await this.engine.inspect("Target.createTarget", where);
      const { sessionId } = await this.engine.inspect("Target.attachToTarget", { targetId, flatten: true });
      await this.#adopt(options, targetId, sessionId);
      if (options.preferences.preload)
        this.views.$get(options.id)!.emit("preload-error", {}, options.preferences.preload, unsupported("preload"));
    },
    destroy: (id: number) => this.engine.inspect("Target.closeTarget", { targetId: this.views.$get(id)?.target }),
    painted: (id: number) => {
      const page = this.views.$get(id);
      page?.tell("Page.screencastFrameAck", { sessionId: page.acknowledge });
    },
    frame: (id: number, bytes: Uint8Array) => {
      const page = this.views.$get(id);
      const contextId = page?.frames.$get(page.target)?.world;
      page?.tell("Runtime.evaluate", { expression: `fromApp("${Buffer.from(bytes).toString("base64")}")`, contextId });
    },
    release() {},
  };
}

export default { Backend, fromEngine, switches, toEngine };
