const pointerPhases = { mouseDown: "down", mouseUp: "up", mouseLeave: "leave" };

const EventEmitter = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const native = require("internal/desktop/native");
const accelerator = require("internal/desktop/accelerator");
const { allocateSurfaceId, surfaces } = require("internal/desktop/surfaces");
const { app, Event, closeCancelled } = require("internal/desktop/app");
const loader = require("internal/desktop/electron/loader");
const mime = require("internal/desktop/web/mime");
const sessions = require("internal/desktop/electron/session");
const { IpcMain, cloneable, ipcMain, unwrapPorts, wrapPorts } = require("internal/desktop/electron/ipc");
const { Page } = require("internal/desktop/electron/page");
const { Context, LocalFrame } = require("internal/desktop/electron/frames");
const { LocalStorage } = require("internal/desktop/electron/storage");
const {
  endsTrustedDocument,
  isExcepted,
  isTrusted,
  isTrustedInFrame,
  originOf,
  trustsFrames,
} = require("internal/desktop/electron/policy");
const { inert, properties, queueTask, unsupported } = require("internal/desktop/electron/stubs");
const webEngine = () => require("internal/desktop/webview/engine");

type Entry = {
  url: string;
  title: string;
  state?: any;
  document: unknown;
  index?: number;
  origin?: unknown;
  /** The same in all the entries that only differ in their frames. */
  item?: number;
  /** The same for as long as it is about the same load of a URL, even if that has been repeated. */
  sequence?: number;
  /** What it takes to load it again. */
  request?: object;
  /** What the frames showed, by their places in the tree. */
  frames?: Map<string, Entry>;
};
type Navigation = {
  /** "push", "replace", "reload", or the index of an entry. */
  history: string | number;
  initiator?: any;
  method?: string;
  body?: Uint8Array;
  headers?: [string, string][];
  referrer?: string;
  userAgent?: string;
  referrerPolicy?: string;
  isForm?: boolean;
  /** What is left of the initiator. */
  creator?: any;
  hasTextActivation?: boolean;
  isByUser?: boolean;
  blob?: Blob;
  /** The document has been asked. */
  mayUnload?: boolean;
  navigationState?: unknown;
  srcdoc?: string;
  /** What a `javascript:` URL has evaluated to. */
  markup?: string;
  /** Of `loadURL()`. */
  options?: { webEngine?: boolean };
};

const all = new Map<number, WebContents>();
const kPrivate = Symbol("private");
let nextId = 1;
const MAX_ENTRIES = 50;
let nextItem = 1;
let focused: WebContents | null = null;

const ofFrames =
  /^(?:will-(?:frame-navigate|redirect)|did-(?:frame-.*|fail-.*|navigate-in-page|start-navigation|redirect-navigation)|frame-created|console-message|ipc-message.*)$/;
const sandboxDirective = /(?:^|[;,])\s*sandbox\b([^;,]*)/i;
const isWeb = /^https?:/;
const withoutHash = (url: string) => url.split("#")[0];
const toLevel = (factor: number) => Math.log(factor) / Math.log(1.2);

/** The page whose message is being delivered. It may have sent it while it was unloaded. */
let sender: unknown;

class WebFrameMain extends EventEmitter {
  #page;
  ipc = new IpcMain();
  name = "";
  osProcessId = process.pid;

  constructor(page: any) {
    super();
    this.#page = page;
  }

  get url() {
    return this.#page.url === "about:blank" && this.#page.isInitial ? "" : this.#page.url;
  }

  get origin() {
    return this.#page.origin;
  }

  get parent() {
    return this.#page.parent?.handle ?? null;
  }

  get top() {
    return this.parent?.top ?? this;
  }

  get frames() {
    return this.framesInSubtree.filter(frame => frame.parent === this);
  }

  get framesInSubtree(): any[] {
    return [this, ...[...this.#page.frames].flatMap(it => it.frames)];
  }

  get detached() {
    return this.#page.disposed;
  }

  get processId() {
    return this.#page.webContents.id;
  }

  get routingId() {
    return this.#page.id;
  }

  get frameToken() {
    return this.#page.token;
  }

  get frameTreeNodeId() {
    return this.#page.context.state.contents.id;
  }

  get visibilityState() {
    return this.#page.webContents[kPrivate].isVisible() ? "visible" : "hidden";
  }

  isDestroyed() {
    return this.#page.disposed;
  }

  executeJavaScript(code: string) {
    return this.#page.executeJavaScript(0, String(code));
  }

  send(channel: string, ...args: unknown[]) {
    if (typeof channel !== "string") throw new TypeError("Missing required channel argument");
    cloneable(() => this.#page.send(channel, args, []));
  }

  postMessage(channel: string, message: unknown, transfer?: unknown[]) {
    cloneable(() => this.#page.send(channel, [message], unwrapPorts(transfer)));
  }

  reload() {
    this.#page.webContents.reload();
    return true;
  }
}
inert(WebFrameMain.prototype, {
  collectJavaScriptCallStack: async () => "",
  printToPDF: unsupported.rejects("printToPDF"),
});

class NavigationHistory {
  #state;

  constructor(state: any) {
    this.#state = state;
  }

  canGoBack = () => this.canGoToOffset(-1);
  canGoForward = () => this.canGoToOffset(1);
  canGoToOffset = (offset: number) => this.#state.entries[this.#state.index + offset] !== undefined;
  goBack = () => this.goToOffset(-1);
  goForward = () => this.goToOffset(1);
  goToOffset = (offset: number) => this.goToIndex(this.#state.index + offset);
  goToIndex = (index: number) => this.#state.traverse(index);
  getActiveIndex = () => this.#state.index;
  length = () => this.#state.entries.length;
  getAllEntries = () => this.#state.entries.map(({ url, title }) => ({ url, title }));
  getEntryAtIndex = (index: number) => this.getAllEntries()[index] ?? null;

  clear() {
    const state = this.#state;
    state.guest?.clearHistory();
    state.entries = state.entries.slice(state.index, state.index + 1);
    state.index = 0;
  }

  removeEntryAtIndex(index: number) {
    const state = this.#state;
    if (index === state.index || !state.entries[index]) return false;
    state.guest?.removeEntry(index);
    state.entries.splice(index, 1);
    if (index < state.index) state.index--;
    return true;
  }

  restore({ entries, index = entries.length - 1 }: { entries: { url: string; title: string }[]; index?: number }) {
    const state = this.#state;
    if (!entries[index]) throw new Error("Invalid index. Index must be between 0 and the length of entries - 1.");
    state.entries = entries.map(({ url, title }) => ({ url, title, document: -1 }));
    state.index = index;
    return state.load(entries[index].url, { history: index });
  }
}

class Debugger extends EventEmitter {
  #webContents;
  #session: any;

  constructor(webContents: WebContents) {
    super();
    this.#webContents = webContents;
  }

  attach() {
    if (this.#session) throw new Error("Debugger is already attached to the target");
    const { PageSession } = require("internal/desktop/electron/devtools");
    this.#session = new PageSession(this.#webContents, (method: string, params: unknown) =>
      queueTask(() => this.emit("message", new Event(), method, params, "")),
    );
  }

  isAttached() {
    return this.#session !== undefined;
  }

  detach() {
    if (!this.#session) return;
    this.#session.close();
    this.#session = undefined;
    this.emit("detach", new Event(), "target closed");
  }

  async sendCommand(method: string, params?: object) {
    if (!this.#session) throw new Error("No target available");
    return this.#session.run(method, params ?? {});
  }
}

/** The ones that Electron takes from a page. */
const featuresOfWindow =
  /^(?:(?:min|max)(?:Width|Height)|opacity|show|center|useContentSize|frame|transparent|hasShadow|movable|closable|focusable|minimizable|maximizable|fullscreenable|alwaysOnTop|skipTaskbar|modal|acceptFirstMouse|autoHideMenuBar|title|backgroundColor|titleBarStyle|vibrancy|resizable)$/;

const isOfItsKind = (name: string, value: unknown) =>
  typeof value ===
  (/^(?:min|max)[WH]|^opacity/.test(name)
    ? "number"
    : /^(?:title|backgroundColor|vibrancy)/.test(name)
      ? "string"
      : "boolean");

function canEvaluate() {
  try {
    // eslint-disable-next-line no-eval
    return globalThis.eval("true");
  } catch {
    return false;
  }
}

const inputTypes = { down: "mouseDown", up: "mouseUp", move: "mouseMove", leave: "mouseLeave" };
const modifierNames = (bits: number) =>
  ["shift", "control", "alt", "meta", "altgr", "capslock"].filter((_, index) => bits & (1 << index));

class WebContents extends EventEmitter {
  id = nextId++;
  ipc = new IpcMain();
  session;
  navigationHistory;
  hostWebContents = null;
  devToolsWebContents = null;
  [kPrivate]: any;
  #preferences;
  #page: any;
  #surface = allocateSurfaceId();
  #size: object | undefined;
  #destroyed = false;
  #debugger: Debugger | undefined;
  #pending: { controller: AbortController; url: string; isTraversal?: boolean } | undefined;
  #loading = false;
  #settle: { resolve(): void; reject(error: Error): void } | undefined;
  #userAgent: string | undefined;
  #openHandler: Function | null = null;
  #opener: any;
  #zoomMode = "default";
  #ownZoom: number | undefined;
  #nextFind = 1;
  #muted = false;
  #hasShownTrusted = false;
  #pendingGuest: any;
  /** What apps see of a frame. */
  #owner: WebContents = this;
  #frame: any;
  /** Where the frame is in the tree. */
  #place = "";
  #activation: object | undefined;

  /** `blank` makes the first document in the realm of the page that opened this one. */
  constructor(
    preferences: any = {},
    type = "window",
    blank?: { opener: any; createPage?: Function; frame?: any; isRelated?: boolean },
  ) {
    super();
    this.#preferences = preferences;
    this.#opener = blank?.opener ?? null;
    this.session =
      preferences.session ?? blank?.opener.webContents.session ?? sessions.fromPartition(preferences.partition);
    const state = (this[kPrivate] = {
      type,
      preferences,
      surface: this.#surface,
      /** The view that shows it, and the window of the view. */
      view: undefined as any,
      window: () => state.view?.window(),
      isVisible: () => !!state.window()?.isVisible() && state.view.isVisible(),
      entries: [] as Entry[],
      index: 0,
      sessionStorage: new Map<string, unknown>(),
      emulation: {},
      isGone: false,
      observers: new Set<any>(),
      /** The observers that want to know of requests. */
      network: undefined as any,
      page: () => this.#ensurePage(),
      pageAsItIs: () => this.#page,
      load: (url: string, navigation: Navigation) => this.#load(url, navigation),
      traverse: (index: number) => this.#traverse(index, true),
      history: {
        length: () => this.#joint().entries.length || 1,
        entries: () => this.#entriesForScripts(),
        activation: () => this.#activation,
        go: (delta: number, page: any) => this.#top().#traverseBy(delta, page),
        goTo: (key: string, fail: (name: string) => void) => this.#traverseTo(key, fail),
      },
      contents: this,
      dictionaryChanged: () => this.#page?.controller?.dictionaryChanged(),
      environmentChanged: () => (state.guest ?? this.#page?.controller)?.environmentChanged(),
      input: (event: object) => this.#handleNative({ s: this.#surface, ...event }),
      /** The page, if it is in the web engine. */
      guest: undefined as any,
      /** The arguments of the setters, for a guest to come. */
      settings: new Map<string, unknown[]>(),
      startGuest: () => state.guest ?? (this.#isForGuest() ? this.#newGuest().commit() : undefined),
      staysInGuest: () => !this.#hasShownTrusted && this.#isForGuest(),
      isForGuest: (url: string) => this.#isForGuest(url),
      leavePage: () => {
        this.#page.dispose();
        this.#page = this.#newPage("about:blank", { isInitial: true });
      },
      size: () => this.#size,
      beforeInput: this.#callbacks.beforeInput,
      open: (opener: any, details: any) => this.#openGuest(opener, details),
      navigateFrom: (page: any, url: string, frame: any) =>
        this.#callbacks.navigate(page, url, {}, { handle: frame, origin: frame?.origin ?? "null" }),
      navigate: (url: string, options: object, initiator: any) =>
        this.#callbacks.navigate(this.#page, url, options, initiator),
      reload: () => {
        const page = this.#page;
        const isAllowed = ["will-frame-navigate", "will-navigate"].every(name =>
          this.#emitNavigation(name, page.url, false, page),
        );
        if (isAllowed) this.#reload(true);
      },
      stop: () => this.stop(),
      close: () => this.close(),
      destroy: () => this.destroy(),
      focus: () => state.window()?.focus(),
      context: undefined as any,
      container: undefined as any,
      takeOver: (url: string, frame: any, history: string | number = "push") => {
        if (!this.#hasShownTrusted || !this.#isTrusted(url)) return false;
        const { guest } = state;
        const initiator = { handle: frame, origin: frame?.origin ?? "null" };
        const load = () => state.guest === guest && !this.#pending && this.#load(url, { history, initiator });
        Promise.resolve(guest?.fetchCookies())
          .then(load as any)
          .catch(() => {});
        return true;
      },
    });
    this.navigationHistory = new NavigationHistory(state);
    const { opener, frame, isRelated } = blank ?? {};
    state.context = new Context(state, frame ? opener.context : null, frame || isRelated ? opener.context : null);
    if (frame) this.#embed(opener, frame);
    else if (isRelated) state.context.opener = opener.context;
    native.send("surface.create", { id: this.#surface, width: 800, height: 600 });
    surfaces.set(this.#surface, event => this.#handleNative(event));
    const creator = frame || isRelated ? opener : undefined;
    this.#page = this.#newPage("about:blank", { isInitial: true, creator, referrer: creator?.url });
    state.context.committed(this.#page);
    if (frame) return;
    if (blank?.createPage) this.#page.adopt(blank.opener, blank.createPage);
    if (type === "print") return;
    all.$set(this.id, this);
    app.emit("web-contents-created", new Event(), this);
  }

  #embed(parent: any, frame: any) {
    const owner: WebContents = (this.#owner = parent.webContents);
    const [state, outer, { element }] = [this[kPrivate], owner[kPrivate], frame];
    this.#frame = frame;
    this.#opener = null;
    this.emit = (name: string, ...args: unknown[]) => ofFrames.test(name) && owner.emit(name, ...args);
    state.context.name = element.name;
    const above: WebContents = parent.context.state.contents;
    this.#place = `${above.#place}/${above.#item()?.sequence}:${parent.framesCreated++}`;
    const { window, sessionStorage, emulation } = outer;
    Object.assign(state, {
      window,
      sessionStorage,
      emulation: { __proto__: emulation, focused: false },
      isVisible: outer.isVisible,
      isShown: false,
      focus: element.focus,
      container: {
        __proto__: element,
        element,
        surface: outer.surface,
        painted: (scale: number, rect?: object) => frame.painted(scale, rect),
      },
    });
  }

  /** What the next document is allowed. */
  #sandbox(headers: [string, string][]) {
    const { context } = this[kPrivate];
    const all: Set<string>[] = [];
    const parse = (text: string) => all.push(new Set(text.toLowerCase().split(/[\t\n\f\r ]+/)));
    const inherited = context.parent?.page.sandbox ?? this.#openerSandbox;
    const attribute = this.#frame?.element.kind === "iframe" ? this.#frame.element.attribute("sandbox") : null;
    if (inherited) all.push(inherited);
    if (attribute != null) parse(attribute);
    for (const [name, value] of headers) {
      const directive = sandboxDirective.exec(value);
      if (directive && name.toLowerCase() === "content-security-policy") parse(directive[1]);
    }
    return all.length === 0 ? undefined : all.reduce((a, b) => a.intersection(b));
  }

  get #openerSandbox() {
    const sandbox = this.#opener?.sandbox;
    return sandbox?.has("allow-popups-to-escape-sandbox") ? undefined : sandbox;
  }

  #newPage(url: string, options: any) {
    options.sandbox = this.#sandbox(options.headers ?? []);
    const page = new Page(this.#owner, this.#callbacks, url, options);
    page.handle = new WebFrameMain(page);
    page.handle.name = page.context.name;
    return page;
  }

  /** The empty document costs nothing until something looks at it. */
  #ensurePage() {
    if (!this.#page.controller) this.#show(this.#page, "");
    return this.#page;
  }

  #show(page: any, html: string, xmlType?: string) {
    if (!page.controller) page.start();
    if (page.isInitial && page.agent) {
      this.#frame?.element.measure();
      if (this.#size) page.controller.handleEvent({ ...this.#size, isQuiet: true });
      this.#notify("documentCreated", page);
      return page.controller.parseHTML("");
    }
    if (this.#size) page.controller.handleEvent(this.#size);
    if (focused === this || this[kPrivate].emulation.focused || this.#frame?.element.isFocused())
      page.controller.handleEvent({ t: "focus", s: this.#surface });
    this.#notify("documentCreated", page);
    if (xmlType === undefined) page.controller.loadHTML(html);
    else page.controller.loadXML(html, xmlType);
  }

  #notify(name: string, ...args: unknown[]) {
    let answer;
    for (const observer of Array.from<any>(this[kPrivate].observers)) answer ??= observer[name]?.(...args);
    return answer;
  }

  #handleNative(event: any) {
    switch (event.t) {
      case "resize":
        this.#size = event;
        break;
      case "focus":
        focused = this;
        this.emit("focus");
        break;
      case "blur":
        if (focused === this) focused = null;
        this.emit("blur");
        if (this[kPrivate].emulation.focused) return;
        break;
      case "mouse":
      case "wheel": {
        const eventB = event.b;
        if (eventB === 3 || eventB === 4) {
          if (event.e === "up")
            this[kPrivate]
              .window()
              ?.emit("app-command", new Event(), eventB === 3 ? "browser-backward" : "browser-forward");
          break;
        }
        if (this.listenerCount("before-mouse-event") + this.listenerCount("input-event") === 0) break;
        const type = event.t === "wheel" ? "mouseWheel" : inputTypes[event.e];
        const modifiers = modifierNames(event.m);
        const before = new Event();
        const { x, y, sx: globalX, sy: globalY, n: clickCount } = event;
        const button = ["left", "middle", "right"][event.b] ?? "none";
        this.emit("before-mouse-event", before, { type, modifiers, x, y, globalX, globalY, clickCount, button });
        if (before.defaultPrevented) return;
        this.emit("input-event", new Event(), { type, modifiers });
      }
    }
    if (event.t === "resize") this.#pendingGuest?.handleEvent(event);
    if (!this.#destroyed) (this[kPrivate].guest ?? this.#page.controller)?.handleEvent(event);
  }

  #emitForFrame(name: string, page: any, ...args: unknown[]) {
    this.emit(name, new Event(), ...args, !this.#frame, this.#owner.id, page.id);
  }

  /** False if a listener prevented the default. */
  #emitNavigation(name: string, url: string, isSameDocument: boolean, initiator: any) {
    const frame = this.mainFrame;
    const event = new Event({ url, isSameDocument, isMainFrame: !this.#frame, frame, initiator: initiator?.handle });
    this.emit(name, event, url, isSameDocument, !this.#frame, frame.processId, frame.routingId);
    return !event.defaultPrevented;
  }

  #setLoading(loading: boolean) {
    if (loading === this.#loading) return;
    this.#loading = loading;
    if (loading) this.#frame?.element.loading();
    else this.#frame?.element.loaded(this.#firesLoad);
    this.#firesLoad = false;
    this.emit(loading ? "did-start-loading" : "did-stop-loading");
  }

  #firesLoad = false;

  #canFallBack() {
    return this.#frame?.element.kind === "object" && this.#page.isInitial;
  }

  #fail(url: string, error: any) {
    if (this.#frame && error.code !== "ERR_ABORTED" && !this.#canFallBack()) {
      this.#pending = { controller: new AbortController(), url };
      this.#commit({ url: "chrome-error://chromewebdata/", headers: [], status: 200 }, { history: "replace" }, "");
    }
    const settle = this.#settle;
    this.#settle = undefined;
    const { code, errno } = error;
    this.#emitForFrame("did-fail-provisional-load", this.#page, errno, code, url);
    if (code !== "ERR_ABORTED") this.#emitForFrame("did-fail-load", this.#page, errno, code, url);
    settle?.reject(Object.assign(new Error(`${code} (${errno}) loading '${url}'`), { errno, code, url }));
  }

  #cancelPending() {
    if (this.#pendingGuest !== this[kPrivate].guest) this.#pendingGuest?.destroy();
    this.#pendingGuest = undefined;
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = undefined;
    pending.controller.abort();
    this.#fail(pending.url, loader.netError("ABORTED"));
  }

  #top(): WebContents {
    return this.#frame ? this.#owner.#top() : this;
  }

  /** The session history of the window and its frames. */
  #joint(): { entries: Entry[]; index: number } {
    return this.#top()[kPrivate];
  }

  #itemIn(entry: Entry | undefined) {
    if (this.#frame) return entry?.frames?.$get(this.#place);
    if (entry) entry.item ??= nextItem++;
    return entry;
  }

  #item() {
    const { entries, index } = this.#joint();
    return this.#itemIn(entries[index]);
  }

  #items(): Entry[] {
    return this.#joint().entries.flatMap(entry => this.#itemIn(entry) ?? []);
  }

  #framesInProcess(): WebContents[] {
    return this[kPrivate].context.children().map(context => context.state.contents);
  }

  #commitEntry(
    url: string,
    history: string,
    state: any = { key: crypto.randomUUID(), id: crypto.randomUUID() },
    about?: object,
  ) {
    const [joint, page, before] = [this.#joint(), this.#page, this.#item()];
    const { sequence, request } = before ?? {};
    const entry = {
      url,
      title: page.title,
      state,
      document: page.id,
      origin: page.originKey,
      sequence,
      request,
      ...about,
    };
    if (before && history !== "push") {
      for (const it of this.#items()) if (it.item === before.item) Object.assign(it, entry);
      return;
    }
    const item = { ...entry, item: nextItem++ };
    const current = joint.entries[joint.index];
    if (!before && this.#frame) {
      for (const it of joint.entries) (it.frames ??= new Map()).$set(this.#place, item);
    } else if (!before) joint.entries[joint.index] = item;
    else {
      const frames = new Map(current.frames);
      joint.entries.splice(
        ++joint.index,
        Infinity,
        this.#frame ? { ...current, frames: frames.$set(this.#place, item) } : { ...item, frames },
      );
      this.#top().#tellOthersOfPruning(this);
      if (joint.entries.length <= MAX_ENTRIES) return;
      joint.entries.shift();
      joint.index--;
      queueTask(() => page.disposed || this.#top().#tellOthersOfPruning());
    }
  }

  #tellOthersOfPruning(except?: WebContents) {
    if (this !== except) this.#page.controller?.keepEntries(this.#items().map(it => it.state?.key));
    for (const frame of this.#framesInProcess()) frame.#tellOthersOfPruning(except);
  }

  #commitDocument(
    url: string,
    { history, navigationState, method, body, headers, srcdoc, referrer, referrerPolicy, markup, creator }: Navigation,
  ) {
    const [page, joint, before] = [this.#page, this.#joint(), this.#item()];
    const isRepeated = typeof history === "number" || history === "reload";
    if (typeof history === "number") joint.index = history;
    this.#top().#aim = undefined;
    const isSameOrigin = before?.origin === page.originKey;
    if (isRepeated && this.#item()) {
      const { sequence, item } = this.#item()!;
      for (const it of this.#items()) {
        if (it.item === item)
          Object.assign(it, {
            url,
            origin: page.originKey,
            state: it.state ?? { key: crypto.randomUUID(), id: crypto.randomUUID() },
          });
        if (it.item === item || (sequence && it.sequence === sequence)) it.document = page.id;
      }
    } else {
      const key = history !== "push" && isSameOrigin ? before!.state.key : crypto.randomUUID();
      const request =
        markup === undefined ? { method, body, headers, srcdoc, referrer, referrerPolicy, creator } : before?.request;
      this.#commitEntry(
        url,
        history as string,
        { key, id: crypto.randomUUID(), navigationState },
        { sequence: nextItem++, request },
      );
    }
    page.restoresScroll = isRepeated;
    this.#activation = {
      type: typeof history === "number" ? "traverse" : before || this.#frame ? history : "replace",
      from: isSameOrigin ? { ...before!.state, url: before!.url } : undefined,
      entry: { ...this.#item()!.state, url, isOfDocument: true },
    };
  }

  /** Those around the current one that are of the same origin. */
  #entriesForScripts() {
    const current = this.#item();
    if (!current || current.document !== this.#page.id) return;
    const all = this.#items().filter((it, i, items) => it.item !== items[i - 1]?.item);
    const at = all.findIndex(it => it.item === current.item);
    const from = all.findLastIndex((it, i) => i < at && it.origin !== current.origin) + 1;
    const to = all.findIndex((it, i) => i > at && it.origin !== current.origin);
    const describe = (it: Entry) => ({ ...it.state, url: it.url, isOfDocument: it.document === current.document });
    return { entries: all.slice(from, to < 0 ? all.length : to).map(describe), index: at - from };
  }

  #navigatedInPage(url: string) {
    const page = this.#page;
    page.url = url;
    this.#notify("navigatedWithinDocument", url);
    queueTask(() => {
      if (page.disposed) return;
      this.#emitNavigation("did-start-navigation", url, true, page);
      this.#emitForFrame("did-navigate-in-page", page, url);
    });
  }

  /** Where a traversal is going that has not arrived. The next one counts from there. */
  #aim: Entry | undefined;

  #traverseBy(delta: number, page: any) {
    const { entries, index } = this[kPrivate];
    const aim = entries[(entries.includes(this.#aim) ? entries.indexOf(this.#aim) : index) + delta];
    if (!aim) return;
    this.#aim = aim;
    queueTask(() => {
      if (!page.disposed) this.#traverse(entries.indexOf(aim), false);
      if (this.#aim === aim && !this.#hasPendingLoad()) this.#aim = undefined;
    });
  }

  #hasPendingLoad(): boolean {
    return this.#pending !== undefined || this.#framesInProcess().some(frame => frame.#hasPendingLoad());
  }

  #traverse(index: number, isByUser: boolean) {
    const entry = this[kPrivate].entries[index];
    if (!entry || this.#destroyed) return;
    const { guest } = this[kPrivate];
    if (entry.document === guest) return guest.tell("navigationHistory.goToIndex", entry.index);
    const changing = this.#changingFor(entry);
    if (changing.length === 0) {
      this[kPrivate].index = index;
      this.#cancelTraversals();
    }
    const goOn = () => {
      const next = changing.shift();
      if (next) next.#goTo(entry, index, isByUser, goOn);
    };
    goOn();
  }

  #cancelTraversals() {
    if (this.#pending?.isTraversal) this.stop();
    for (const frame of this.#framesInProcess()) frame.#cancelTraversals();
  }

  #changingFor(entry: Entry): WebContents[] {
    const target = this.#itemIn(entry);
    if (target && target.document !== this.#page.id) return [this];
    const below = this.#framesInProcess().flatMap(frame => frame.#changingFor(entry));
    return target && target.item !== this.#item()?.item ? [this, ...below] : below;
  }

  #goTo(entry: Entry, index: number, isByUser: boolean, goOn: () => void) {
    const [page, joint, target] = [this.#page, this.#joint(), this.#itemIn(entry)!];
    const proceed = () => {
      if (page.disposed || joint.entries[index] !== entry) return;
      if (target.document !== page.id)
        this.#load(target.url, { ...target.request, history: index, mayUnload: true }).catch(() => {});
      else {
        this.#cancelPending();
        joint.index = index;
        this.#navigatedInPage(target.url);
        page.controller.popState(target.url, target.state?.key);
      }
      goOn();
    };
    if (target.document !== page.id && !this.#mayUnload()) return;
    const { controller } = page;
    if (controller) controller.willTraverse(target.state?.key, isByUser, proceed);
    else proceed();
  }

  #traverseTo(key: string, fail: (name: string) => void) {
    const { entries, index } = this.#joint();
    const found = entries.flatMap((entry, i) => (this.#itemIn(entry)?.state?.key === key ? [i] : []));
    if (found.length === 0) return fail("InvalidStateError");
    const nearest = found[0] > index ? found[0] : found.at(-1)!;
    const isAllowed = (other: WebContents) => other[kPrivate].context.isNavigableBy(this.#page);
    if (!this.#top().#changingFor(entries[nearest]).every(isAllowed)) return fail("SecurityError");
    this.#top().#traverse(nearest, false);
  }

  #load(url: string, navigation: Navigation) {
    this.#cancelPending();
    this.#settle?.reject(
      Object.assign(new Error(`ERR_ABORTED (-3) loading '${url}'`), { errno: -3, code: "ERR_ABORTED", url }),
    );
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    this.#settle = { resolve, reject };
    const parsed = URL.parse(url);
    if (!parsed) {
      queueTask(() => this.#fail(url, loader.netError("INVALID_URL")));
      return promise;
    }
    const { href } = parsed;
    const { options } = navigation;
    if (this.#isForGuest(href) || (options?.webEngine && webEngine().isAvailable())) {
      this.#hasShownTrusted ||= options?.webEngine || isExcepted(href);
      this.#loadInGuest(href, navigation);
      return promise;
    }
    if (
      navigation.history === "push" &&
      href.includes("#") &&
      withoutHash(href) === withoutHash(this.#page.url) &&
      this.#page.controller
    ) {
      this.#commitEntry(href, "push");
      this.#navigatedInPage(href);
      this.#page.controller.popState(href, this.#item()!.state.key);
      this.#settle = undefined;
      queueTask(resolve);
      return promise;
    }
    if (!navigation.mayUnload && !this.#mayUnload()) {
      queueTask(() => this.#fail(href, loader.netError("ABORTED")));
      return promise;
    }
    navigation.mayUnload = true;
    const pending = (this.#pending = {
      controller: new AbortController(),
      url: href,
      isTraversal: typeof navigation.history === "number",
    });
    this.#setLoading(true);
    this.#emitNavigation("did-start-navigation", href, false, navigation.initiator);
    this.#fetchDocument(pending, navigation).catch(error => {
      if (
        !error?.message?.startsWith?.("net::ERR_") &&
        error?.name !== "AbortError" &&
        error?.stack?.includes("internal:desktop")
      )
        console.error(error);
      if (this.#pending !== pending) return;
      this.#pending = undefined;
      if (error?.needsWebEngine && webEngine().isAvailable()) {
        if (this.#frame) return this.#frame.element.useWebEngine(pending.url);
        this.#hasShownTrusted = true;
        this.#loading = false;
        this.#notServed = withoutHash(pending.url);
        return this.#loadInGuest(pending.url, navigation);
      }
      const { url } = pending;
      if (this.#isForGuest(url)) {
        this.#hasShownTrusted ||= isExcepted(url);
        this.#loading = false;
        return this.#loadInGuest(url, { ...navigation, body: undefined, headers: [] });
      }
      const page = this.#page;
      this.#top().#aim = undefined;
      if (!error?.hasNoDocument) page.controller?.abortNavigation();
      this.#fail(pending.url, loader.toNetError(error));
      if (!this.#pending && (this.#page === page || !this.#frame)) this.#setLoading(false);
    });
    return promise;
  }

  /** A document of an origin that the app serves, which the app does not have. */
  #notServed = "";

  /** A site that is trusted is just a site in a session of its own. */
  #isTrusted(url: string) {
    if (this.#frame) return isTrustedInFrame(url, app.getAppPath());
    if (this.#preferences.webEngine || !isTrusted(url, app.getAppPath()) || withoutHash(url) === this.#notServed)
      return false;
    return !isWeb.test(url) || this.session === sessions.defaultSession() || !webEngine().isAvailable();
  }

  /** Without `url`: the empty document, when something wants it. */
  #isForGuest(url = "about:blank") {
    if (this.#frame) return false;
    if (url !== "about:blank") return !this.#isTrusted(url) && webEngine().isAvailable();
    if (this[kPrivate].guest) return true;
    if (!this.#page.isInitial || this.#page.controller || this.#pending || this.#destroyed) return false;
    return (
      (this.#preferences.webEngine || this.session !== sessions.defaultSession() || !canEvaluate()) &&
      webEngine().isAvailable()
    );
  }

  #newGuest(history?: string | number, isOpenedByPage?: boolean) {
    return new (require("internal/desktop/webview/contents").Guest)(this, this[kPrivate], history, isOpenedByPage);
  }

  /** The page stays until there is something else to show. */
  #loadInGuest(url: string, navigation: Navigation) {
    const settle = this.#settle!;
    if (!navigation.mayUnload && !this.#mayUnload())
      return queueTask(() => this.#fail(url, loader.netError("ABORTED")));
    this.#settle = undefined;
    const isNew = !this[kPrivate].guest || typeof navigation.history === "number";
    const guest = isNew ? (this.#pendingGuest = this.#newGuest(navigation.history)) : this[kPrivate].guest;
    if (!this[kPrivate].guest && this.#page.isInitial) guest.commit();
    (typeof navigation.history === "number"
      ? guest.traverse(url, navigation, (it: string) => this.#isForGuest(it))
      : guest.load(url, navigation)
    )
      .finally(() => {
        if (this.#pendingGuest !== guest) return;
        this.#pendingGuest = undefined;
        if (this[kPrivate].guest !== guest) guest.destroy();
      })
      .then(settle.resolve, settle.reject);
  }

  #mayShow(url: string) {
    if (url === "about:blank" || this.#isTrusted(url)) return;
    if (!webEngine().isAvailable()) {
      process.emitWarning(
        `Refused to load ${url}: it is not trusted, and there is no web engine to sandbox it. See app.setWebEngine().`,
        "DesktopWarning",
      );
    }
    throw Object.assign(loader.netError("BLOCKED_BY_CLIENT"), {
      needsWebEngine: this.#frame?.element.kind === "iframe",
    });
  }

  async #fetchDocument(pending: { controller: AbortController; url: string }, navigation: Navigation) {
    const { initiator } = navigation;
    const { signal } = pending.controller;
    const { parent } = this.#page;
    const first = pending.url;
    let loaded: any = { url: pending.url, status: 200, statusText: "", headers: [["content-type", "text/html"]] };
    this.#mayShow(pending.url);
    const pendingUrl = pending.url;
    if (!pendingUrl.startsWith("about:") && navigation.markup === undefined) {
      loaded = await loader.load(this.session[sessions.kState], {
        ...navigation,
        url: pendingUrl,
        destination: this.#frame?.element.kind ?? "document",
        allows: (target: string, redirected: boolean) => {
          const redirectedFrom = redirected ? first : undefined;
          if (redirected && navigation.isForm && !initiator.csp.allowsFor("form-action", target, first)) return false;
          return parent?.allowsUrl(target, this.#frame.element.kind, { redirectedFrom }) ?? true;
        },
        ancestors: this.#page.ancestors(),
        upgradesInsecure:
          parent?.upgradesInsecure() ||
          (initiator?.upgradesInsecure?.() &&
            (navigation.isForm || new URL(initiator.url).host === new URL(first).host)),
        blocksAllMixed: true,
        referrerPolicy: navigation.referrerPolicy || loader.parseReferrerPolicy(initiator?.referrerPolicy),
        cache:
          navigation.history === "reload"
            ? "no-cache"
            : typeof navigation.history === "number"
              ? "force-cache"
              : undefined,
        mode: "navigate",
        credentials: "include",
        origin: initiator?.origin,
        userAgent: navigation.userAgent ?? this.#owner.getUserAgent(),
        frame: this.#page,
        signal,
        onRedirect: (_status: number, _method: string, url: string) => {
          if (!this.#emitNavigation("will-redirect", url, false, initiator)) return false;
          this.#mayShow((pending.url = url));
          this.#emitNavigation("did-redirect-navigation", url, false, initiator);
          return true;
        },
      });
    }
    const declared = loader.find(loaded.headers, "content-type") ?? "text/html";
    const type = mime.extract(declared)?.essence ?? "text/plain";
    const isAttachment = /^\s*attachment/i.test(loader.find(loaded.headers, "content-disposition") ?? "");
    const isPlugin = /^(?:object|embed)$/.test(this.#frame?.element.kind);
    if (this.#canFallBack() && loaded.status >= 400) throw loader.netError("ABORTED");
    if (isAttachment || !/^(?:text\/|image\/|application\/(?:xhtml|xml|json|javascript))/.test(type)) {
      if (!isPlugin) sessions.DownloadItem.start(this.session, loaded, new AbortController(), this);
      throw Object.assign(loader.netError("ABORTED"), { hasNoDocument: true });
    }
    if (loaded.status === 204 || loaded.status === 205)
      throw Object.assign(loader.netError("ABORTED"), { hasNoDocument: true });
    const xmlType = type.match(/^[^;]*[+/]xml\b/)?.[0];
    const isImage = type.startsWith("image/") && xmlType === undefined;
    if (isImage && isPlugin) {
      this.#frame.element.showImage(loaded.url);
      throw loader.netError("ABORTED");
    }
    const bytes = (!isImage && (await loaded.response?.bytes())) || new Uint8Array();
    loaded.encoding =
      mime.sniffBom(bytes) ??
      mime.encodingOf(mime.extract(declared)?.parameters.get("charset")) ??
      (xmlType === undefined ? mime.prescan(bytes) : mime.declaredInXml(bytes)) ??
      (xmlType === undefined && parent?.origin === originOf(loaded.url) ? parent.encodingOfFrames : undefined) ??
      (xmlType === undefined && isWeb.test(loaded.url) && !/json/.test(type) ? "windows-1252" : "utf-8");
    if (loaded.internal) {
      const { timingOf } = require("internal/desktop/electron/page_network");
      const how =
        typeof navigation.history === "number"
          ? "back_forward"
          : navigation.history === "reload"
            ? "reload"
            : "navigate";
      loaded.timingRecord = { ...timingOf(loaded.url, "navigation", loaded, bytes.length), type: how };
      if (initiator === parent)
        parent?.recordTiming({
          ...timingOf(
            first,
            this.#frame.element.kind,
            { ...loaded, tainting: originOf(loaded.url) === parent.origin ? "basic" : "opaque" },
            bytes.length,
          ),
        });
    }
    let html = isImage
      ? `<!doctype html><body style="margin:0"><img src="${Bun.escapeHTML(loaded.url)}">`
      : (navigation.markup ?? navigation.srcdoc ?? mime.decode(bytes, loaded.encoding));
    if (xmlType === undefined && !isImage && type !== "text/html")
      html = `<!doctype html><pre style="word-wrap:break-word;white-space:pre-wrap">\n${Bun.escapeHTML(html)}</pre>`;
    if (navigation.markup !== undefined) loaded.encoding = "utf-8";
    else loaded.essence = type;
    if (this.#pending !== pending) return;
    this.#commit(loaded, navigation, html, xmlType);
  }

  #takeFragmentDirective(loaded: any, { initiator, hasTextActivation }: Navigation) {
    const at = loaded.url.indexOf(":~:", loaded.url.indexOf("#") >>> 0);
    loaded.hasTextActivation = hasTextActivation;
    if (at < 0) return;
    const directives = loaded.url.slice(at + 3);
    loaded.url = loaded.url.slice(0, at).replace(/#$/, "");
    loaded.hasTextActivation = false;
    if (loaded.essence !== "text/html" && loaded.essence !== "text/plain") return;
    const isPrivate = () => initiator.origin === originOf(loaded.url) || this[kPrivate].context.members.size === 1;
    if (!initiator || (hasTextActivation && !this.#frame && isPrivate())) loaded.textDirectives = directives;
  }

  #commit(loaded: any, navigation: Navigation, html: string, xmlType?: string): any {
    this.#takeFragmentDirective(loaded, navigation);
    const options = {
      headers: loaded.headers,
      referrer: loaded.referrer ?? navigation.referrer,
      creator: navigation.creator ?? navigation.initiator,
      response: loaded,
      markup: navigation.markup,
    };
    if (navigation.markup !== undefined)
      options.referrer = this.#page.isInitial ? navigation.referrer : this.#page.referrer;
    let page = this.#newPage(loaded.url, options);
    if (!page.allowsEmbedder(loaded.headers)) {
      const blocked = { url: "chrome-error://chromewebdata/", status: 200, headers: [] };
      return this.#commit(blocked, { ...navigation, initiator: undefined, creator: undefined, markup: undefined }, "");
    }
    this.#pending = undefined;
    if (/^(?:about|blob|data):/.test(loaded.url)) {
      const { creator } = options;
      navigation.creator ??= creator?.bequest?.({
        originKey: creator.originKey,
        baseUrl: creator.controller?.document.baseURI,
      });
    }
    if (navigation.markup !== undefined)
      Object.assign(page, { origin: options.creator.origin, originKey: options.creator.originKey });
    if (!this.#page.isInitial) this.#willSwap(page, loaded, navigation.history);
    if (this.#page.renew(page, options)) page = this.#page;
    else this.#page.dispose();
    if (this.#destroyed) return;
    this[kPrivate].guest?.destroy();
    this.#hasShownTrusted = true;
    page.context.committed((this.#page = page));
    this.#commitDocument(loaded.url, navigation);
    this.emit("frame-created", new Event(), { frame: page.handle });
    const { status, statusText } =
      /^https?:/.test(loaded.url) || loaded.status !== 200 ? loaded : { status: 200, statusText: "OK" };
    this.#emitForFrame("did-frame-navigate", page, loaded.url, status, statusText);
    this.emit("did-navigate", new Event(), loaded.url, status, statusText);
    if (page.disposed) return;
    if (this.#preferences.focusOnNavigation !== false && this[kPrivate].window()?.isFocused()) this.focus();
    this.#frame?.element.measure();
    this.#show(page, html, xmlType);
  }

  #willSwap(next: any, { url, internal }: any, history: string | number) {
    const isTraversal = typeof history === "number";
    const known = isTraversal
      ? this.#itemIn(this.#joint().entries[history])
      : history === "reload"
        ? this.#item()
        : undefined;
    const isVisible = next.originKey === this.#page.originKey && !internal?.crossedOrigins;
    next.inboundTransition = this.#page.controller?.willSwap(
      isTraversal ? "traverse" : history,
      isVisible ? { ...known?.state, url } : undefined,
    );
  }

  #mayUnload() {
    if (this.#page.controller?.beforeUnload() !== false) return true;
    const event = new Event();
    this.emit("will-prevent-unload", event);
    return event.defaultPrevented;
  }

  #dispatch(page: any, name: string, event: any, channel: string, args: unknown[]) {
    sender = page;
    try {
      this.emit(name, event, channel, ...args);
      for (const ipc of [page.handle.ipc, this.ipc, ipcMain]) ipc.emit(channel, event, ...args);
    } finally {
      sender = undefined;
    }
  }

  #ipcEvent(page: any, more?: object) {
    return Object.defineProperty(
      new Event({ type: "frame", sender: this, frameId: page.id, processId: this.id, ...more }),
      "senderFrame",
      { get: () => (page.disposed && page !== sender ? null : page.handle), enumerable: true },
    );
  }

  #replier = (page: any) => ({
    reply: (channel: string, ...args: unknown[]) => page.handle.send(channel, ...args),
  });

  #openGuest(opener: any, details: any) {
    let guest;
    this.#owner.#openWindow(opener, details, webPreferences => {
      const opened = new WebContents({ ...webPreferences, session: this.session }, "window", { opener });
      guest = opened.#newGuest(undefined, true).commit();
      return opened;
    });
    return guest;
  }

  #open(opener: any, url: string, frameName: string, features: string, createPage: Function, options?: any) {
    if (opener.sandbox?.has("allow-popups") === false) return null;
    if (url.startsWith("file:") && opener.origin !== "file://") {
      opener.log("error", "Not allowed to load local resource");
      return null;
    }
    const referrer = { url: opener.url, policy: "strict-origin-when-cross-origin" };
    const { isPopup, noopener: isDetached, noreferrer } = mime.windowFeatures(features);
    const disposition = isPopup ? "new-window" : "foreground-tab";
    const href = url || "about:blank";
    const isScript = href.startsWith("javascript:");
    const isBlank = href === "about:blank" || isScript;
    const isShared = trustsFrames();
    const guest = this.#owner.#openWindow(
      opener,
      { url: href, frameName, features, disposition, referrer },
      webPreferences => {
        const opened = new WebContents(webPreferences, "window", {
          opener,
          createPage: isBlank && !isShared ? createPage : undefined,
          isRelated: isShared && !isDetached,
        });
        opened.mainFrame.name = opened[kPrivate].context.name = frameName;
        opened[kPrivate].context.isPopup = isPopup && !isDetached;
        const stored: any = !isDetached && this[kPrivate].sessionStorage.get(opener.origin);
        if (stored) opened[kPrivate].sessionStorage.set(opener.origin, stored.copy());
        return opened;
      },
      opened => {
        if (isBlank) {
          opened.#show(opened.#page, "");
          return void (isScript && isShared && opened.#page.controller.navigate(href, {}, opener));
        }
        if (!isDetached && opened.session === this.session && opened.#isForGuest(href)) {
          return void opened.#newGuest(undefined, true).commit();
        }
        const referrer = noreferrer ? undefined : opener.url;
        if (isShared)
          return opened[kPrivate].context.navigate(opener, href, {
            ...options,
            replace: true,
            referrer: referrer ?? "",
          });
        opened.#callbacks.navigate(opened.#page, href, { ...options, replace: true, referrer: referrer ?? "" }, opener);
      },
    );
    return isDetached ? null : guest;
  }

  #openWindow(
    opener: any,
    details: any,
    create: (preferences: object) => WebContents,
    start?: (it: WebContents) => void,
  ) {
    const { url, frameName, features, disposition, referrer } = details;
    const parsed: Record<string, any> = {};
    for (const feature of features.split(",")) {
      const [name, value = "yes"] = feature.split("=").map(part => part.trim());
      if (name)
        parsed[name] = /^-?\d+$/.test(value)
          ? +value
          : /^(?:yes|true)$/.test(value) || (/^(?:no|false)$/.test(value) ? false : value);
    }
    const answer = this.#openHandler ? this.#openHandler(details) : { action: "allow" };
    if (answer?.action !== "allow" || this.#destroyed) return null;

    const { left: x, top: y, width = 800, height = 600 } = mime.windowFeatures(features);
    const rest = Object.fromEntries(
      Object.entries(parsed).filter(([name, value]) => featuresOfWindow.test(name) && isOfItsKind(name, value)),
    );
    const { sandbox, contextIsolation, javascript, nodeIntegration } = this.#preferences;
    const override = answer.overrideBrowserWindowOptions ?? {};
    const webPreferences = { sandbox, contextIsolation, javascript, nodeIntegration, ...override.webPreferences };
    const guest = create(webPreferences);
    const size = { width: Math.min(Math.max(width, 100), 16384), height: Math.min(Math.max(height, 100), 16384) };
    const options = { show: true, ...size, x, y, ...rest, ...override, webPreferences, webContents: guest };
    let window;
    if (answer.createWindow) answer.createWindow(options);
    else window = new (require("internal/desktop/electron/views").BrowserWindow)(options);
    if (!answer.outlivesOpener) {
      const close = () => guest.close();
      opener.cleanups.add(close);
      guest.once("destroyed", () => opener.cleanups.delete(close));
    }
    start?.(guest);
    if (window) this.emit("did-create-window", window, { url, frameName, options, referrer, disposition });
    return guest;
  }

  #navigations = 0;

  /** What a page calls. */
  #callbacks = {
    send: (page: any, channel: string, args: unknown[], ports?: MessagePort[]) => {
      const more = ports && { ports: wrapPorts(ports) };
      if (!this.#destroyed)
        this.#dispatch(page, "ipc-message", this.#ipcEvent(page, { ...this.#replier(page), ...more }), channel, args);
    },
    sendSync: (page: any, channel: string, args: unknown[]) => {
      let answered = false;
      let result: unknown;
      let resume: (() => void) | undefined;
      const event = Object.defineProperty(this.#ipcEvent(page, this.#replier(page)), "returnValue", {
        get() {},
        set(value) {
          answered = true;
          result = value;
          resume?.();
        },
      });
      this.#dispatch(page, "ipc-message-sync", event, channel, args);
      if (answered) return result;
      if (
        [page.handle.ipc, this.ipc, ipcMain].some(ipc => ipc.listenerCount(channel) > 0) ||
        this.listenerCount("ipc-message-sync") > 0
      ) {
        const { promise, resolve } = Promise.withResolvers<void>();
        // All pages wait, so an answer that depends on one of them never comes.
        const timer = setTimeout((resume = resolve), 5000);
        Page.block(promise);
        clearTimeout(timer);
      }
      if (!answered) throw new Error(`event.returnValue of '${channel}' was not set`);
      return result;
    },
    invoke: async (page: any, channel: string, args: unknown[]) => {
      const target = [page.handle.ipc, this.ipc, ipcMain].find(ipc => ipc._invokeHandlers.has(channel));
      if (!target) throw new Error(`No handler registered for '${channel}'`);
      sender = page;
      try {
        return target._invokeHandlers.get(channel)(this.#ipcEvent(page), ...args);
      } finally {
        sender = undefined;
      }
    },
    navigate: (
      page: any,
      url: string,
      { replace, method, body, contentType, download, srcdoc, markup, referrer, ...more }: any,
      initiator = more.initiator ?? page,
    ) => {
      if (url.startsWith("blob:")) more.blob = loader.resolveBlob(url);
      if (
        download !== undefined &&
        (/^(?:blob|data):/.test(url) || (originOf(url) === initiator.origin && initiator.origin !== "null"))
      ) {
        return this.session.downloadURL(url, undefined, this, download || undefined);
      }
      const serial = ++this.#navigations;
      this.#frame?.element.navigating();
      this.#frame?.element.loading();
      queueTask(() => {
        start();
        if (!this.#loading && serial === this.#navigations) this.#frame?.element.loaded(false);
      });
      const start = () => {
        if (page.disposed || serial !== this.#navigations || this.#pending?.isTraversal) return;
        const [scheme] = url.split(":");
        if ((scheme === "data" && !this.#frame) || (scheme === "file" && initiator.origin !== "file://")) {
          return page.log("error", `Not allowed to navigate top frame to ${scheme} URL`);
        }
        if (!this.#emitNavigation("will-frame-navigate", url, false, initiator)) return;
        if (!this.#emitNavigation("will-navigate", url, false, initiator)) return;
        if (scheme === "javascript") return;
        if (!/^(?:https?|file|about|data|blob)$/.test(scheme) && !this.session.protocol.isProtocolHandled(scheme)) {
          return void page
            .requestPermission("openExternal", {
              externalURL: url,
              ...(initiator !== page && { isMainFrame: false, requestingUrl: initiator?.url ?? initiator?.origin }),
            })
            .then(state => state === "granted" && require("internal/desktop/system").api.shell.openExternal(url));
        }
        const restored = page.isInitial && this.#frame ? this.#item() : undefined;
        if (restored)
          return void this.#load(restored.url, { ...restored.request, history: this.#joint().index, initiator }).catch(
            () => {},
          );
        this.#load(url, {
          history: replace ? "replace" : "push",
          mayUnload: more.mayUnload || markup !== undefined,
          initiator,
          referrer: referrer ?? initiator.referrerUrl?.() ?? initiator.url,
          referrerPolicy: more.referrerPolicy,
          navigationState: structuredClone(more.navigationState),
          isForm: more.source === "form",
          isByUser: more.isByUser,
          hasTextActivation: more.hasTextActivation,
          blob: more.blob,
          srcdoc,
          markup,
          method,
          body: body && structuredClone(body),
          headers: contentType ? [["content-type", contentType]] : [],
        }).catch(() => {});
      };
    },
    createFrame: (page: any, element: object) =>
      new LocalFrame(
        page,
        element,
        frame => new WebContents(this.#preferences, "frame", { opener: page, frame })[kPrivate],
      ),
    historyChanged: (page: any, url: string, { replace, isQuiet, state }: any) => {
      state = structuredClone(state);
      if (isQuiet) {
        for (const entry of this.#items()) if (entry.state?.id === state.id) entry.state = state;
        return;
      }
      if (page !== this.#page) return;
      this.#commitEntry(url, replace ? "replace" : "push", state);
      this.#navigatedInPage(url);
      if (endsTrustedDocument(url))
        queueTask(() => this.#page.url === url && this.#load(url, { history: "replace" }).catch(() => {}));
    },
    opened: (page: any) => page === this.#page && this.#setLoading(true),
    mayUnload: () => this.#mayUnload(),
    cancelNavigation: () => {
      this.#navigations++;
      if (!this.#pending?.isTraversal) this.#cancelPending();
    },
    open: (page: any, url: string, target: string, features: string, createPage: Function, options?: object) =>
      this.#open(page, url, /^_blank$/i.test(target) ? "" : target, features, createPage, options),
    crashed: () => this.#crash("crashed"),
    titleChanged: (page: any, title: string) => {
      page.title = title;
      const entry = this.#item();
      if (entry) entry.title = title;
      queueTask(() => page.disposed || this.emit("page-title-updated", new Event(), this.getTitle(), title !== ""));
    },
    loaded: (page: any, stage: string) => {
      this.#notify("lifecycle", stage);
      queueTask(() => {
        if (page.disposed) return;
        if (stage === "dom-ready") {
          page.handle.emit("dom-ready");
          return void this.emit("dom-ready");
        }
        page.isLoaded = true;
        if (this.#pending) return;
        this.#firesLoad = true;
        const settle = this.#settle;
        this.#settle = undefined;
        this.#emitForFrame("did-frame-finish-load", page);
        this.emit("did-finish-load");
        if (!this.#pending) this.#setLoading(false);
        settle?.resolve();
      });
    },
    beforeInput: (event: any) => {
      if (this.#frame) return false;
      const type = event.e === "down" ? "keyDown" : "keyUp";
      const modifiers = modifierNames(event.m);
      const before = new Event();
      this.emit("before-input-event", before, {
        type,
        key: event.key,
        code: event.code,
        isAutoRepeat: !!event.repeat,
        isComposing: !!event.composing,
        shift: !!(event.m & 1),
        control: !!(event.m & 2),
        alt: !!(event.m & 4),
        meta: !!(event.m & 8),
        location: event.location,
        modifiers,
      });
      if (before.defaultPrevented) return true;
      this.emit("input-event", new Event(), { type: type === "keyDown" ? "rawKeyDown" : type, modifiers });
      return false;
    },
    console: (page: any, level: string, message: string, lineNumber: number, sourceId: string) => {
      const event = new Event({ message, level, lineNumber, sourceId, frame: page.handle });
      const number = ["debug", "info", "warning", "error"].indexOf(level);
      queueTask(() => this.emit("console-message", event, number, message, lineNumber, sourceId));
    },
    sessionStorage: (origin: string) => {
      const { sessionStorage } = this[kPrivate];
      if (!sessionStorage.has(origin)) sessionStorage.set(origin, new LocalStorage(null, origin));
      return sessionStorage.get(origin);
    },
    notify: (name: string, ...args: unknown[]) => this.#notify(name, ...args),
    state: () => this[kPrivate],
  };

  #check() {
    if (this.#destroyed) throw new TypeError("Object has been destroyed");
  }

  get mainFrame() {
    return this[kPrivate].guest?.mainFrame ?? this.#page.handle;
  }

  get focusedFrame() {
    const { guest } = this[kPrivate];
    return (
      (guest ? guest.focusedFrame : this.#page.controller?.focusedFrame?.()) ??
      (this.isFocused() ? this.mainFrame : null)
    );
  }

  get opener() {
    return this.#opener && !this.#opener.disposed ? this.#opener.handle : null;
  }

  get debugger() {
    return this[kPrivate].startGuest()?.debugger ?? (this.#debugger ??= new Debugger(this));
  }

  loadURL(url: string, options: any = {}) {
    this.#check();
    const headers = (options.extraHeaders ?? "")
      .split("\n")
      .map(line => /^([^:]+):\s*(.*?)\s*$/.exec(line)?.slice(1))
      .filter(Boolean);
    const body =
      options.postData && Buffer.concat(options.postData.map(part => part.bytes ?? fs.readFileSync(part.filePath)));
    const promise = this.#load(String(url), {
      history: url === this.#page.url ? "reload" : "push",
      headers,
      body,
      method: body ? "POST" : "GET",
      referrer: options.httpReferrer?.url ?? options.httpReferrer,
      userAgent: options.userAgent,
      options,
    });
    promise.catch(() => {});
    return promise;
  }

  loadFile(file: string, options: { query?: Record<string, string>; search?: string; hash?: string } = {}) {
    if (typeof file !== "string") throw new TypeError("Must pass filePath as a string");
    const url = Bun.pathToFileURL(path.resolve(app.getAppPath(), file));
    url.search = options.search ?? new URLSearchParams(options.query).toString();
    url.hash = options.hash ?? "";
    return this.loadURL(url.href);
  }

  reload() {
    this.#check();
    this.#reload();
  }

  #reload(mayUnload?: boolean) {
    if (!this.#page.isInitial)
      this.#load(this.#page.url, { ...this.#item()?.request, history: "reload", mayUnload }).catch(() => {});
  }

  reloadIgnoringCache() {
    this.reload();
  }

  stop() {
    this.#navigations++;
    this.#cancelPending();
    this.#setLoading(false);
  }

  downloadURL(url: string, options?: object) {
    this.session.downloadURL(url, options, this);
  }

  getURL() {
    this.#check();
    return this.mainFrame.url;
  }

  getTitle() {
    this.#check();
    const { title, url, isInitial } = this.#page;
    if (title || isInitial) return title;
    return url.startsWith("file:")
      ? decodeURIComponent(path.posix.basename(new URL(url).pathname))
      : url.replace(/^https?:\/\/|\/$/g, "");
  }

  getType() {
    return this[kPrivate].type;
  }

  isDestroyed() {
    return this.#destroyed;
  }

  isLoading() {
    this.#check();
    return this.#loading;
  }

  isLoadingMainFrame() {
    return this.isLoading();
  }

  isWaitingForResponse() {
    return this.#pending !== undefined;
  }

  close(options?: { waitForBeforeUnload?: boolean }) {
    if (options?.waitForBeforeUnload && this[kPrivate].guest) return this[kPrivate].guest.tell("close", options);
    if (this.#destroyed) return;
    if (options?.waitForBeforeUnload && !this.#mayUnload()) return closeCancelled();
    this.emit("close", new Event());
    this.destroy();
  }

  destroy() {
    if (this.#destroyed) return;
    this.#cancelPending();
    this.#settle?.reject(Object.assign(new Error("ERR_FAILED (-2) loading"), { errno: -2, code: "ERR_FAILED" }));
    this.#page.dispose();
    this.#destroyed = true;
    this[kPrivate].context.discard();
    this[kPrivate].guest?.destroy();
    this.#debugger?.detach();
    this.#notify("destroyed");
    if (focused === this) focused = null;
    all.$delete(this.id);
    this[kPrivate].view?.release();
    surfaces.delete(this.#surface);
    native.destroySurface(this.#surface);
    try {
      this.emit("destroyed", new Event());
    } finally {
      this[kPrivate].isGone = true;
    }
  }

  forcefullyCrashRenderer() {
    this.#crash("killed");
  }

  #crash(reason: string) {
    this.#page.dispose();
    this.#page = this.#newPage(this.#page.url, {});
    const details = { reason, exitCode: 2 };
    this.emit("render-process-gone", new Event(), details);
    app.emit("render-process-gone", new Event(), this, details);
  }

  focus() {
    this.#check();
    native.send("surface.focus", { id: this.#surface });
  }

  isFocused() {
    return focused === this;
  }

  send(channel: string, ...args: unknown[]) {
    this.#check();
    this.mainFrame.send(channel, ...args);
  }

  sendToFrame(frameId: number | [number, number], channel: string, ...args: unknown[]) {
    if ([frameId].flat().at(-1) !== this.#page.id) return false;
    this.send(channel, ...args);
    return true;
  }

  postMessage(channel: string, message: unknown, transfer?: unknown[]) {
    this.#check();
    this.mainFrame.postMessage(channel, message, transfer);
  }

  async #whenLoaded() {
    this.#check();
    if (this.#loading || this.getURL() === "") await EventEmitter.once(this, "did-stop-loading");
    return this.#ensurePage();
  }

  async executeJavaScript(code: string) {
    return (await this.#whenLoaded()).executeJavaScript(0, String(code));
  }

  async executeJavaScriptInIsolatedWorld(world: number, scripts: { code: string }[]) {
    return (await this.#whenLoaded()).executeJavaScript(world, scripts.map(script => script.code).join(";\n"));
  }

  async insertCSS(css: string) {
    this.#check();
    return this.#ensurePage().controller.insertCSS(String(css));
  }

  async removeInsertedCSS(key: string) {
    this.#page.controller?.removeInsertedCSS(key);
  }

  async insertText(text: string) {
    this.#page.controller?.insertText(String(text));
  }

  replace(text: string) {
    this.insertText(text);
  }

  replaceMisspelling(text: string) {
    this.insertText(text);
  }

  setWindowOpenHandler(handler: Function | null) {
    this.#openHandler = handler;
  }

  getUserAgent() {
    return this.#userAgent ?? this.session.getUserAgent();
  }

  setUserAgent(userAgent: string) {
    this.#userAgent = userAgent;
  }

  #zoomKey = () => new URL(this.#page.url).host || withoutHash(this.#page.url);

  getZoomLevel(): number {
    const shared = this.session[sessions.kState].zoomLevels.get(this.#zoomKey());
    return this.#ownZoom ?? shared ?? toLevel(this.#preferences.zoomFactor ?? 1);
  }

  setZoomLevel(level: number) {
    this.#check();
    if (this.#zoomMode === "disabled") return;
    if (this.#zoomMode !== "default") this.#ownZoom = level;
    else this.session[sessions.kState].zoomLevels.set(this.#zoomKey(), level);
    for (const other of all.values()) if (other.session === this.session) other[kPrivate].environmentChanged();
  }

  getZoomFactor() {
    return +(1.2 ** this.getZoomLevel()).toPrecision(12);
  }

  setZoomFactor(factor: number) {
    if (!(factor > 0)) throw new Error("'zoomFactor' must be a double greater than 0.0");
    this.setZoomLevel(toLevel(factor));
  }

  getZoomMode() {
    return this.#zoomMode;
  }

  setZoomMode(mode: string) {
    this.#ownZoom = mode === "default" ? undefined : mode === "disabled" ? 0 : this.getZoomLevel();
    this.#zoomMode = mode;
    this[kPrivate].environmentChanged();
  }

  findInPage(text: string, options: object = {}) {
    if (!text) throw new Error("Must provide non-empty search content");
    const requestId = this.#nextFind++;
    queueTask(() => {
      if (this.#destroyed) return;
      const { matches, active, rect } = this.#ensurePage().controller.find(text, options);
      const selectionArea = { x: 0, y: 0, width: 0, height: 0, ...rect };
      this.emit("found-in-page", new Event(), {
        requestId,
        activeMatchOrdinal: active,
        matches,
        selectionArea,
        finalUpdate: true,
      });
    });
    return requestId;
  }

  stopFindInPage(action: string) {
    this.#page.controller?.stopFind(action);
  }

  async capturePage(rect?: object) {
    this.#check();
    // The caller may be inside a frame that has yet to be painted.
    await new Promise(setImmediate);
    this.#check();
    this.#ensurePage().controller.handleEvent({
      t: "frame",
      s: this.#surface,
      time: performance.now(),
      isUrgent: true,
    });
    const { blob } = native.ask("surface.capture", { id: this.#surface, rect, format: "png" });
    return require("internal/desktop/system").api.nativeImage.createFromBuffer(native.takeBlob(blob));
  }

  showDefinitionForSelection() {
    const [window, value] = [this.getOwnerBrowserWindow(), this.#page.controller?.selectionText()];
    if (process.platform === "darwin" && window && value) native.send("window.lookUp", { id: window.id, value });
  }

  copyImageAt(x: number, y: number) {
    const page = this.#page;
    const url = page.controller?.hitInfo(x, y).srcURL;
    if (!url) return;
    page.fetchResource(url, "image").then(
      ({ bytes }) => require("internal/desktop/system").api.clipboard.writeImage(bytes),
      () => {},
    );
  }

  sendInputEvent(event: any) {
    this.#check();
    const names = (event.modifiers ?? []).map(name => name.toLowerCase());
    const has = (...any: string[]) => +any.some(name => names.includes(name));
    const m = has("shift") | (has("control", "ctrl") << 1) | (has("alt") << 2) | (has("meta", "command", "cmd") << 3);
    const { input } = this[kPrivate];
    const { type, x, y, globalX: sx = x, globalY: sy = y } = event;
    if (!this[kPrivate].guest) this.#ensurePage();
    if (type === "char") return input({ t: "text", text: event.keyCode, key: false });
    if (type === "mouseWheel") {
      return input({
        t: "wheel",
        x,
        y,
        sx,
        sy,
        dx: -(event.deltaX ?? 0),
        dy: -(event.deltaY ?? 0),
        precise: true,
        phase: "move",
        m,
      });
    }
    if (type.startsWith("mouse")) {
      const b = Math.max(["left", "middle", "right"].indexOf(event.button), 0);
      const held = has("leftbuttondown") | (has("rightbuttondown") << 1) | (has("middlebuttondown") << 2);
      const e = pointerPhases[type] ?? "move";
      return input({
        t: "mouse",
        e,
        x,
        y,
        sx,
        sy,
        b,
        buttons: e === "down" ? held | [1, 4, 2][b] : held,
        n: event.clickCount ?? 1,
        m,
      });
    }
    const [name] = accelerator.parse(event.keyCode);
    const { key, code } = require("internal/desktop/electron/devtools").describeKey(name, !!(m & 1));
    input({
      t: "key",
      e: type === "keyUp" ? "up" : "down",
      key,
      code,
      location: 0,
      repeat: !!has("isautorepeat"),
      m,
      composing: false,
    });
  }

  invalidate() {
    native.requestFrame(this.#surface);
  }

  isAudioMuted() {
    return this.#muted;
  }

  setAudioMuted(muted: boolean) {
    this.#muted = !!muted;
  }

  getOSProcessId() {
    return process.pid;
  }

  getProcessId() {
    return this.id;
  }

  getOwnerBrowserWindow() {
    return this[kPrivate].window() ?? null;
  }

  getLastWebPreferences() {
    const { session: _, ...rest } = this.#preferences;
    return { contextIsolation: true, nodeIntegration: false, sandbox: true, ...rest };
  }

  getOrCreateDevToolsTargetId() {
    return require("internal/desktop/electron/devtools").targetIdOf(this);
  }
}

for (const name of ["undo", "redo", "cut", "copy", "paste", "pasteAndMatchStyle", "delete", "selectAll", "unselect"]) {
  WebContents.prototype[name] = function () {
    if (!this.isDestroyed()) this[kPrivate].page().controller.edit(name);
  };
}
for (const name of ["canGoBack", "canGoForward", "canGoToOffset", "goBack", "goForward", "goToIndex", "goToOffset"]) {
  WebContents.prototype[name] = function (argument: number) {
    return this.navigationHistory[name](argument);
  };
}
inert(WebContents.prototype, {
  addWorkSpace: undefined,
  adjustSelection: undefined,
  beginFrameSubscription: unsupported.throws("beginFrameSubscription"),
  centerSelection: undefined,
  clearHistory(this: WebContents) {
    this.navigationHistory.clear();
  },
  closeDevTools: undefined,
  disableDeviceEmulation: undefined,
  enableDeviceEmulation: undefined,
  endFrameSubscription: undefined,
  getAllSharedWorkers: () => [],
  getBackgroundThrottling: false,
  getFrameRate: 60,
  getMediaSourceId(this: WebContents) {
    return `web-contents-media-stream://${this.id}:1`;
  },
  getPrintersAsync: async () => [],
  getWebRTCIPHandlingPolicy: "default",
  inspectElement: undefined,
  isBeingCaptured: false,
  isCaretBrowsingEnabled: false,
  isCrashed: false,
  isCurrentlyAudible: false,
  isDevToolsFocused: false,
  isDevToolsOpened: false,
  isOffscreen: false,
  isPainting: false,
  openDevTools: () => process.emitWarning(unsupported.error("openDevTools").message, "DesktopWarning"),
  print: (_: unknown, callback?: Function) => callback?.(false, unsupported.error("print").message),
  printToPDF: unsupported.rejects("printToPDF"),
  removeWorkSpace: undefined,
  savePage: unsupported.rejects("savePage"),
  setBackgroundThrottling: undefined,
  setCaretBrowsingEnabled: undefined,
  setFrameRate: undefined,
  setIgnoreMenuShortcuts(this: WebContents, ignore: boolean) {
    this[kPrivate].ignoresMenuShortcuts = ignore;
  },
  setImageAnimationPolicy: undefined,
  setVisualZoomLevelLimits: async () => {},
  setWebRTCIPHandlingPolicy: undefined,
  setWebRTCUDPPortRange: undefined,
  startDrag: unsupported.throws("startDrag"),
  takeHeapSnapshot: async (file: string) => void require("node:v8").writeHeapSnapshot(file, undefined),
  toggleDevTools: undefined,
});
require("internal/desktop/webview/routes").install(WebContents.prototype, kPrivate);
properties(WebContents.prototype, {
  audioMuted: ["isAudioMuted", "setAudioMuted"],
  backgroundThrottling: ["getBackgroundThrottling", "setBackgroundThrottling"],
  frameRate: ["getFrameRate", "setFrameRate"],
  userAgent: ["getUserAgent", "setUserAgent"],
  zoomFactor: ["getZoomFactor", "setZoomFactor"],
  zoomLevel: ["getZoomLevel", "setZoomLevel"],
  zoomMode: ["getZoomMode", "setZoomMode"],
});

const frames = () => [...all.values()].flatMap(webContents => webContents.mainFrame.framesInSubtree);

export default {
  WebContents,
  kPrivate,
  pageOf: (webContents: WebContents) => webContents[kPrivate].pageAsItIs(),
  webContents: {
    create: (preferences?: object) => new WebContents(preferences, "remote"),
    fromId: (id: number) => all.$get(id),
    fromFrame: (frame: WebFrameMain) => [...all.values()].find(it => it.mainFrame === frame.top),
    fromDevToolsTargetId: (id: string) => [...all.values()].find(it => it.getOrCreateDevToolsTargetId() === id),
    getAllWebContents: () => [...all.values()],
    getFocusedWebContents: () => focused,
  },
  webFrameMain: {
    fromId: (processId: number, routingId: number) =>
      frames().find(frame => frame.processId === processId && frame.routingId === routingId),
    fromFrameToken: (processId: number, token: string) =>
      frames().find(frame => frame.processId === processId && frame.frameToken === token) ?? null,
  },
};
