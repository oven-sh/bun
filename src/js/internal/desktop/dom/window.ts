const core = require("internal/desktop/dom/core");
const engine = require("internal/desktop/dom/engine");
const events = require("internal/desktop/dom/events");
const nodes = require("internal/desktop/dom/node");
const { windowProperties } = require("internal/desktop/dom/exotic");
const cssom = require("internal/desktop/dom/cssom");
const html = require("internal/desktop/dom/html");
const loader = require("internal/desktop/dom/loader");
const { DOMRect } = require("internal/desktop/dom/geometry");
const { wrapSelection } = require("internal/desktop/dom/range");
const { Clipboard } = require("internal/desktop/dom/transfer");

const { domError, expose, realm, splitTokens, wrap } = core;
const { EventTarget } = events;

type N = $Dom.N;
type Page = $Dom.Page;

/** Without a receiver, it is the page of the global object. */
function pageOf(self: any): Page {
  return self == null ? realm.page : (self.$impl?.x ?? realm.page);
}

function viewOf(self: any): Page {
  if (self != null && self !== globalThis) core.brand(self);
  return pageOf(self);
}

function same<T>(self: unknown, key: string, make: (page: Page) => T): T {
  const page = pageOf(self);
  let value = page.same.$get(key);
  if (value === undefined) page.same.$set(key, (value = make(page)));
  return value;
}

class MediaQueryList extends EventTarget {
  #page: Page;
  #media: string;

  constructor(page: Page | null = null, media = "") {
    if (page?.watchedQueries === undefined) core.illegalConstructor();
    super();
    this.#page = this.$impl.x = page!;
    this.#media = media;
  }
  get media() {
    return this.#media;
  }
  get matches() {
    const { doc } = this.#page;
    doc.container?.measure();
    return doc.engine.matchMedia(this.#media);
  }
  #watch() {
    if (!this.#page.watchedQueries.$has(this)) this.#page.watchedQueries.$set(this, this.matches);
  }
  addEventListener(type: string, callback: any, options?: any) {
    this.#watch();
    super.addEventListener(type, callback, options);
  }
  removeEventListener(type: string, callback: any, options?: any) {
    super.removeEventListener(type, callback, options);
    if (this.$impl.listeners === null) this.#page.watchedQueries.$delete(this);
  }
  addListener(callback: any) {
    if ($argumentCount() < 1) core.tooFew(1);
    this.addEventListener("change", callback);
  }
  removeListener(callback: any) {
    if ($argumentCount() < 1) core.tooFew(1);
    this.removeEventListener("change", callback);
  }
  get onchange() {
    return events.readHandler(this.$impl, "change");
  }
  set onchange(callback) {
    this.#watch();
    events.writeHandler(this.$impl, "change", callback);
  }
}

type Store = {
  keys(): Iterable<string>;
  get(key: string): string | null | undefined;
  /** False if it does not fit. */
  set(key: string, value: string): unknown;
  remove(key: string): void;
  clear(): void;
};

function put(store: Store, key: string, value: string) {
  if (store.set(key, value) !== false) return;
  const message = `Setting the value of '${key}' exceeded the quota.`;
  throw realm.page.host.error?.("QuotaExceededError", message) ?? core.domError("QuotaExceededError", message);
}

function keysOf(store: Store): string[] {
  const keys = store.keys();
  return $isArray(keys) ? keys : Array.from(keys);
}

class Storage {
  declare $impl: Store;

  constructor() {
    core.illegalConstructor();
  }
  get length() {
    return keysOf(this.$impl).length;
  }
  key(index: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    return keysOf(this.$impl)[index >>> 0] ?? null;
  }
  getItem(key: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this.$impl.get(`${key}`) ?? null;
  }
  setItem(key: string, value: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    put(this.$impl, `${key}`, `${value}`);
  }
  removeItem(key: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    this.$impl.remove(`${key}`);
  }
  clear() {
    this.$impl.clear();
  }
}

function createStorage(page: Page, kind: string) {
  const memory = new Map<string, string>();
  const given = page.host.storage?.(kind);
  if (given === null) throw core.domError("SecurityError", "Access is denied for this document.");
  const store: Store = given ?? Object.assign(memory, { remove: memory.delete });
  const read = (target: object, key: string | symbol) =>
    typeof key === "string" && !(key in target) ? (store.get(key) ?? undefined) : undefined;
  const storage: any = new Proxy(Object.create(Storage.prototype), {
    get: (target, key, receiver) => read(target, key) ?? Reflect.get(target, key, receiver),
    has: (target, key) => key in target || read(target, key) !== undefined,
    set(target, key, value, receiver) {
      if (typeof key !== "string" || receiver !== storage) return Reflect.set(target, key, value, receiver);
      put(store, key, `${value}`);
      return true;
    },
    defineProperty(target, key, descriptor) {
      if (typeof key !== "string") return Reflect.defineProperty(target, key, descriptor);
      if (!("value" in descriptor || "writable" in descriptor) || descriptor.configurable === false) return false;
      put(store, key, `${descriptor.value}`);
      return true;
    },
    deleteProperty(target, key) {
      if (typeof key !== "string") return Reflect.deleteProperty(target, key);
      if (!(key in target)) store.remove(key);
      return true;
    },
    preventExtensions: () => false,
    ownKeys: target => [...Array.from(store.keys()).filter(key => !(key in target)), ...Reflect.ownKeys(target)],
    getOwnPropertyDescriptor(target, key) {
      if (typeof key !== "string") return Reflect.getOwnPropertyDescriptor(target, key);
      const value = read(target, key);
      return value == null ? undefined : { value, writable: true, enumerable: true, configurable: true };
    },
  });
  $putByIdDirectPrivate(storage, "impl", store);
  return storage;
}

class ScreenOrientation extends EventTarget {
  get type() {
    return "landscape-primary";
  }
  get angle() {
    return 0;
  }
  async lock() {
    if ($argumentCount() < 1) core.tooFew(1);
    throw domError("NotSupportedError", "screen.orientation.lock() is not available on this device.");
  }
  unlock() {}
}
events.defineHandlers(ScreenOrientation.prototype, ["change"]);

class Screen extends EventTarget {
  #page: Page;
  #orientation = new ScreenOrientation();

  constructor(page: Page | null = null) {
    if (page?.watchedQueries === undefined) core.illegalConstructor();
    super();
    this.#page = page!;
  }
  #area(name: "bounds" | "workArea") {
    const { environment, surfaceWidth, surfaceHeight, isDisposed } = this.#page;
    if (isDisposed) return { x: 0, y: 0, width: 0, height: 0 };
    return environment.screen?.[name] ?? { x: 0, y: 0, width: surfaceWidth, height: surfaceHeight };
  }
  get width() {
    return this.#area("bounds").width;
  }
  get height() {
    return this.#area("bounds").height;
  }
  get availLeft() {
    return this.#area("workArea").x;
  }
  get availTop() {
    return this.#area("workArea").y;
  }
  get availWidth() {
    return this.#area("workArea").width;
  }
  get availHeight() {
    return this.#area("workArea").height;
  }
  get colorDepth() {
    return this.#page.environment.screen?.colorDepth ?? 24;
  }
  get pixelDepth() {
    return this.colorDepth;
  }
  get orientation() {
    return this.#orientation;
  }
  get isExtended() {
    return false;
  }
}
events.defineHandlers(Screen.prototype, ["change"]);

class VisualViewport extends EventTarget {
  #page: Page;

  constructor(page: Page | null = null) {
    if (page?.watchedQueries === undefined) core.illegalConstructor();
    super();
    this.#page = this.$impl.x = page!;
  }
  get offsetLeft() {
    core.brand(this);
    return 0;
  }
  get offsetTop() {
    core.brand(this);
    return 0;
  }
  get pageLeft() {
    return this.#page.scroll(0);
  }
  get pageTop() {
    return this.#page.scroll(1);
  }
  get width() {
    return core.sync(this.#page.doc).metric(1, 2);
  }
  get height() {
    return core.sync(this.#page.doc).metric(1, 3);
  }
  get scale() {
    core.brand(this);
    return 1;
  }
}
events.defineHandlers(VisualViewport.prototype, ["resize", "scroll", "scrollend"]);

class WindowControlsOverlay extends EventTarget {
  #page: Page;

  constructor(page: Page) {
    super();
    this.#page = page;
  }
  get visible() {
    return this.#page.environment.titlebarArea !== undefined;
  }
  getTitlebarAreaRect() {
    const { environment, zoom } = this.#page;
    const { x = 0, y = 0, width = 0, height = 0 } = environment.titlebarArea ?? {};
    return new DOMRect(x / zoom, y / zoom, width / zoom, height / zoom);
  }
}
events.defineHandlers(WindowControlsOverlay.prototype, ["geometrychange"]);

class UserActivation {
  #page: Page;

  constructor(page: Page) {
    this.#page = page;
  }
  get hasBeenActive() {
    return this.#page.hasBeenActive;
  }
  get isActive() {
    return this.#page.isActive();
  }
}

const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";

const nothingNamed = { length: 0, item: () => null, namedItem: () => null, refresh() {}, *[Symbol.iterator]() {} };
const nativeNavigator = navigator;

const safelistedScheme =
  /^(?:bitcoin|cabal|dat|did|doi|dweb|ethereum|geo|hyper|im|ipfs|ipns|ircs?|magnet|mailto|matrix|mms|news|nntp|openpgp4fpr|sip|sms(?:to)?|ssb|ssh|tel|urn|webcal|wtai|xmpp|web[+][a-z]+)$/;

/** There is nobody to ask, so the handler is declined. */
function checkProtocolHandler({ doc, window }: Page, scheme: string, url: string) {
  if (!safelistedScheme.test(core.asciiLower(scheme)))
    throw core.domError("SecurityError", `The scheme '${scheme}' is not allowed.`);
  const resolved = url.includes("%s") ? core.resolveUrl(doc, url.replace("%s", "")) : null;
  if (resolved === null || core.resolveUrl(doc, url) === null)
    throw core.domError("SyntaxError", `The URL '${url}' is invalid or does not contain '%s'.`);
  const { origin, protocol } = new URL(resolved);
  if (!protocol.startsWith("http") || origin !== window.origin)
    throw core.domError("SecurityError", "Can only register a handler in the origin of the document.");
}

class Navigator {
  #page: Page;

  constructor(page: Page) {
    this.#page = page;
  }
  get userAgent(): string {
    return this.#page.host.userAgent ?? nativeNavigator.userAgent;
  }
  get appVersion() {
    return this.userAgent.replace(/^Mozilla./, "");
  }
  get languages() {
    const read = ({ environment }: Page) => Object.freeze([...(environment.languages ?? ["en-US"])]);
    return same(this.#page.window, "languages", read);
  }
  get language() {
    return this.languages[0];
  }
  get onLine() {
    return this.#page.host.isOnline?.() ?? true;
  }
  get clipboard() {
    return same(this.#page.window, "clipboard", page => new Clipboard(page));
  }
  get userActivation() {
    return same(this.#page.window, "userActivation", page => new UserActivation(page));
  }
  get windowControlsOverlay() {
    return same(this.#page.window, "windowControlsOverlay", page => new WindowControlsOverlay(page));
  }
  registerProtocolHandler(scheme: string, url: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    checkProtocolHandler(this.#page, `${scheme}`, `${url}`);
  }
  unregisterProtocolHandler(scheme: string, url: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    checkProtocolHandler(this.#page, `${scheme}`, `${url}`);
  }
  javaEnabled() {
    this.#page;
    return false;
  }
  getGamepads() {
    return [];
  }
  vibrate() {
    if ($argumentCount() < 1) core.tooFew(1);
    return false;
  }
}
for (const [name, value] of Object.entries({
  appCodeName: "Mozilla",
  appName: "Netscape",
  cookieEnabled: true,
  deviceMemory: 8,
  doNotTrack: null,
  hardwareConcurrency: nativeNavigator.hardwareConcurrency,
  maxTouchPoints: 0,
  mimeTypes: nothingNamed,
  pdfViewerEnabled: false,
  platform: isMac ? "MacIntel" : isWindows ? "Win32" : process.arch === "arm64" ? "Linux aarch64" : "Linux x86_64",
  plugins: nothingNamed,
  product: "Gecko",
  productSub: "20030107",
  scheduling: { isInputPending: () => false },
  vendor: "Google Inc.",
  vendorSub: "",
  webdriver: false,
})) {
  core.accessor(Navigator.prototype, name, function (this: Navigator) {
    if (this === Navigator.prototype || !$isObject(this)) throw new TypeError("Illegal invocation");
    return value;
  });
}

class IdleDeadline {
  #end: number;
  #didTimeout: boolean;

  constructor(end = NaN, didTimeout = false, key: unknown = undefined) {
    if (key !== realm) core.illegalConstructor();
    this.#end = end;
    this.#didTimeout = didTimeout;
  }
  get didTimeout() {
    return this.#didTimeout;
  }
  timeRemaining() {
    return Math.max(0, this.#end - performance.now());
  }
}

class IdleCallbacks {
  page: Page;
  /** The callbacks, and when they have waited for too long. */
  waiting = new Map<number, [Function, number]>();
  nextId = 1;
  isScheduled = false;

  constructor(page: Page) {
    this.page = page;
  }
  schedule() {
    if (this.isScheduled || this.waiting.size === 0) return;
    this.isScheduled = true;
    const { tasks } = this.page;
    tasks.post(tasks.BACKGROUND, events.fromEventLoop, runIdleCallbacks, this.page, this);
  }
  run() {
    const { page, waiting, nextId } = this;
    const start = performance.now();
    const end = start + page.tasks.idleTime();
    this.isScheduled = false;
    if (page.isDisposed) return;
    for (const [id, [callback, timeout]] of waiting) {
      if (id >= nextId) break;
      const didTimeout = timeout <= start;
      if (!didTimeout && performance.now() >= end) continue;
      waiting.$delete(id);
      events.callBack(page, callback, page.window, new IdleDeadline(didTimeout ? start : end, didTimeout, realm));
    }
    if (waiting.size === 0 || this.isScheduled) return;
    this.isScheduled = true;
    page.tasks.postDelayed(Math.max(end - performance.now(), 0) + 2, false, scheduleIdleCallbacks, this);
  }
}
const runIdleCallbacks = (_: Page, idle: IdleCallbacks) => idle.run();
function scheduleIdleCallbacks(idle: IdleCallbacks) {
  idle.isScheduled = false;
  idle.schedule();
}
const idleCallbacks = (self: unknown) => same(self, "idle", page => new IdleCallbacks(page));

class Scheduler {
  postTask(callback: Function, { delay = 0, signal }: { delay?: number; signal?: AbortSignal } = {}) {
    const { promise, resolve, reject } = Promise.withResolvers();
    if (signal?.aborted) return Promise.$reject(signal.reason);
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    const run = () => {
      try {
        if (!signal?.aborted) resolve(callback());
      } catch (error) {
        reject(error);
      }
    };
    if (delay > 0) setTimeout(run, delay);
    else setImmediate(run);
    return promise;
  }
  yield() {
    return new Promise<void>(resolve => setImmediate(resolve));
  }
}

class BarProp {
  #page: $Dom.Page;

  constructor(page: any = undefined) {
    if (page?.host === undefined) core.illegalConstructor();
    this.#page = page;
  }
  get visible() {
    return !this.#page.isDisposed && !this.#page.host.isPopup?.();
  }
}

for (const ctor of [MediaQueryList, Storage, Screen, ScreenOrientation, VisualViewport, WindowControlsOverlay]) {
  expose(ctor);
}
for (const ctor of [UserActivation, IdleDeadline, Scheduler, BarProp]) expose(ctor);
expose(Navigator);

const canvasTags = new RegExp("<canvas([^>]*)>.*?</canvas>", "gs");

/** With what scripts have drawn, and the rules that they have inserted. */
function markupToPrint(document: any) {
  const pictures = Array.from(document.getElementsByTagName("canvas"), (canvas: any) => {
    try {
      return canvas.toDataURL();
    } catch {
      return "";
    }
  });
  const sheets = [...document.styleSheets].filter(it => it.href === null && !it.ownerNode.firstChild);
  const rules = [...sheets, ...document.adoptedStyleSheets].flatMap(it =>
    Array.from(it.cssRules, (rule: any) => rule.cssText),
  );
  const markup = document.documentElement?.outerHTML ?? "";
  return (
    markup.replace(canvasTags, (_, attributes) => `<img src="${pictures.shift()}"${attributes}>`) +
    `<style>${rules.join("\n").replaceAll("</", "<\\/")}</style>`
  );
}

function requireCallback(callback: unknown, method: string) {
  if (!$isCallable(callback))
    throw new TypeError(`Failed to execute '${method}': parameter 1 is not of type 'Function'.`);
}

function bounds(self: unknown) {
  const { environment, surfaceWidth, surfaceHeight } = pageOf(self);
  return environment.windowBounds ?? { x: 0, y: 0, width: surfaceWidth, height: surfaceHeight };
}

/** https://html.spec.whatwg.org/#named-access-on-the-window-object */
function namedInWindow(page: Page | null, name: string) {
  if (page === null) return;
  const { doc } = page;
  if (page.frameCount > 0) {
    const frame = loader.framesOf(page).find(node => loader.frameName(node) === name);
    if (frame !== undefined && name !== "") return frame.x.window;
  }
  const withId = core.scopeOf(doc.node).ids.$get(name);
  if (withId === undefined && doc.named.size === 0) return;
  const isNamed = (node: N) => node.name !== "iframe" && core.getAttr(node, "name") === name;
  const found = new Set<N>([withId ?? []].flat());
  for (const node of doc.named) if (isNamed(node)) found.$add(node);
  if (found.size === 0) return;
  if (found.size === 1) return wrap(found.values().next().value!);
  const matches = (node: N) => core.getAttr(node, "id") === name || (doc.named.$has(node) && isNamed(node));
  return core.same(doc.node, "window." + name, () => nodes.liveElements(doc.node, matches));
}

function Window() {
  core.illegalConstructor();
}
Object.setPrototypeOf(Window, EventTarget);
Object.defineProperty(Window, "prototype", {
  value: Object.create(
    windowProperties((name: string, self: unknown) => namedInWindow(pageOf(self), name), EventTarget.prototype),
    { constructor: { value: Window, writable: true, configurable: true } },
  ),
  writable: false,
});

/** They are on the global object. */
class WindowMembers {
  find(text = "", caseSensitive = false, backwards = false, wrap = false) {
    return require("internal/desktop/dom/find").select(pageOf(this), `${text}`, !!caseSensitive, !!backwards, !!wrap);
  }
  get window() {
    return pageOf(this).window;
  }
  get self() {
    return pageOf(this).window;
  }
  get frames() {
    return pageOf(this).window;
  }
  get parent() {
    const page = pageOf(this);
    if (page.host.parent) return page.host.parent();
    return page.frameElement?.doc.page?.window ?? page.window;
  }
  get top() {
    let page = pageOf(this);
    if (page.host.top) return page.host.top();
    while (page.frameElement?.doc.page) page = page.frameElement.doc.page;
    return page.window;
  }
  get frameElement() {
    const page = pageOf(this);
    return page.isDisposed ? null : core.wrapOrNull(page.frameElement);
  }
  get length() {
    return pageOf(this).frameCount;
  }
  get opener() {
    const { host } = pageOf(this);
    return host.getOpener?.() ?? host.opener ?? null;
  }
  set opener(value) {
    const page = pageOf(this);
    if (value === null && page.host.disown) page.host.disown();
    else Object.defineProperty(page.window, "opener", { value, writable: true, enumerable: true, configurable: true });
  }
  get closed() {
    const page = pageOf(this);
    return page.isDisposed || !!page.host.isClosed?.();
  }
  get name() {
    return pageOf(this).host.getName?.() ?? same(this, "name", page => page.host.name ?? "");
  }
  set name(value) {
    const page = pageOf(this);
    page.same.$set("name", `${value}`);
    page.host.setName?.(`${value}`);
  }
  get status() {
    return "";
  }
  get document() {
    return wrap(pageOf(this).doc.node);
  }
  get customElements() {
    return pageOf(this).doc.registry;
  }
  get location(): any {
    return same(this, "location", page => page.history().createLocation(page));
  }
  set location(url) {
    pageOf(this).window.location.href = url;
  }
  get origin() {
    return pageOf(this).window.location.origin;
  }
  get history() {
    return same(this, "history", page => new (page.history().History)(page));
  }
  get navigation() {
    return same(this, "navigation", page => new (page.history().Navigation)(page));
  }
  get navigator() {
    return same(this, "navigator", page => new Navigator(page));
  }
  get clientInformation() {
    return pageOf(this).window.navigator;
  }
  get screen() {
    viewOf(this);
    return same(this, "screen", page => new Screen(page));
  }
  get visualViewport() {
    viewOf(this);
    return same(this, "visualViewport", page => new VisualViewport(page));
  }
  get scheduler() {
    return same(this, "scheduler", () => new Scheduler());
  }
  get localStorage() {
    return same(this, "local", page => createStorage(page, "local"));
  }
  get sessionStorage() {
    return same(this, "session", page => createStorage(page, "session"));
  }
  get CSS() {
    return same(this, "CSS", cssom.createCss);
  }
  get event() {
    return pageOf(this).event;
  }
  get isSecureContext() {
    return true;
  }
  get crossOriginIsolated() {
    return false;
  }
  webkitRequestAnimationFrame(callback: Function) {
    return WindowMembers.prototype.requestAnimationFrame.$apply(this, arguments);
  }
  webkitCancelAnimationFrame(id: number) {
    return WindowMembers.prototype.cancelAnimationFrame.$apply(this, arguments);
  }
  get originAgentCluster() {
    return false;
  }
  get devicePixelRatio() {
    return viewOf(this).scale;
  }
  get innerWidth() {
    const page = viewOf(this);
    page.doc.container?.measure();
    return Math.floor(page.width);
  }
  get innerHeight() {
    const page = viewOf(this);
    page.doc.container?.measure();
    return Math.floor(page.height);
  }
  get outerWidth() {
    viewOf(this);
    return bounds(this).width;
  }
  get outerHeight() {
    viewOf(this);
    return bounds(this).height;
  }
  get screenX() {
    viewOf(this);
    return bounds(this).x;
  }
  get screenY() {
    viewOf(this);
    return bounds(this).y;
  }
  get screenLeft() {
    viewOf(this);
    return bounds(this).x;
  }
  get screenTop() {
    viewOf(this);
    return bounds(this).y;
  }
  get scrollX() {
    return viewOf(this).scroll(0);
  }
  get scrollY() {
    return viewOf(this).scroll(1);
  }
  get pageXOffset() {
    return viewOf(this).scroll(0);
  }
  get pageYOffset() {
    return viewOf(this).scroll(1);
  }

  requestAnimationFrame(callback: Function, phase: unknown = undefined) {
    if ($argumentCount() < 1) core.tooFew(1);
    requireCallback(callback, "requestAnimationFrame");
    const page = pageOf(this);
    page.frameCallbacks.$set(page.nextCallback, callback);
    if (phase === "before-events") page.earlyCallbacks.push(page.nextCallback);
    page.frameTimer?.ref();
    core.invalidate(page.doc);
    return page.nextCallback++;
  }
  paintNow(deliversResizes: unknown = false) {
    pageOf(this).paintNow(!!deliversResizes);
  }
  cancelAnimationFrame(id: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    pageOf(this).frameCallbacks.$delete(id);
  }
  requestIdleCallback(callback: Function, options: { timeout?: number } | undefined = undefined) {
    if ($argumentCount() < 1) core.tooFew(1);
    requireCallback(callback, "requestIdleCallback");
    const idle = idleCallbacks(this);
    idle.waiting.$set(idle.nextId, [callback, performance.now() + (options?.timeout || Infinity)]);
    idle.schedule();
    return idle.nextId++;
  }
  cancelIdleCallback(id: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    idleCallbacks(this).waiting.$delete(id);
  }
  getComputedStyle(element: any, pseudo: string | null | undefined = undefined) {
    if ($argumentCount() < 1) core.tooFew(1);
    const node = core.nodeOf(element);
    if (node?.type !== core.ELEMENT) {
      throw new TypeError("Failed to execute 'getComputedStyle': parameter 1 is not of type 'Element'.");
    }
    return cssom.computedStyle(node, pseudo ? String(pseudo) : "");
  }
  getSelection() {
    return wrapSelection(pageOf(this).doc);
  }
  matchMedia(query: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return new MediaQueryList(viewOf(this), engine.parseMedia(String(query)).join(", "));
  }
  scroll(first: any = undefined, second?: any) {
    return html.scrollFromScript(
      this == null || this === (globalThis as any) ? pageOf(this) : this.$impl?.x,
      $argumentCount(),
      first,
      second,
      false,
    );
  }
  scrollTo(first: any = undefined, second?: any) {
    return html.scrollFromScript(
      this == null || this === (globalThis as any) ? pageOf(this) : this.$impl?.x,
      $argumentCount(),
      first,
      second,
      false,
    );
  }
  scrollBy(first: any = undefined, second?: any) {
    return html.scrollFromScript(
      this == null || this === (globalThis as any) ? pageOf(this) : this.$impl?.x,
      $argumentCount(),
      first,
      second,
      true,
    );
  }
  moveTo(x: number, y: number) {
    if ($argumentCount() < 2) core.tooFew(2);
    viewOf(this).host.moveWindow?.({ ...bounds(this), x, y });
  }
  moveBy(x: number, y: number) {
    if ($argumentCount() < 2) core.tooFew(2);
    viewOf(this).host.moveWindow?.({ ...bounds(this), x: bounds(this).x + x, y: bounds(this).y + y });
  }
  resizeTo(width: number, height: number) {
    if ($argumentCount() < 2) core.tooFew(2);
    viewOf(this).host.moveWindow?.({
      ...bounds(this),
      width: Math.max(width | 0, 100),
      height: Math.max(height | 0, 100),
    });
  }
  resizeBy(x: number, y: number) {
    if ($argumentCount() < 2) core.tooFew(2);
    viewOf(this).host.moveWindow?.({ ...bounds(this), width: bounds(this).width + x, height: bounds(this).height + y });
  }
  requestResize() {
    const page = pageOf(this);
    if (!page.sizesContainer)
      throw domError("NotAllowedError", "The document does not size the element that embeds it.");
    page.container.fit(true);
  }
  alert(message = "") {
    pageOf(this).host.dialog?.("alert", String(message));
  }
  confirm(message = "") {
    return !!pageOf(this).host.dialog?.("confirm", String(message));
  }
  prompt(message = "", initial = "") {
    return pageOf(this).host.dialog?.("prompt", String(message), String(initial)) ?? null;
  }
  open(url: unknown = "", target = "_blank", features = "") {
    let page = pageOf(this);
    if (page.isDisposed) return null;
    if (page.host.owner) page = require("internal/desktop/dom/exotic").callingWindow(true)?.x ?? page;
    url = `${url}`;
    target = `${target}` || "_blank";
    features = `${features ?? ""}`;
    const resolved = url === "" ? "about:blank" : core.resolveUrl(page.doc, url as string);
    if (resolved === null) throw domError("SyntaxError", `Unable to open a window with invalid URL '${url}'.`);
    if (page.isUnloading) return null;
    const { noopener, noreferrer } = require("internal/desktop/web/mime").windowFeatures(features);
    const isKeyword = /^_(?:self|parent|top)$/i.test(target);
    const options = {
      source: "script",
      referrerPolicy: noreferrer ? "no-referrer" : undefined,
      becomesOpener: !noopener && !isKeyword,
    };
    const found = pageOf(this).host.navigateOther?.(target, url === "" ? null : resolved, options);
    if (found) return noopener && !isKeyword ? null : found;
    if (!isKeyword) {
      const hasTextActivation = page.consumeActivation();
      return (
        page.host.open?.(resolved, String(target), String(features), page.createPage, { hasTextActivation }) ?? null
      );
    }
    page.navigate(resolved, { source: "script" });
    return page.window;
  }
  close() {
    pageOf(this).host.close?.();
  }
  stop() {
    const page = pageOf(this);
    if (page.entries.length > 0) page.history().abortNavigation(page);
    require("internal/desktop/dom/document").abortParser(page);
    page.host.stop?.();
  }
  print() {
    const page = pageOf(this);
    if (page.host.print === undefined || page.isUnloading) return;
    const fire = (type: string) => page.isDisposed || events.dispatch(page.target, new events.Event(type));
    fire("beforeprint");
    page.host
      .print(page.doc.baseUrl, () => markupToPrint(page.window.document))
      .then(() => page.queueTask(() => fire("afterprint")));
  }
  focus() {
    const page = pageOf(this);
    if (page.container !== null) page.container.focus();
    else page.host.focusWindow?.();
  }
  blur() {}
  captureEvents() {}
  releaseEvents() {}
  postMessage(message: unknown, options: any = undefined, transfer: any = undefined) {
    if ($argumentCount() < 1) core.tooFew(1);
    const page = pageOf(this);
    if (page.host.owner)
      return require("internal/desktop/dom/local_frame").postMessage(page.host, message, options, transfer);
    const targetOrigin = String(($isObject(options) ? options.targetOrigin : options) ?? "/");
    if (targetOrigin !== "*" && targetOrigin !== "/") {
      const wanted = URL.parse(targetOrigin);
      if (wanted === null)
        throw core.domError("SyntaxError", `Invalid target origin '${targetOrigin}' in a call to 'postMessage'.`);
      if (wanted.origin === "null" || wanted.origin !== realm.page.window.origin) return;
    }
    const { cloneInto, inbox, transferList } = page.host.messaging();
    const envelope = cloneInto(
      inbox.clone,
      message,
      $isObject(options) ? transferList(options, false) : transferList(transfer),
    );
    page.queueTask(() => inbox.deliver(page.window, envelope, page.window.origin, realm.page.window));
  }
  reportError(error: unknown) {
    if ($argumentCount() < 1) core.tooFew(1);
    pageOf(this).reportError(error);
  }
  createImageBitmap(_image: unknown) {
    return loader.canvas().createImageBitmap(...arguments);
  }
}
for (const name of splitTokens("locationbar menubar personalbar scrollbars statusbar toolbar")) {
  core.accessor(WindowMembers.prototype, name, function (this: unknown) {
    return same(this, name, () => new BarProp(pageOf(this)));
  });
}
expose(Window, { TEMPORARY: 0, PERSISTENT: 1 });

const openWindow = WindowMembers.prototype.open;
core.hooks.openWindow = (page: $Dom.Page, ...rest: unknown[]) => openWindow.$apply(page.window, rest);

export default { Window, WindowMembers, namedInWindow };
