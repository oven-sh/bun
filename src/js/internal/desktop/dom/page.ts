// A document in a window. What is outside of it comes from `host`, which may be of another realm.
const core = require("internal/desktop/dom/core");
const events = require("internal/desktop/dom/events");
const editing = require("internal/desktop/dom/editing");
const input = require("internal/desktop/dom/input");
const loader = require("internal/desktop/dom/loader");
const { Page } = require("internal/desktop/dom/frame");
const { Window, WindowMembers, namedInWindow } = require("internal/desktop/dom/window");
const { selectionOf } = require("internal/desktop/dom/range");
require("internal/desktop/dom/svg");

const { interfaces, lazyInterfaces, realm, splitTokens } = core;

type Page = $Dom.Page;

function valueOf(value: unknown): PropertyDescriptor {
  return { value, writable: true, configurable: true };
}

/** An assignment replaces it. */
function replaceable(name: string, get: () => unknown, enumerable = false): PropertyDescriptor {
  function set(this: object | undefined, value: unknown) {
    Object.defineProperty(this ?? realm.page.window, name, { ...valueOf(value), enumerable });
  }
  return { get, set, enumerable, configurable: true };
}

const defineLazyValues = $newCppFunction("DesktopLazy.cpp", "jsFunctionDesktopDefineLazyValues", 3);

const inCanvas =
  splitTokens(`CanvasGradient CanvasPattern CanvasRenderingContext2D ImageBitmap ImageBitmapRenderingContext ImageData OffscreenCanvas
  OffscreenCanvasRenderingContext2D Path2D TextMetrics`);
const inHistory = splitTokens(`History Location NavigateEvent Navigation NavigationActivation
  NavigationCurrentEntryChangeEvent NavigationDestination NavigationHistoryEntry NavigationPrecommitController
  NavigationTransition`);

const inObservable = ["Observable", "Subscriber"];
const inTouch = ["Touch", "TouchEvent", "TouchList"];
const inXPath = splitTokens("XPathEvaluator XPathExpression XPathResult");

function loadInterface(name: string) {
  if (inXPath.includes(name)) require("internal/desktop/dom/xpath");
  if (inTouch.includes(name)) require("internal/desktop/dom/touch");
  if (name === "Sanitizer") require("internal/desktop/dom/sanitizer");
  if (inObservable.includes(name)) require("internal/desktop/dom/observable");
  if (inCanvas.includes(name)) return loader.canvas()[name];
  if (inHistory.includes(name)) realm.page.history();
  return lazyInterfaces.$get(name)?.load() ?? interfaces[name];
}

core.hooks.loadInterface = loadInterface;

function defineMembers(window: object, hasInterfaces = true) {
  const { constructor: _constructor, ...all } = Object.getOwnPropertyDescriptors<any>(WindowMembers.prototype);
  for (const name in all) {
    const { get, set } = all[name];
    if (get !== undefined && set === undefined && name !== "window" && name !== "document" && name !== "top") {
      all[name] = replaceable(name, get, true);
    } else all[name].enumerable = true;
  }
  for (const name of ["addEventListener", "removeEventListener", "dispatchEvent"]) {
    all[name] = valueOf(events.EventTarget.prototype[name]);
  }
  const handlers = {};
  events.defineHandlers(handlers, ["error", "message"]);
  Object.defineProperties(window, { ...all, ...Object.getOwnPropertyDescriptors(handlers) });
  if (hasInterfaces) defineInterfaces(window, loadInterface);
}

function defineInterfaces(window: object, load: (name: string) => unknown) {
  const lazy = new Set([
    ...inCanvas,
    ...inHistory,
    ...inXPath,
    ...inObservable,
    ...inTouch,
    "Sanitizer",
    ...lazyInterfaces.keys(),
    ...Object.keys(interfaces),
  ]);
  // The global object may have these already.
  for (const name of nativeGlobals) if (lazy.$delete(name)) Object.defineProperty(window, name, valueOf(load(name)));
  events.defineHandlers(
    window,
    [...events.globalHandlers, ...events.windowHandlers].filter(name => name !== "error" && name !== "message"),
  );
  defineLazyValues(window, [...lazy], load);
}

const nativeGlobals = splitTokens(`AbortController AbortSignal Blob BroadcastChannel CloseEvent CustomEvent DOMException
  ErrorEvent Event EventTarget File FormData Headers MessageChannel MessageEvent MessagePort Performance PerformanceEntry
  PerformanceMark PerformanceMeasure PerformanceObserver Request Response URL URLSearchParams WebSocket Worker`);

let otherWindows: object | undefined;

/** The prototype of a window that is not the global object. It has what the global object has. */
function windowPrototype(): object {
  if (otherWindows !== undefined) return otherWindows;
  const global: any = globalThis;
  const prototype = Object.create(Window.prototype);
  defineMembers(prototype);
  const own = new Set(Object.getOwnPropertyNames(prototype));
  for (const name of Object.getOwnPropertyNames(global)) {
    if (own.$has(name) || name in Window.prototype) continue;
    Object.defineProperty(
      prototype,
      name,
      replaceable(name, () => global[name]),
    );
  }
  Object.defineProperty(prototype, "globalThis", Object.getOwnPropertyDescriptor(prototype, "self")!);
  return (otherWindows = prototype);
}

function install(global: any) {
  core.NativeEventTarget.prototype.dispatchEvent = events.dispatchToNative;
  (core.NativeEventTarget.prototype as any).when = events.EventTarget.prototype.when;
  Object.setPrototypeOf(global, Window.prototype);
  defineMembers(global);
}

function installMirrored(global: any, mirror: any) {
  const members = {};
  defineMembers(members, false);
  Object.getPrototypeOf(global.AbortSignal.prototype).dispatchEvent = mirror.wrap(events.dispatchToNative);
  const prototype = mirror.prototypeFor(Window.prototype);
  const find = mirror.wrap((name: string) => namedInWindow(mirror.page, name));
  const { windowProperties } = require("internal/desktop/dom/exotic");
  Object.setPrototypeOf(prototype, windowProperties(find, mirror.prototypeFor(events.EventTarget.prototype)));
  Object.setPrototypeOf(global, prototype);
  mirror.copy(members, global);
  defineInterfaces(global, mirror.wrap(loadInterface));
}

const { entries, forEach, keys, values } = Array.prototype;

/** What `Mirror` needs. */
function shared() {
  return {
    createPage,
    realm,
    natives: new Map(
      Object.entries({
        Object,
        Array,
        Promise,
        Error,
        EvalError,
        RangeError,
        ReferenceError,
        SyntaxError,
        TypeError,
        URIError,
        Map,
        Set,
        Float32Array,
        Float64Array,
        Uint8Array,
        Uint8ClampedArray,
        ArrayBuffer,
        DOMException,
        Blob,
        File,
      }),
    ),
    functionPrototype: Function.prototype,
    iteratorPrototype: Object.getPrototypeOf(Object.getPrototypeOf(values.$call([]))),
    arrayMethods: new Set<Function>([entries, forEach, keys, values]),
    modules: require("internal/desktop/web/dom"),
    isInterface: (value: any) =>
      $isCallable(value) &&
      (interfaces[value.name] === value || (inCanvas.includes(value.name) && loadInterface(value.name) === value)),
    hasRealm(value: any) {
      const impl = value.$impl;
      return impl instanceof core.N && (impl.type !== 0 || impl.x !== null);
    },
  };
}

let nextSheet = 1;

function createPage(host: any, options?: { global?: object; baseUrl?: string; mirror?: any }) {
  const global = options?.global;
  const mirror = options?.mirror ?? null;
  const window: any = global ?? Object.create(windowPrototype());
  const page = new Page(host, window, createPage, options?.baseUrl, mirror);
  realm.pages.$add(page);
  if (mirror !== null) {
    realm.hasFrames = true;
    mirror.page = page;
    installMirrored(global, mirror);
    mirror.adopt(page.doc.registry);
  } else if (global !== undefined || !realm.page || realm.page.isDisposed) realm.root = realm.page = page;
  if (global !== undefined && mirror === null) install(global);
  const task = (run: () => void) => events.fromEventLoop(run, page);
  const finder = () => require("internal/desktop/dom/find");
  return {
    window,
    page,
    get document() {
      return core.wrap(page.doc.node);
    },
    shared,
    crossOriginWindow: (remote: object, existing?: object) =>
      require("internal/desktop/dom/local_frame").remoteWindow(remote, existing),
    frames: () => loader.framesOf(page).flatMap(node => node.x.local?.context ?? []),
    renew: (url: string, baseUrl?: string) => page.renew(url, baseUrl),
    render: () => task(() => page.renderInFrame()),
    navigate: (url: string, options: object, source: object) => page.navigate(url, { ...options, initiator: source }),
    isActive: () => page.isActive(),
    hasBeenActive: () => page.hasBeenActive,
    activate: () => page.noteActivationAbove(),
    dispatchTask: (event: any) => task(() => events.dispatch(page.target, event)),
    loadHTML: (source: string) => task(() => page.loadHtml(source)),
    loadXML: (source: string, contentType: string) => task(() => page.loadXml(source, contentType)),
    cameWith: (script: string) => page.cameWith(script),
    forgetSource: () => page.forgetSource(),
    /** Without scripts, and without a `load` event. */
    parseHTML: (source: string) => require("internal/desktop/dom/parser").parseDocument(page.doc, source),
    remoteWindow: (handle: object) => require("internal/desktop/dom/remote_frame").popup(page, handle),
    setUrl: (url: string) => page.doc.engine.setBaseUrl((page.url = page.doc.url = page.doc.baseUrl = url)),
    handleEvent: (event: object) => page.handleEvent(event),
    flushCanvases: loader.flushCanvases,
    attach: (surface: number) => page.attach(surface),
    environmentChanged: () => page.readEnvironment(),
    edit: (name: string) =>
      page.focusedFrame?.x.edit
        ? page.focusedFrame.x.edit(name)
        : task(() => editing.execute(page.doc, name.toLowerCase(), "", false)),
    focusedFrame: () => page.focusedFrame?.x?.focusedFrame(),
    insertText: (text: string) => task(() => editing.insertText(page.doc, text)),
    dictionaryChanged: () => void (page.spelling !== null && require("internal/desktop/dom/spelling").checkAgain(page)),
    insertCSS(css: string) {
      const key = String(nextSheet++);
      page.setSheet(key, css);
      return key;
    },
    removeInsertedCSS: (key: string) => page.setSheet(key, null),
    find: (text: string, options?: object) => finder().find(page, text, options),
    stopFind: (action?: string) => finder().stop(page, action),
    popState: (url: string, key?: string) => task(() => page.history().popState(page, url, key)),
    willTraverse: (key: string, isByUser: boolean, proceed: () => void) =>
      task(() => page.history().willTraverse(page, key, isByUser, proceed)),
    checkStyleAttributes: () => void (page.doc.checksStyleAttributes = true),
    keepEntries: (keys: string[]) => page.entries.length > 0 && task(() => page.history().keepEntries(page, keys)),
    abortNavigation: () => page.entries.length > 0 && task(() => page.history().abortNavigation(page)),
    storageChanged(kind: string, key: string | null, oldValue: string | null, newValue: string | null, url: string) {
      const init = { key, oldValue, newValue, url, storageArea: page.window[kind + "Storage"] };
      task(() => events.dispatch(page.target, new events.StorageEvent("storage", init)));
    },
    onlineChanged: (is: boolean) =>
      task(() => events.dispatch(page.target, new events.Event(is ? "online" : "offline"))),
    willSwap(type: string, to?: object) {
      let ticket = 0;
      task(() => (ticket = page.history().willSwap(page, type, to as any)));
      return ticket;
    },
    /** False if the page wants to stay. */
    beforeUnload() {
      const event = new events.BeforeUnloadEvent("beforeunload", { cancelable: true });
      page.isUnloading = true;
      const wasNotCanceled = events.dispatch(page.target, event);
      const leaves =
        wasNotCanceled &&
        event.returnValue === "" &&
        loader.framesOf(page).every(node => node.x.local?.beforeUnload() !== false);
      page.isUnloading = false;
      return leaves;
    },
    chooseFiles: (input: object, paths: string[]) => core.nodeOf(input)!.x.chooseFiles(paths),
    describeForAccessibility(node: object) {
      const aria = require("internal/desktop/dom/aria");
      const it = core.nodeOf(node)!;
      return aria.isHiddenAbove(it) ? { role: "none", name: "" } : { role: aria.roleOf(it), name: aria.nameOf(it) };
    },
    selectionText: () => selectionOf(page.doc).text(),
    hitInfo: (x: number, y: number) => input.describePoint(page, x / page.zoom, y / page.zoom),
    dispatchToWindow: (event: object) => events.dispatchFromScript(page.target, event, true),
    dispose: () => page.dispose(),
  };
}

export default { createPage };
