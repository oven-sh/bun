// `EventTarget` and `Event` for windows. They take the place of the native ones, which have no path to travel along.
const core = require("internal/desktop/dom/core");

const runMicrotasks = $bindgen("desktop.bind.ts", "drainMicrotasks");
/** What happens at the end of the next microtask checkpoint. */
const afterMicrotasks: (() => void)[] = [];

function drainMicrotasks() {
  runMicrotasks();
  if (afterMicrotasks.length > 0) for (const run of afterMicrotasks.splice(0)) run();
}

const { DOCUMENT, Listener, N, NativeEvent, NativeEventTarget, flags, hooks } = core;
const { domError, expose, hostOf, reportError, retarget, rootOf, scopeOf, wrap, wrapOrNull } = core;
const { SHADOW_ROOT, HOST, USER_AGENT } = flags;
const nativeTarget = NativeEventTarget.prototype;

type int32 = import("bun").int32;
type N = $Dom.N;
type Page = $Dom.Page;
type Listener = $Dom.Listener;

const types = new Map<string, number>();
/** How many listeners there have ever been for each type. */
const listened: boolean[] = [];

function eventType(name: string): int32 {
  let type = types.$get(name);
  if (type === undefined) {
    types.$set(name, (type = listened.length));
    listened.push(false);
  }
  return type | 0;
}

["touchstart", "touchmove"].forEach(eventType);
const WHEEL = eventType("wheel");
const lastScrollBlocking = eventType("mousewheel");
const legacyNames = {
  __proto__: null,
  wheel: "mousewheel",
  animationend: "webkitAnimationEnd",
  animationiteration: "webkitAnimationIteration",
  animationstart: "webkitAnimationStart",
  transitionend: "webkitTransitionEnd",
} as any;
/** From `WHEEL` up to it, every other type is the legacy one of the one before it. */
let lastLegacy: int32 = 0;
for (const name in legacyNames) {
  eventType(name);
  lastLegacy = eventType(legacyNames[name]);
}

/** The compositor has to wait for what may cancel a `wheel` event. */
function wheelListenersChanged(target: N) {
  const blocks = (node: N) => {
    for (const type of [WHEEL, lastScrollBlocking]) {
      if (hasListenerWithout(node, type | 0, L.Passive)) return true;
    }
    return false;
  };
  const page: Page | null = target.type === 0 ? (target.x?.target === target ? target.x : null) : target.doc.page;
  if (target.type !== 0 && target.type !== DOCUMENT) {
    target.flags = blocks(target) ? target.flags | flags.BLOCKS_WHEEL : target.flags & ~flags.BLOCKS_WHEEL;
    const { id } = target;
    if (id !== 0) target.doc.engine.setBlocksWheel(id, blocks(target));
  } else page?.doc.engine.setBlocksWheel(1, blocks(page.target) || blocks(page.doc.node));
}

function isOutermost(target: N): boolean {
  if (target.type === 0) return target.x?.target === target;
  return target.type === DOCUMENT || target.parent === target.doc.node || target === core.bodyOf(target.doc);
}

function isListenedTo(name: string): boolean {
  const type = types.$get(name);
  return type !== undefined && (listened[type] || (type < lastLegacy && name in legacyNames && listened[type + 1]));
}

const enum L {
  Capture = 1,
  Once = 2,
  Passive = 4,
  Removed = 8,
  /** `on*` */
  Handler = 16,
  /** A handler whose callback is `[source, element, the page that has allowed it]`. */
  Uncompiled = 32,
}

let nextSerial = 0;

/** The `type` of the only entry of a list that got too long. Its `callback` has a list for each type and phase. */
const BY_TYPE = -1;
const MAX_MIXED = 8;

/** The list may have listeners of other types. */
function listenersFor(target: N, type: int32, capture: int32): Listener | null {
  const first = target.listeners;
  if (first === null || first.type !== BY_TYPE) return first;
  const lists: (Listener | null)[] = first.callback;
  const index = (type << 1) | capture;
  return index < lists.length ? lists[index] : null;
}

function setListeners(target: N, like: Listener, first: Listener | null) {
  const head = target.listeners;
  if (head === null || head.type !== BY_TYPE) return void (target.listeners = first);
  const lists: (Listener | null)[] = head.callback;
  const index = (like.type << 1) | (like.flags & L.Capture);
  while (lists.length <= index) lists.push(null);
  lists[index] = first;
}

function removeAllListeners(target: N) {
  const head = target.listeners;
  if (head === null) return;
  for (let it of (head.type === BY_TYPE ? head.callback : [head]) as (Listener | null)[]) {
    for (; it !== null; it = it.next) it.flags |= L.Removed;
  }
  target.listeners = null;
}

function bitOf(type: int32, capture: int32): int32 {
  return 1 << (((type << 1) | capture) & 31);
}

function hasListenerWithout(target: N, type: int32, bits: int32): boolean {
  for (let capture: int32 = 0; capture <= L.Capture; capture = (capture + 1) | 0) {
    if (!(target.listensTo & bitOf(type, capture))) continue;
    for (let it = listenersFor(target, type, capture); it !== null; it = it.next) {
      if (it.type === type && !(it.flags & bits)) return true;
    }
  }
  return false;
}

/** How many came before it. */
function append(target: N, added: Listener): int32 {
  let last = listenersFor(target, added.type, added.flags & L.Capture);
  if (last === null) {
    setListeners(target, added, added);
    return 0;
  }
  let count: int32 = 1;
  for (; last.next !== null; last = last.next) count = (count + 1) | 0;
  last.next = added;
  return count;
}

function splitByType(target: N) {
  let it = target.listeners;
  target.listeners = new Listener(BY_TYPE, 0, 0, []);
  while (it !== null) {
    const next: Listener | null = it.next;
    it.next = null;
    append(target, it);
    it = next;
  }
}

function findListener(target: N, type: int32, callback: unknown, capture: int32): Listener | null {
  if (!(target.listensTo & bitOf(type, capture))) return null;
  for (let it = listenersFor(target, type, capture); it !== null; it = it.next) {
    if (it.type === type && it.callback === callback && (it.flags & (L.Capture | L.Handler)) === capture) return it;
  }
  return null;
}

function addListener(target: N, type: int32, bits: int32, callback: unknown): Listener {
  const added = new Listener(type, bits, nextSerial++, callback);
  if (append(target, added) >= MAX_MIXED && target.listeners!.type !== BY_TYPE) splitByType(target);
  listened[type] = true;
  target.listensTo |= bitOf(type, bits & L.Capture);
  if (type <= lastScrollBlocking) wheelListenersChanged(target);
  return added;
}

function removeListener(target: N, listener: Listener) {
  if (listener.flags & L.Removed) return;
  listener.flags |= L.Removed;
  let at = listenersFor(target, listener.type, listener.flags & L.Capture);
  if (at === listener) setListeners(target, listener, listener.next);
  else {
    while (at !== null && at.next !== listener) at = at.next;
    if (at !== null) at.next = listener.next;
  }
  if (listener.type <= lastScrollBlocking) wheelListenersChanged(target);
}

const collectedListeners = new FinalizationRegistry<[AbortSignal, number]>(([signal, id]) =>
  $removeAbortAlgorithmFromSignal(signal, id),
);

function removeOnAbort(signal: AbortSignal, target: N, listener: Listener) {
  const [weakTarget, weakListener] = [new WeakRef(target), new WeakRef(listener)];
  const id = $addAbortAlgorithmToSignal(signal, () => {
    const [target, listener] = [weakTarget.deref(), weakListener.deref()];
    if (target !== undefined && listener !== undefined) removeListener(target, listener);
  });
  collectedListeners.register(listener, [signal, id]);
}

function hasListeners(target: N, name: string): boolean {
  if (target.listeners === null) return false;
  const type = types.$get(name);
  if (type === undefined) return false;
  return hasListenerWithout(target, type | 0, 0);
}

const { realm } = core;

function hasListenerAbove(node: N, name: string): boolean {
  if (!isListenedTo(name)) return false;
  const { page } = node.doc;
  for (let at: N | null = node; at !== null; at = core.flatParent(at)) if (hasListeners(at, name)) return true;
  return page !== null && hasListeners(page.target, name);
}

function captures(target: N, type: int32): boolean {
  if (!(target.listensTo & bitOf(type, L.Capture))) return false;
  for (let it = listenersFor(target, type, L.Capture); it !== null; it = it.next) {
    if (it.type === type && it.flags & L.Capture) return true;
  }
  return false;
}

/** Whether an event that does not bubble is listened to. */
function isHeard(node: N, name: string): boolean {
  if (!isListenedTo(name)) return false;
  if (hasListeners(node, name)) return true;
  const type = types.$get(name)! | 0;
  for (let at = core.flatParent(node); at !== null; at = core.flatParent(at)) if (captures(at, type | 0)) return true;
  return captures(node.doc.node, type | 0) || captures(node.doc.page!.target, type | 0);
}

function hasBlockingListenerAbove(node: N, name: string): boolean {
  const type = types.$get(name);
  if (type === undefined) return false;
  const blocks = (target: N) => hasListenerWithout(target, type | 0, L.Passive);
  for (let at: N | null = node; at !== null; at = at.rare?.slot ?? core.parentOrHost(at)) if (blocks(at)) return true;
  return blocks(node.doc.page!.target);
}

/** Null for a native one. Without a receiver, it is the window. */
function targetOf(self: any): N | null {
  if (self == null) return core.realm.page.target;
  const impl = self.$impl;
  return impl instanceof N ? impl : null;
}

class EventTarget {
  declare $impl: N;

  constructor() {
    const impl = core.takePending() ?? new N(0, realm.hasFrames ? realm.page.doc : null!, core.noKind);
    impl.js = this;
    this.$impl = impl;
  }

  static [Symbol.hasInstance](value: any) {
    if (this !== EventTarget) return Function.prototype[Symbol.hasInstance].$call(this, value);
    return $isObject(value) && (value.$impl instanceof N || value instanceof NativeEventTarget);
  }

  addEventListener(name: string, callback: any, options: any = undefined) {
    if ($argumentCount() < 2) core.tooFew(2);
    const target = targetOf(this);
    if (target === null) return nativeTarget.addEventListener.$call(this, name, callback, options);
    let bits: int32 = 0;
    let passive: unknown;
    let signal: AbortSignal | undefined;
    if ($isObject(options)) {
      bits = (options.capture ? L.Capture : 0) | (options.once ? L.Once : 0);
      passive = options.passive;
      if ((signal = options.signal) !== undefined) {
        if (!$isAbortSignal(signal))
          throw new TypeError("Failed to execute 'addEventListener': signal is not an 'AbortSignal'.");
        if (signal.aborted) return;
      }
    } else if (options) bits = L.Capture;
    if (callback == null) return;
    if (!$isObject(callback))
      throw new TypeError("Failed to execute 'addEventListener': parameter 2 is not an object.");
    const type = eventType(typeof name === "string" ? name : `${name}`);
    if (passive === undefined ? type <= lastScrollBlocking && isOutermost(target) : passive) bits |= L.Passive;
    if (findListener(target, type, callback, bits & L.Capture) !== null) return;
    const added = addListener(target, type, bits, callback);
    if (signal) removeOnAbort(signal, target, added);
  }

  removeEventListener(name: string, callback: any, options: any = undefined) {
    if ($argumentCount() < 2) core.tooFew(2);
    const target = targetOf(this);
    if (target === null) return nativeTarget.removeEventListener.$call(this, name, callback, options);
    const capture = ($isObject(options) ? options.capture : options) ? L.Capture : 0;
    const found = findListener(target, eventType(typeof name === "string" ? name : `${name}`), callback, capture);
    if (found !== null) removeListener(target, found);
  }

  dispatchEvent(event: any): boolean {
    if ($argumentCount() < 1) core.tooFew(1);
    const target = targetOf(this);
    return target === null ? dispatchToNative.$call(this, event) : dispatchFromScript(target, event);
  }

  when(type: string, options: any = {}) {
    if ($argumentCount() < 1) core.tooFew(1);
    return require("internal/desktop/dom/observable").when(
      this ?? realm.page.window,
      `${type}`,
      options,
      addEventListener,
    );
  }
}

const { addEventListener } = EventTarget.prototype;
const nativeDispatch = nativeTarget.dispatchEvent;

/** For an `AbortSignal`, a `MessagePort` and the like. Their listeners get a native event that looks the same. */
function dispatchToNative(this: object, event: any): boolean {
  if (event instanceof NativeEvent || !(event?.$impl instanceof E)) return nativeDispatch.$call(this, event);
  const twin = new NativeEvent(event.type, event);
  for (let from = event; !Object.hasOwn(from, "composedPath"); from = Object.getPrototypeOf(from)) {
    for (const key of Object.getOwnPropertyNames(from)) if (!(key in twin)) twin[key] = event[key];
  }
  if (!nativeDispatch.$call(this, twin)) cancel(event.$impl);
  return !twin.defaultPrevented;
}
expose(EventTarget);

// ───────────────────────────── dispatch ─────────────────────────────

const enum B {
  Bubbles = 1,
  Cancelable = 2,
  Composed = 4,
  Trusted = 8,
  Canceled = 16,
  Stopped = 32,
  StoppedImmediately = 64,
  InPassive = 128,
  Dispatching = 256,
  Uninitialized = 512,
  IsMouse = 1024,
  IsError = 2048,
  Threw = 4096,
}

class E {
  js: any;
  name: string;
  flags: int32;
  phase: int32 = 0;
  time: number;
  target: N | null = null;
  current: N | null = null;
  related: N | null = null;
  path: N[] | null = null;
  /** How many closed shadow trees each entry of the path is in. */
  depths: number[] | null = null;
  /** For each entry of the path, if they differ. */
  relateds: (N | null)[] | null = null;
  inShadow: boolean[] | null = null;
  pseudoTarget: object | null = null;

  constructor(js: object, name: string, flags: int32) {
    this.js = js;
    this.name = name;
    this.flags = flags;
    this.time = performance.now();
  }
}

/** Whether no script is running, so that microtasks run after each listener. */
let atTopLevel = false;

function fromEventLoop(run: (page: Page, argument: any) => void, page: Page, argument?: any) {
  const before = atTopLevel;
  const calling = realm.page;
  atTopLevel = true;
  if (page.mirror !== null) realm.page = page;
  try {
    run(page, argument);
  } finally {
    atTopLevel = before;
    realm.page = calling;
  }
}

function microtaskCheckpoint() {
  if (!atTopLevel) return;
  const calling = realm.page;
  atTopLevel = false;
  realm.page = realm.root;
  drainMicrotasks();
  realm.page = calling;
  atTopLevel = true;
}

/** Calls what a script has registered. */
function callBack(page: Page | null, callback: Function, self: unknown, a?: unknown, b?: unknown) {
  const top = atTopLevel;
  const calling = realm.page;
  atTopLevel = false;
  realm.page = realm.root;
  if (page !== null && page.mirror !== null) page.mirror.adoptAll(a);
  if (realm.hasFrames) page = core.pageOfCallback(callback) ?? page;
  try {
    if (b === undefined) (callback as any).$call(self, a);
    else (callback as any).$call(self, a, b);
  } catch (error) {
    reportError(page, error);
  }
  if (top) drainMicrotasks();
  atTopLevel = top;
  realm.page = calling;
}

function cancel(event: E) {
  if ((event.flags & (B.Cancelable | B.InPassive)) === B.Cancelable) event.flags |= B.Canceled;
}

function handlerCallback(listener: Listener, name: string) {
  if (listener.flags & L.Uncompiled) {
    const [source, node, allowedBy] = listener.callback as [string, N, Page | null];
    if (node.doc.page === null) return null;
    listener.flags &= ~L.Uncompiled;
    listener.callback = null;
    if (
      allowedBy !== node.doc.page &&
      node.doc.page.host.allowsInline?.("script", source, undefined, true, wrap(node)) === false
    ) {
      return null;
    }
    try {
      listener.callback = node.doc.page.compileHandler(source, name, node) ?? null;
    } catch (error) {
      reportError(node.doc.page, error);
    }
  }
  return listener.callback;
}

const isErrorEvent = (event: any) =>
  event instanceof globalThis.ErrorEvent || event[Symbol.toStringTag] === "ErrorEvent";

function callHandler(listener: Listener, event: E, current: N) {
  const callback = handlerCallback(listener, event.name);
  if (!$isCallable(callback)) return;
  const { js, name } = event;
  const currentJs = current.js;
  if (
    name === "error" &&
    current.type === 0 &&
    currentJs.self === currentJs &&
    (event.flags & B.IsError || isErrorEvent(js))
  ) {
    if (callback.$call(currentJs, js.message, js.filename, js.lineno, js.colno, js.error) === true) cancel(event);
    return;
  }
  const result = callback.$call(current.js, js);
  if (name !== "beforeunload" || !(js instanceof BeforeUnloadEvent || js[Symbol.toStringTag] === "BeforeUnloadEvent")) {
    if (result === false) cancel(event);
  } else if (result != null) {
    const text = `${result}`;
    cancel(event);
    if (js.returnValue === "") js.returnValue = text;
  }
}

/** The `next` of one that was removed is of the list as it was then. */
function nextListener(target: N, listener: Listener, type: int32): Listener | null {
  if (!(listener.flags & L.Removed)) return listener.next;
  let it = listenersFor(target, type, listener.flags & L.Capture);
  while (it !== null && it.serial <= listener.serial) it = it.next;
  return it;
}

/** For a page with frames, whose listeners may be of another realm. */
function invokeInRealm(it: Listener, event: E, current: N, page: Page | null) {
  if ((current.doc ?? page?.doc)?.mirror?.page.isDisposed) return;
  const own = (!(it.flags & L.Uncompiled) && core.pageOfCallback(it.callback)) || page;
  if (own === page || page === null) return call(it, event, current, own);
  if (own!.isDisposed) return;
  const [ours, theirs] = [page.event, own!.event];
  page.event = undefined;
  if (ours === event.js) own!.event = ours;
  call(it, event, current, own);
  page.event = ours;
  own!.event = theirs;
}

function call(it: Listener, event: E, current: N, page: Page | null) {
  try {
    const { callback } = it;
    if (it.flags & L.Handler) callHandler(it, event, current);
    else if (typeof callback === "function") callback.$call(current.js, event.js);
    else callback.handleEvent(event.js);
  } catch (error) {
    event.flags |= B.Threw;
    reportError(page, error);
  }
}

function invokeLegacy(event: E, type: int32, current: N, capture: int32, page: Page | null, drains: boolean) {
  const { name } = event;
  const legacy = (type + 1) | 0;
  if (!listened[legacy] || !(event.flags & B.Trusted) || hasListeners(current, name)) {
    return invoke(event, type, current, capture, page, drains);
  }
  event.name = legacyNames[name];
  invoke(event, legacy, current, capture, page, drains);
  event.name = name;
}

/** Looks at all of them, for the processor to fetch them from memory side by side instead of one before each call. */
function hasCallbacks(first: Listener | null): boolean {
  let count: int32 = 0;
  for (let it = first; it !== null; it = it.next) if ($isObject(it.callback)) count = (count + 1) | 0;
  return count > 0;
}

function invoke(event: E, type: int32, current: N, capture: int32, page: Page | null, drains: boolean) {
  const limit = nextSerial;
  const first = listenersFor(current, type, capture);
  if (!hasCallbacks(first)) return;
  for (let it = first; it !== null; it = nextListener(current, it, type)) {
    if (it.type !== type || (it.flags & (L.Capture | L.Removed)) !== capture || it.serial >= limit) continue;
    if (it.flags & L.Once) removeListener(current, it);
    if (it.flags & L.Passive) event.flags |= B.InPassive;
    event.current = current;
    if (realm.hasFrames) invokeInRealm(it, event, current, page);
    else call(it, event, current, page);
    event.flags &= ~B.InPassive;
    if (drains) drainMicrotasks();
    if (event.flags & B.StoppedImmediately) return;
  }
}

/** `targets` has the target as each entry of the path sees it, unless that is the first entry for all of them. */
function run(event: E, path: N[], targets: N[] | null, page: Page | null) {
  const type = types.$get(event.name);
  event.target = targets === null ? path[0] : targets[targets.length - 1];
  if (type === undefined) return;
  const hasLegacy = type < lastLegacy && type >= WHEEL && (type - WHEEL) % 2 === 0;
  if (!(listened[type] || (hasLegacy && listened[type + 1]))) return;
  const { relateds, inShadow } = event;
  const top = atTopLevel;
  const before = page === null ? undefined : page.event;
  const calling = realm.page;
  atTopLevel = false;
  realm.page = realm.root;
  if (page !== null) {
    page.event = event.js;
    const { mirror } = page;
    if (mirror !== null && event.flags & B.Trusted) mirror.adopt(event.js);
  }
  event.path = path;
  const capturing = bitOf(type | 0, L.Capture) | (hasLegacy ? bitOf((type + 1) | 0, L.Capture) : 0);
  const bubbling = bitOf(type | 0, 0) | (hasLegacy ? bitOf((type + 1) | 0, 0) : 0);
  for (let i = path.length - 1; i >= 0; i--) {
    const current = path[i];
    const target = (event.target = targets === null ? path[0] : targets[i]);
    if (!(current.listensTo & capturing) || event.flags & B.Stopped) continue;
    event.phase = current === target || path.length === 1 ? 2 : 1;
    if (relateds !== null) event.related = relateds[i];
    if (inShadow !== null && page !== null) page.event = inShadow[i] ? before : event.js;
    if (hasLegacy) invokeLegacy(event, type | 0, current, L.Capture, page, top);
    else invoke(event, type | 0, current, L.Capture, page, top);
  }
  for (let i = 0; i < path.length; i++) {
    const current = path[i];
    const target = targets === null ? path[0] : targets[i];
    const isTarget = current === target || path.length === 1;
    if (!isTarget && !(event.flags & B.Bubbles)) continue;
    event.target = target;
    if (!(current.listensTo & bubbling) || event.flags & B.Stopped) continue;
    event.phase = isTarget ? 2 : 3;
    if (relateds !== null) event.related = relateds[i];
    if (inShadow !== null && page !== null) page.event = inShadow[i] ? before : event.js;
    if (hasLegacy) invokeLegacy(event, type | 0, current, 0, page, top);
    else invoke(event, type | 0, current, 0, page, top);
  }
  event.phase = 0;
  event.current = event.path = event.depths = null;
  if (page !== null) page.event = before;
  atTopLevel = top;
  realm.page = calling;
}

function finish(event: E): boolean {
  event.flags &= ~(B.Dispatching | B.Stopped | B.StoppedImmediately);
  return !(event.flags & B.Canceled);
}

const isInShadow = (node: N) => (rootOf(node).flags & SHADOW_ROOT) !== 0;

function dispatchToNode(origin: N, event: E): boolean {
  const { related } = event;
  const page = origin.doc.page ?? realm.page;
  if (related !== null && origin !== related && retarget(related, origin) === origin) return finish(event);

  const isClick = (event.flags & B.IsMouse) !== 0 && event.name === "click";
  const path: N[] = [];
  let targets: N[] | null = null;
  let depths: number[] | null = null;
  let activation: N | null = null;
  let target = origin;
  let depth = 0;
  let slotsEntered = 0;
  const end = pathEnd;
  pathEnd = null;
  for (let node: N | null = origin; node !== null && node !== end;) {
    if (isClick && activation === null && node.kind.activate !== null && (node === target || event.flags & B.Bubbles)) {
      if (hooks.canActivate(node)) activation = node;
    }
    if (!(node.flags & USER_AGENT)) {
      path.push(node);
      if (targets !== null) {
        targets.push(target);
        depths!.push(depth);
      }
    }
    let parent: N | null = node.parent;
    if (parent === null) {
      if (!(node.flags & SHADOW_ROOT)) break;
      if (slotsEntered === 0 && !(event.flags & B.Composed) && node === rootOf(origin)) break;
      targets ??= path.map(() => origin);
      depths ??= path.map(() => 0);
      if (scopeOf(node).mode === "closed") depth--;
      parent = hostOf(node);
      if (slotsEntered > 0) slotsEntered--;
      else if (parent === retarget(related, parent)) break;
      else target = parent;
    } else if (parent.flags & HOST && node.rare !== null && node.rare.slot !== null) {
      targets ??= path.map(() => origin);
      depths ??= path.map(() => 0);
      parent = node.rare.slot;
      if (scopeOf(rootOf(parent)).mode === "closed") depth++;
      slotsEntered++;
    }
    node = parent;
  }
  if (path.length === 0) return finish(event);
  if (page === origin.doc.page && path[path.length - 1].type === DOCUMENT && event.name !== "load") {
    path.push(page.target);
    targets?.push(target);
    depths?.push(depth);
  }

  const saved = activation?.kind.beforeActivate?.(activation);
  event.depths = depths;
  let clears = false;
  if (targets !== null || origin.scope !== origin.doc.node) {
    event.inShadow = path.map(isInShadow);
    clears = isInShadow(target);
  }
  if (related !== null && isInShadow(related)) {
    event.relateds = path.map(it => retarget(related, it.type === 0 ? null : it));
    clears ||= isInShadow(retarget(related, target)!);
  }
  run(event, path, targets, page);
  if (clears) event.target = event.related = null;
  else {
    const { relateds } = event;
    if (relateds !== null) event.related = relateds[path.length - 1];
  }
  event.relateds = event.inShadow = null;
  const result = finish(event);
  if (activation !== null) {
    if (result) activation.kind.activate!(activation, event.js, origin, saved);
    else activation.kind.cancelActivate?.(activation, saved);
  }
  return result;
}

function dispatchImpl(target: N, event: E): boolean {
  event.flags |= B.Dispatching;
  if (target.type !== 0) return dispatchToNode(target, event);
  if (event.related !== null) event.related = retarget(event.related, null);
  run(event, [target], null, target.x ?? core.realm.page);
  return finish(event);
}

const timedTypes = new Set<string>(
  core.splitTokens(`auxclick click contextmenu dblclick mousedown mouseenter mouseleave mouseout mouseover mouseup pointerover
  pointerenter pointerdown pointerup pointercancel pointerout pointerleave gotpointercapture lostpointercapture touchstart
  touchend touchcancel keydown keypress keyup beforeinput input compositionstart compositionupdate compositionend dragstart
  dragend dragenter dragleave dragover drop`),
);

/** A trusted event. False if it was canceled. */
function dispatch(target: N, { $impl: event }: Event): boolean {
  event.flags |= B.Trusted;
  if (!atTopLevel || target.type !== core.ELEMENT || !timedTypes.$has(event.name)) return dispatchImpl(target, event);
  const { page } = target.doc;
  const start = performance.now();
  const result = dispatchImpl(target, event);
  page?.timing().dispatchedEvent(event, start);
  return result;
}

/** For targets that are not nodes. The result is whether it was not canceled, and whether a listener threw. */
function dispatchAlong(path: N[], { $impl: event }: Event): [boolean, boolean] {
  event.flags |= B.Trusted | B.Dispatching;
  run(event, path, null, core.realm.page);
  return [finish(event), (event.flags & B.Threw) !== 0];
}

let pathEnd: N | null = null;

/** The event does not get to `end` and what is above it. */
function dispatchBelow(target: N, event: Event, end: N | null): boolean {
  pathEnd = end;
  return dispatch(target, event);
}

/** `load` and `pageshow`, whose target is the document. */
function dispatchToWindowForDocument(page: Page, event: Event) {
  event.$impl.flags |= B.Trusted | B.Dispatching;
  run(event.$impl, [page.target], [page.doc.node], page);
  finish(event.$impl);
}

function fire(target: N, type: string, bubbles = false, cancelable = false, composed = false): boolean {
  if (bubbles ? !isListenedTo(type) : !hasListeners(target, type)) return true;
  return dispatch(target, new Event(type, { bubbles, cancelable, composed }));
}

let adoptedMembers: PropertyDescriptorMap | null = null;

/** A native event, such as a `MessageEvent`, gets the members that depend on the dispatch. */
function adoptNative(event: any): E {
  const bits = (event.bubbles ? B.Bubbles : 0) | (event.cancelable ? B.Cancelable : 0);
  event.$impl = new E(event, event.type, bits | (event.composed ? B.Composed : 0));
  if (adoptedMembers === null) {
    const {
      constructor: _constructor,
      type: _type,
      initEvent: _initEvent,
      isTrusted: _isTrusted,
      ...members
    } = Object.getOwnPropertyDescriptors(Event.prototype);
    adoptedMembers = members;
  }
  Object.defineProperties(event, adoptedMembers);
  return event.$impl;
}

function implOf(event: any): E {
  const impl = $isObject(event) ? event.$impl : undefined;
  if (impl instanceof E) return impl;
  if (event instanceof NativeEvent) return adoptNative(event);
  throw new TypeError("Failed to execute 'dispatchEvent': parameter 1 is not of type 'Event'.");
}

function dispatchFromScript(target: N, event: any, trusted = false): boolean {
  const impl = implOf(event);
  if (impl.flags & (B.Dispatching | B.Uninitialized)) {
    throw domError("InvalidStateError", "The event is already being dispatched, or it is not initialized.");
  }
  const top = atTopLevel;
  atTopLevel = false;
  impl.flags = trusted ? impl.flags | B.Trusted : impl.flags & ~B.Trusted;
  const result = dispatchImpl(target, impl);
  atTopLevel = top;
  return result;
}

function composedPath({ path, depths, current }: E): unknown[] {
  if (path === null) return [];
  if (depths === null) return path.map(wrap);
  const index = path.indexOf(current!);
  const visible: N[] = [current!];
  for (let i = index - 1, allowed = depths[index]; i >= 0; i--) {
    if (depths[i] > allowed) continue;
    allowed = depths[i];
    visible.unshift(path[i]);
  }
  for (let i = index + 1, allowed = depths[index]; i < path.length; i++) {
    if (depths[i] > allowed) continue;
    allowed = depths[i];
    visible.push(path[i]);
  }
  return visible.map(wrap);
}

// ───────────────────────────── handlers ─────────────────────────────

function findHandler(target: N, type: int32): Listener | null {
  for (let it = listenersFor(target, type, 0); it !== null; it = it.next) {
    if (it.type === type && it.flags & L.Handler) return it;
  }
  return null;
}

function setHandler(target: N, type: int32, callback: any, bits: int32) {
  const found = findHandler(target, type);
  if (!$isObject(callback)) {
    if (found !== null) removeListener(target, found);
  } else if (found === null) addListener(target, type, bits, callback);
  else {
    found.callback = callback;
    found.flags = bits;
  }
}

function readHandler(target: N | null | undefined, name: string) {
  const type = types.$get(name);
  const found = target && type !== undefined ? findHandler(target, type | 0) : null;
  return found === null ? null : handlerCallback(found, name);
}

function writeHandler(target: N | null | undefined, name: string, value: unknown) {
  if (target) setHandler(target, eventType(name), value, L.Handler);
}

function ownerOf(self: unknown, property: string): N | null {
  const owner = targetOf(self);
  if (owner === null && !/^on(?:mouseenter|mouseleave|readystatechange)$/.test(property))
    throw new TypeError("Illegal invocation");
  return owner;
}

const timeHandlers = new Set(["onbegin", "onend", "onrepeat"]);

function typeOfHandler(property: string): string {
  if (timeHandlers.$has(property)) return property.slice(2) + "Event";
  return property.startsWith("onwebkit") ? (legacyNames[property.slice(8)] ?? property.slice(2)) : property.slice(2);
}

core.setAccessorFamily(
  core.families.HANDLERS,
  (self: unknown, property: string) => {
    const owner = ownerOf(self, property);
    return owner === null ? undefined : readHandler(owner, typeOfHandler(property));
  },
  (self: unknown, property: string, value: unknown) =>
    writeHandler(ownerOf(self, property), typeOfHandler(property), value),
);
const windowOf = (self: unknown) => ownerOf(self, "")!.doc?.page?.target;
core.setAccessorFamily(
  core.families.WINDOW_HANDLERS,
  (self: unknown, property: string) => readHandler(windowOf(self), property.slice(2)),
  (self: unknown, property: string, value: unknown) => writeHandler(windowOf(self), property.slice(2), value),
);

/** `ofWindow`: they are on an element, and stand for those of its window. */
function defineHandlers(object: object, names: string[], ofWindow = false) {
  const family = ofWindow ? core.families.WINDOW_HANDLERS : core.families.HANDLERS;
  core.defineAccessors(
    object,
    names.map(name => "on" + name),
    family,
    true,
  );
}

const globalHandlers = core.splitTokens(`abort animationcancel animationend animationiteration animationstart auxclick
  beforeinput beforematch beforetoggle blur cancel canplay canplaythrough change click close command
  contentvisibilityautostatechange contextlost contextmenu contextrestored cuechange dblclick drag dragend dragenter
  dragleave dragover dragstart drop durationchange emptied ended error focus formdata gotpointercapture input invalid
  keydown keypress keyup load loadeddata loadedmetadata loadstart lostpointercapture mousedown mouseenter mouseleave
  mousemove mouseout mouseover mouseup mousewheel pause play playing pointercancel pointerdown pointerenter pointerleave
  pointermove pointerout pointerover pointerrawupdate pointerup progress ratechange reset resize scroll scrollend
  securitypolicyviolation seeked seeking select selectionchange selectstart slotchange stalled submit suspend timeupdate
  toggle transitioncancel transitionend transitionrun transitionstart volumechange waiting webkitanimationend
  webkitanimationiteration webkitanimationstart webkittransitionend wheel beforexrselect scrollsnapchange
  scrollsnapchanging`);
const clipboardHandlers = ["copy", "cut", "paste", "beforecopy", "beforecut", "beforepaste"];
const windowHandlers = core.splitTokens(`afterprint beforeprint beforeunload hashchange languagechange message
  messageerror offline online pagehide pagereveal pageshow pageswap popstate rejectionhandled storage unhandledrejection
  unload`);
const reflectedByBody = ["blur", "error", "focus", "load", "resize", "scroll", ...windowHandlers];
const elementHandlerNames = new Set([...globalHandlers, ...clipboardHandlers, "focusin", "focusout"]);

hooks.handlerAttribute = (node, attribute, value) => {
  const name = attribute.slice(2);
  const { page } = node.doc;
  const isWindows =
    node.ns === core.SVG
      ? node.name === "svg" && windowHandlers.includes(name)
      : (core.isHtml(node, "body") || core.isHtml(node, "frameset")) && reflectedByBody.includes(name);
  if (
    isWindows
      ? page === null
      : !elementHandlerNames.$has(name) && !(node.ns === core.SVG && timeHandlers.$has(attribute))
  )
    return;
  const element = wrap(node);
  if (value !== null && page?.host.allowsInline?.("script", value, undefined, true, element) === false) return;
  setHandler(
    isWindows ? page!.target : node,
    eventType(typeOfHandler(attribute)),
    value === null ? null : [value, node, page],
    L.Handler | L.Uncompiled,
  );
};

// ───────────────────────────── classes ─────────────────────────────

class Event {
  declare $impl: E;

  constructor(type: string, init: any = undefined) {
    if (arguments.length === 0) throw new TypeError("Failed to construct 'Event': 1 argument required.");
    let bits: int32 = 0;
    if (init != null) {
      if (!$isObject(init)) throw new TypeError("Failed to construct 'Event': parameter 2 is not a dictionary.");
      bits = (init.bubbles ? B.Bubbles : 0) | (init.cancelable ? B.Cancelable : 0) | (init.composed ? B.Composed : 0);
    }
    this.$impl = new E(this, typeof type === "string" ? type : `${type}`, bits);
  }
  static [Symbol.hasInstance](value: any) {
    if (this !== Event) return Function.prototype[Symbol.hasInstance].$call(this, value);
    return $isObject(value) && (value.$impl instanceof E || value instanceof NativeEvent);
  }
  get type() {
    return this.$impl.name;
  }
  get target() {
    return wrapOrNull(this.$impl.target);
  }
  get srcElement() {
    return wrapOrNull(this.$impl.target);
  }
  get currentTarget() {
    return wrapOrNull(this.$impl.current);
  }
  get eventPhase() {
    return this.$impl.phase;
  }
  get bubbles() {
    return (this.$impl.flags & B.Bubbles) !== 0;
  }
  get cancelable() {
    return (this.$impl.flags & B.Cancelable) !== 0;
  }
  get composed() {
    return (this.$impl.flags & B.Composed) !== 0;
  }
  get isTrusted() {
    return (this.$impl.flags & B.Trusted) !== 0;
  }
  get defaultPrevented() {
    return (this.$impl.flags & B.Canceled) !== 0;
  }
  get timeStamp() {
    return core.coarse(this.$impl.time - core.realm.page.timeOrigin);
  }
  get cancelBubble() {
    return (this.$impl.flags & B.Stopped) !== 0;
  }
  set cancelBubble(value) {
    this.$impl.flags |= value ? B.Stopped : 0;
  }
  get returnValue(): any {
    return !(this.$impl.flags & B.Canceled);
  }
  set returnValue(value) {
    if (!value) cancel(this.$impl);
  }
  composedPath() {
    return composedPath(this.$impl);
  }
  stopPropagation() {
    this.$impl.flags |= B.Stopped;
  }
  stopImmediatePropagation() {
    this.$impl.flags |= B.Stopped | B.StoppedImmediately;
  }
  preventDefault() {
    cancel(this.$impl);
  }
  initEvent(type: string, bubbles = false, cancelable = false) {
    if ($argumentCount() < 1) core.tooFew(1);
    const event = this.$impl;
    if (event.flags & B.Dispatching) return;
    event.name = `${type}`;
    event.flags = (event.flags & B.IsMouse) | (bubbles ? B.Bubbles : 0) | (cancelable ? B.Cancelable : 0);
    event.target = null;
  }
}

const text = (value: unknown): string => (value === undefined ? "" : `${value}`);

function finite(value: any): number {
  const number = +value;
  if (number - number !== 0) throw new TypeError("The provided double value is non-finite.");
  return number;
}

function windowOrNull(value: any) {
  if (value == null) return null;
  if (value.window !== value) throw new TypeError("The provided value is not of type 'Window'.");
  return value;
}

/** From the bit 16 on, like those of the UI library. */
const modifierNames = core.splitTokens("AltGraph CapsLock Fn FnLock Hyper NumLock ScrollLock Super Symbol SymbolLock");

function modifiersOf(init: object): number {
  return modifierNames.reduce((bits, name, index) => (init["modifier" + name] ? bits | (16 << index) : bits), 0);
}

function relatedTarget(event: E) {
  return wrapOrNull(event.related);
}

function setRelated(event: E, value: any) {
  if (value != null && !(value instanceof EventTarget))
    throw new TypeError("The provided value is not of type 'EventTarget'.");
  event.related = value == null ? null : targetOf(value);
}

function scrollOf({ target }: E, axis: number): number {
  return ((target?.type ? target.doc.page : target?.x) ?? core.realm.page).doc.engine.lastViewportScroll(axis);
}

function offsetOf(event: E, x: number, y: number): number[] {
  const { target } = event;
  if (target === null || target.id === 0) return [x + scrollOf(event, 0), y + scrollOf(event, 1)];
  const engine = core.sync(target.doc);
  const [left, top] = engine.toLocal(target.id, x, y);
  return [left - engine.metric(target.id, 0), top - engine.metric(target.id, 1)];
}

/** From the nearest box that is positioned, transformed or scrolls. */
function layerOffset(event: E, client: number, axis: number): number {
  const { target } = event;
  if (target === null || target.id === 0) return client + scrollOf(event, axis);
  const engine = core.sync(target.doc);
  const style = (node: N, name: string) => engine.computedStyle(node.id, "", name);
  for (let at: N | null = target; at !== null && at.type === core.ELEMENT; at = core.flatParent(at)) {
    if (style(at, "position") === "static" && style(at, "transform") === "none" && style(at, "overflow") === "visible")
      continue;
    return Math.round(client - engine.boundingRect(at.id)[axis]);
  }
  return client + scrollOf(event, axis);
}

class CustomEvent extends Event {
  #detail: any = null;

  constructor(type: string, init: any = undefined) {
    if ($argumentCount() < 1) core.tooFew(1);
    super(type, init);
    if (init == null) return;
    this.#detail = init.detail ?? null;
  }
  get detail() {
    return this.#detail;
  }
  initCustomEvent(type: string, bubbles = false, cancelable = false, detail = null) {
    if ($argumentCount() < 1) core.tooFew(1);
    if (this.$impl.flags & B.Dispatching) return;
    this.initEvent(type, bubbles, cancelable);
    this.#detail = detail;
  }
}

class UIEvent extends Event {
  #view: any = null;
  #detail: number = 0;
  #which: number = 0;

  constructor(type: string, init: any = undefined) {
    if ($argumentCount() < 1) core.tooFew(1);
    super(type, init);
    if (init == null) return;
    this.#view = windowOrNull(init.view);
    this.#detail = init.detail | 0;
    this.#which = init.which >>> 0;
  }
  get view() {
    return this.#view;
  }
  get detail() {
    return this.#detail;
  }
  get which() {
    return this.#which;
  }
  get pseudoTarget() {
    return this.$impl.pseudoTarget;
  }
  get sourceCapabilities() {
    return null;
  }
  initUIEvent(type: string, bubbles = false, cancelable = false, view = null, detail = 0) {
    if ($argumentCount() < 1) core.tooFew(1);
    if (this.$impl.flags & B.Dispatching) return;
    this.initEvent(type, bubbles, cancelable);
    this.#view = windowOrNull(view);
    this.#detail = detail | 0;
  }
}

class MouseEvent extends UIEvent {
  #screenX: number = 0;
  #screenY: number = 0;
  #clientX: number = 0;
  #clientY: number = 0;
  #movementX: number = 0;
  #movementY: number = 0;
  #button: number = 0;
  #buttons: number = 0;
  #ctrlKey: boolean = false;
  #shiftKey: boolean = false;
  #altKey: boolean = false;
  #metaKey: boolean = false;
  #modifiers: number = 0;

  constructor(type: string, init: any = undefined) {
    if ($argumentCount() < 1) core.tooFew(1);
    super(type, init);
    this.$impl.flags |= B.IsMouse;
    if (init == null) return;
    setRelated(this.$impl, init.relatedTarget);
    this.#screenX = finite(init.screenX ?? 0);
    this.#screenY = finite(init.screenY ?? 0);
    this.#clientX = finite(init.clientX ?? 0);
    this.#clientY = finite(init.clientY ?? 0);
    this.#movementX = finite(init.movementX ?? 0);
    this.#movementY = finite(init.movementY ?? 0);
    this.#button = (init.button << 16) >> 16;
    this.#buttons = init.buttons & 0xffff;
    this.#ctrlKey = !!init.ctrlKey;
    this.#shiftKey = !!init.shiftKey;
    this.#altKey = !!init.altKey;
    this.#metaKey = !!init.metaKey;
    this.#modifiers = init.modifierBits ?? modifiersOf(init);
  }
  get screenX() {
    return this.#screenX;
  }
  get screenY() {
    return this.#screenY;
  }
  get clientX() {
    return this.#clientX;
  }
  get clientY() {
    return this.#clientY;
  }
  get movementX() {
    return this.#movementX;
  }
  get movementY() {
    return this.#movementY;
  }
  get button() {
    return this.#button;
  }
  get buttons() {
    return this.#buttons;
  }
  get ctrlKey() {
    return this.#ctrlKey;
  }
  get shiftKey() {
    return this.#shiftKey;
  }
  get altKey() {
    return this.#altKey;
  }
  get metaKey() {
    return this.#metaKey;
  }
  get which() {
    return this.#button + 1;
  }
  get x() {
    return this.#clientX;
  }
  get y() {
    return this.#clientY;
  }
  get pageX() {
    return this.#clientX + scrollOf(this.$impl, 0);
  }
  get pageY() {
    return this.#clientY + scrollOf(this.$impl, 1);
  }
  get offsetX() {
    return offsetOf(this.$impl, this.#clientX, this.#clientY)[0];
  }
  get offsetY() {
    return offsetOf(this.$impl, this.#clientX, this.#clientY)[1];
  }
  get layerX() {
    return layerOffset(this.$impl, this.#clientX, 0);
  }
  get layerY() {
    return layerOffset(this.$impl, this.#clientY, 1);
  }
  get relatedTarget() {
    return relatedTarget(this.$impl);
  }
  get fromElement() {
    if (this.type.startsWith("pointer") && this instanceof PointerEvent) return null;
    return this.type === "mouseout" || this.type === "mouseleave" ? this.target : relatedTarget(this.$impl);
  }
  get toElement() {
    if (this.type.startsWith("pointer") && this instanceof PointerEvent) return null;
    return this.type === "mouseout" || this.type === "mouseleave" ? relatedTarget(this.$impl) : this.target;
  }
  getModifierState(key: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    switch ((key = `${key}`)) {
      case "Control":
        return this.#ctrlKey;
      case "Shift":
        return this.#shiftKey;
      case "Alt":
        return this.#altKey;
      case "Meta":
        return this.#metaKey;
      default:
        return ((this.#modifiers >> 4) & (1 << modifierNames.indexOf(key))) !== 0;
    }
  }
  initMouseEvent(
    type: string,
    bubbles = false,
    cancelable = false,
    view = null,
    detail = 0,
    screenX = 0,
    screenY = 0,
    clientX = 0,
    clientY = 0,
    ctrlKey = false,
    altKey = false,
    shiftKey = false,
    metaKey = false,
    button = 0,
    related = null,
  ) {
    if ($argumentCount() < 1) core.tooFew(1);
    if (this.$impl.flags & B.Dispatching) return;
    this.initUIEvent(type, bubbles, cancelable, view, detail);
    this.#screenX = screenX | 0;
    this.#screenY = screenY | 0;
    this.#clientX = clientX | 0;
    this.#clientY = clientY | 0;
    this.#ctrlKey = !!ctrlKey;
    this.#altKey = !!altKey;
    this.#shiftKey = !!shiftKey;
    this.#metaKey = !!metaKey;
    this.#button = (button << 16) >> 16;
    setRelated(this.$impl, related);
  }
}

class PointerEvent extends MouseEvent {
  #pointerId: number = 0;
  #width: number = 1;
  #height: number = 1;
  #pressure: number = 0;
  #tangentialPressure: number = 0;
  #tiltX: number = 0;
  #tiltY: number = 0;
  #twist: number = 0;
  #pointerType: string = "";
  #isPrimary: boolean = false;
  #altitudeAngle: number = Math.PI / 2;
  #azimuthAngle: number = 0;
  #persistentDeviceId: number = 0;
  #coalesced: object[] | null = null;
  #predicted: object[] | null = null;

  constructor(type: string, init: any = undefined) {
    if ($argumentCount() < 1) core.tooFew(1);
    super(type, init);
    if (init == null) return;
    this.#pointerId = init.pointerId | 0;
    this.#width = finite(init.width ?? 1);
    this.#height = finite(init.height ?? 1);
    this.#pressure = Math.fround(finite(init.pressure ?? 0));
    this.#tangentialPressure = Math.fround(finite(init.tangentialPressure ?? 0));
    const { altitudeAngle, azimuthAngle, coalescedEvents, predictedEvents, tiltX, tiltY } = init;
    const hasAngle = altitudeAngle !== undefined || azimuthAngle !== undefined;
    const hasTilt = tiltX !== undefined || tiltY !== undefined;
    if (hasAngle || hasTilt) {
      this.#altitudeAngle = finite(altitudeAngle ?? Math.PI / 2);
      this.#azimuthAngle = finite(azimuthAngle ?? 0);
      this.#tiltX = tiltX | 0;
      this.#tiltY = tiltY | 0;
      if (!hasAngle) [this.#altitudeAngle, this.#azimuthAngle] = anglesOf(this.#tiltX, this.#tiltY);
      if (!hasTilt) [this.#tiltX, this.#tiltY] = tiltsOf(this.#altitudeAngle, this.#azimuthAngle);
    }
    if (coalescedEvents !== undefined) this.#coalesced = [...coalescedEvents];
    if (predictedEvents !== undefined) this.#predicted = [...predictedEvents];
    this.#persistentDeviceId = init.persistentDeviceId | 0;
    this.#twist = init.twist | 0;
    this.#pointerType = text(init.pointerType);
    this.#isPrimary = !!init.isPrimary;
  }
  get pointerId() {
    return this.#pointerId;
  }
  get width() {
    return this.#width;
  }
  get height() {
    return this.#height;
  }
  get pressure() {
    return this.#pressure;
  }
  get tangentialPressure() {
    return this.#tangentialPressure;
  }
  get tiltX() {
    return this.#tiltX;
  }
  get tiltY() {
    return this.#tiltY;
  }
  get twist() {
    return this.#twist;
  }
  get pointerType() {
    return this.#pointerType;
  }
  get isPrimary() {
    return this.#isPrimary;
  }
  get altitudeAngle() {
    return this.#altitudeAngle;
  }
  get azimuthAngle() {
    return this.#azimuthAngle;
  }
  get persistentDeviceId() {
    return this.#persistentDeviceId;
  }
  getCoalescedEvents() {
    const event = this.$impl;
    const { name } = event;
    if (
      this.#coalesced === null &&
      event.flags & B.Trusted &&
      (name === "pointermove" || name === "pointerrawupdate")
    ) {
      const init = {};
      for (const key in this) init[key as string] = this[key];
      const only = new PointerEvent(name, { ...init, bubbles: false, cancelable: false, composed: false });
      only.$impl.flags |= B.Trusted;
      only.$impl.time = event.time;
      only.#coalesced = [];
      this.#coalesced = [Object.setPrototypeOf(only, Object.getPrototypeOf(this))];
    }
    if (event.flags & B.Trusted) for (const it of (this.#coalesced ?? []) as Event[]) it.$impl.target = event.target;
    return [...(this.#coalesced ?? [])];
  }
  getPredictedEvents() {
    return [...(this.#predicted ?? [])];
  }
}

/** https://w3c.github.io/pointerevents/#converting-between-tiltx-tilty-and-altitudeangle-azimuthangle */
function anglesOf(tiltX: number, tiltY: number): [number, number] {
  const [x, y] = [(tiltX * Math.PI) / 180, (tiltY * Math.PI) / 180];
  const isFlat = Math.abs(tiltX) === 90 || Math.abs(tiltY) === 90;
  let azimuth = 0;
  if (tiltX === 0) azimuth = tiltY > 0 ? Math.PI / 2 : tiltY < 0 ? (3 * Math.PI) / 2 : 0;
  else if (tiltY === 0) azimuth = tiltX < 0 ? Math.PI : 0;
  else if (!isFlat && (azimuth = Math.atan2(Math.tan(y), Math.tan(x))) < 0) azimuth += 2 * Math.PI;
  if (isFlat) return [0, azimuth];
  if (tiltX === 0 || tiltY === 0) return [Math.PI / 2 - Math.abs(x + y), azimuth];
  return [Math.atan(1 / Math.hypot(Math.tan(x), Math.tan(y))), azimuth];
}

function tiltsOf(altitude: number, azimuth: number): [number, number] {
  const degrees = (side: number) => {
    if (altitude !== 0) return Math.round((Math.atan(side / Math.tan(altitude)) * 180) / Math.PI) + 0;
    return Math.abs(side) < 1e-9 || azimuth < 0 || azimuth > 2 * Math.PI ? 0 : 90 * Math.sign(side);
  };
  return [degrees(Math.cos(azimuth)), degrees(Math.sin(azimuth))];
}

class WheelEvent extends MouseEvent {
  #deltaX: number = 0;
  #deltaY: number = 0;
  #deltaZ: number = 0;
  #deltaMode: number = 0;

  constructor(type: string, init: any = undefined) {
    if ($argumentCount() < 1) core.tooFew(1);
    super(type, init);
    if (init == null) return;
    this.#deltaX = finite(init.deltaX ?? 0);
    this.#deltaY = finite(init.deltaY ?? 0);
    this.#deltaZ = finite(init.deltaZ ?? 0);
    this.#deltaMode = init.deltaMode >>> 0;
  }
  get deltaX() {
    return this.#deltaX;
  }
  get deltaY() {
    return this.#deltaY;
  }
  get deltaZ() {
    return this.#deltaZ;
  }
  get deltaMode() {
    return this.#deltaMode;
  }
  get wheelDelta() {
    return this.wheelDeltaY || this.wheelDeltaX;
  }
  get wheelDeltaX() {
    return Math.round(-1.2 * this.#deltaX);
  }
  get wheelDeltaY() {
    return Math.round(-1.2 * this.#deltaY);
  }
}

class KeyboardEvent extends UIEvent {
  #key: string = "";
  #code: string = "";
  #location: number = 0;
  #repeat: boolean = false;
  #isComposing: boolean = false;
  #charCode: number = 0;
  #keyCode: number = 0;
  #ctrlKey: boolean = false;
  #shiftKey: boolean = false;
  #altKey: boolean = false;
  #metaKey: boolean = false;
  #modifiers: number = 0;

  constructor(type: string, init: any = undefined) {
    if ($argumentCount() < 1) core.tooFew(1);
    super(type, init);
    if (init == null) return;
    this.#key = text(init.key);
    this.#code = text(init.code);
    this.#location = init.location >>> 0;
    this.#repeat = !!init.repeat;
    this.#isComposing = !!init.isComposing;
    this.#charCode = init.charCode >>> 0;
    this.#keyCode = init.keyCode >>> 0;
    this.#ctrlKey = !!init.ctrlKey;
    this.#shiftKey = !!init.shiftKey;
    this.#altKey = !!init.altKey;
    this.#metaKey = !!init.metaKey;
    this.#modifiers = init.modifierBits ?? modifiersOf(init);
  }
  get key() {
    return this.#key;
  }
  get code() {
    return this.#code;
  }
  get location() {
    return this.#location;
  }
  get repeat() {
    return this.#repeat;
  }
  get isComposing() {
    return this.#isComposing;
  }
  get charCode() {
    return this.#charCode;
  }
  get keyCode() {
    return this.#keyCode;
  }
  get ctrlKey() {
    return this.#ctrlKey;
  }
  get shiftKey() {
    return this.#shiftKey;
  }
  get altKey() {
    return this.#altKey;
  }
  get metaKey() {
    return this.#metaKey;
  }
  get which() {
    return super.which || this.#keyCode || this.#charCode;
  }
  getModifierState(key: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    switch ((key = `${key}`)) {
      case "Control":
        return this.#ctrlKey;
      case "Shift":
        return this.#shiftKey;
      case "Alt":
        return this.#altKey;
      case "Meta":
        return this.#metaKey;
      default:
        return ((this.#modifiers >> 4) & (1 << modifierNames.indexOf(key))) !== 0;
    }
  }
  initKeyboardEvent(
    type: string,
    bubbles = false,
    cancelable = false,
    view = null,
    key = "",
    location = 0,
    ctrlKey = false,
    altKey = false,
    shiftKey = false,
    metaKey = false,
  ) {
    if ($argumentCount() < 1) core.tooFew(1);
    if (this.$impl.flags & B.Dispatching) return;
    this.initUIEvent(type, bubbles, cancelable, view, 0);
    this.#key = `${key}`;
    this.#location = location >>> 0;
    this.#ctrlKey = !!ctrlKey;
    this.#altKey = !!altKey;
    this.#shiftKey = !!shiftKey;
    this.#metaKey = !!metaKey;
  }
}

class FocusEvent extends UIEvent {
  constructor(type: string, init: any = undefined) {
    if ($argumentCount() < 1) core.tooFew(1);
    super(type, init);
    setRelated(this.$impl, init?.relatedTarget);
  }
  get relatedTarget() {
    return relatedTarget(this.$impl);
  }
}

class InputEvent extends UIEvent {
  #data: string | null = null;
  #isComposing: boolean = false;
  #inputType: string = "";
  #dataTransfer: any = null;
  #targetRanges: object[] = [];
  #liveRanges: any[] | null = null;

  constructor(type: string, init: any = undefined) {
    if ($argumentCount() < 1) core.tooFew(1);
    super(type, init);
    if (init == null) return;
    this.#data = init.data == null ? null : `${init.data}`;
    this.#isComposing = !!init.isComposing;
    this.#inputType = text(init.inputType);
    this.#dataTransfer = init.dataTransfer ?? null;
    this.#targetRanges = init.staticRanges ?? [];
    if (init.targetRanges === undefined) return;
    this.#liveRanges = Array.from(init.targetRanges, (it: any) => {
      const range = require("internal/desktop/dom/range").createRange(core.realm.page.doc.node);
      range.setStart(it.startContainer, it.startOffset);
      range.setEnd(it.endContainer, it.endOffset);
      return range;
    });
  }
  get data() {
    return this.#data;
  }
  get isComposing() {
    return this.#isComposing;
  }
  get inputType() {
    return this.#inputType;
  }
  get dataTransfer() {
    return this.#dataTransfer;
  }
  getTargetRanges() {
    const freeze = ({ $impl: it }: any) =>
      require("internal/desktop/dom/range").staticRange(it.startNode, it.startOffset, it.endNode, it.endOffset);
    return this.#liveRanges?.map(freeze) ?? [...this.#targetRanges];
  }
}

class AnimationEvent extends Event {
  #animationName: string = "";
  #elapsedTime: number = 0;
  #pseudoElement: string = "";
  #animation: object | null = null;
  #origin: N | null = null;
  #id: number = 0;

  constructor(type: string, init: any = undefined, origin: any = undefined, id: number = 0) {
    if ($argumentCount() < 1) core.tooFew(1);
    super(type, init);
    if (init == null) return;
    this.#animationName = text(init.animationName);
    this.#elapsedTime = finite(init.elapsedTime ?? 0);
    this.#pseudoElement = text(init.pseudoElement);
    this.#animation = instanceOf("CSSAnimation")(init.animation ?? null);
    if (!(origin instanceof core.N)) return;
    this.#origin = origin;
    this.#id = id;
  }
  get animationName() {
    return this.#animationName;
  }
  get elapsedTime() {
    return this.#elapsedTime;
  }
  get pseudoElement() {
    return this.#pseudoElement;
  }
  get animation() {
    return (this.#animation ??= this.#origin && hooks.animationFor(this.#origin, this.#id, this.#pseudoElement));
  }
  get pseudoTarget() {
    return this.#origin && hooks.pseudoElement(this.#origin, this.#pseudoElement);
  }
}

class TransitionEvent extends Event {
  #propertyName: string = "";
  #elapsedTime: number = 0;
  #pseudoElement: string = "";
  #animation: object | null = null;
  #origin: N | null = null;
  #id: number = 0;

  constructor(type: string, init: any = undefined, origin: any = undefined, id: number = 0) {
    if ($argumentCount() < 1) core.tooFew(1);
    super(type, init);
    if (init == null) return;
    this.#propertyName = text(init.propertyName);
    this.#elapsedTime = finite(init.elapsedTime ?? 0);
    this.#pseudoElement = text(init.pseudoElement);
    this.#animation = instanceOf("CSSTransition")(init.animation ?? null);
    if (!(origin instanceof core.N)) return;
    this.#origin = origin;
    this.#id = id;
  }
  get propertyName() {
    return this.#propertyName;
  }
  get elapsedTime() {
    return this.#elapsedTime;
  }
  get pseudoElement() {
    return this.#pseudoElement;
  }
  get animation() {
    return (this.#animation ??= this.#origin && hooks.animationFor(this.#origin, this.#id, this.#pseudoElement));
  }
  get pseudoTarget() {
    return this.#origin && hooks.pseudoElement(this.#origin, this.#pseudoElement);
  }
}

class BeforeUnloadEvent extends Event {
  #value = "";
  get returnValue(): any {
    return this.#value;
  }
  set returnValue(value) {
    this.#value = String(value);
  }
}

expose(Event, { NONE: 0, CAPTURING_PHASE: 1, AT_TARGET: 2, BUBBLING_PHASE: 3 });
expose(WheelEvent, { DOM_DELTA_PIXEL: 0, DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 });
expose(KeyboardEvent, {
  DOM_KEY_LOCATION_STANDARD: 0,
  DOM_KEY_LOCATION_LEFT: 1,
  DOM_KEY_LOCATION_RIGHT: 2,
  DOM_KEY_LOCATION_NUMPAD: 3,
});
for (const ctor of [Event, CustomEvent, UIEvent, MouseEvent, PointerEvent, WheelEvent, KeyboardEvent, FocusEvent]) {
  expose(ctor);
}
for (const ctor of [InputEvent, AnimationEvent, TransitionEvent, BeforeUnloadEvent]) expose(ctor);

type Conversions = Record<string, (value: any) => unknown>;
const byType = { string: text, number: finite, boolean: Boolean };

/** An event that only has the members of its dictionary. `convert` gets undefined for those whose default that is. */
function simpleEvent(
  name: string,
  defaults: Record<string, any>,
  Base: typeof Event = Event,
  convert: Conversions = {},
): any {
  let read: (self: any, key: string) => unknown;
  const keys = Object.keys(defaults).sort();
  const ctor = {
    [name]: class extends Base {
      #values: Record<string, unknown> = {};
      constructor(type: string, init: any = undefined) {
        if ($argumentCount() < 1) core.tooFew(1);
        super(type, init);
        for (const key of keys) {
          const given = init?.[key];
          const conversion = convert[key] ?? byType[typeof defaults[key]];
          if (given === undefined && defaults[key] !== undefined) this.#values[key] = defaults[key];
          else this.#values[key] = conversion ? conversion(given) : given;
        }
      }
      static {
        read = (self, key) => self.#values[key];
        initialize.$set(name, (self, values) => Object.assign(self.#values, values));
      }
    },
  }[name];
  core.defineGetters(ctor, Object.keys(defaults), read!);
  return expose(ctor);
}

const initialize = new Map<string, (event: any, values: object) => void>();

function lazyEvent(name: string, defaults: Record<string, any>, Base?: typeof Event, convert?: Conversions) {
  return new core.Interface(name, () => simpleEvent(name, defaults, Base, convert));
}

function instanceOf(name: string, isNullable = true) {
  return (value: any) => {
    if (value === null && isNullable) return null;
    for (let it = value; $isObject(it); it = Object.getPrototypeOf(it)) {
      if (Object.getOwnPropertyDescriptor(it, Symbol.toStringTag)?.value === name) return value;
    }
    throw new TypeError(`The provided value is not of type '${name}'.`);
  };
}

const nullableText = (value: unknown) => (value === null ? null : `${value}`);
const wellFormed = (value: unknown) => `${value}`.toWellFormed();

const creatable = new Map<string, string>();
for (const name of core.splitTokens(`BeforeUnload Composition Custom DeviceMotion DeviceOrientation Drag Focus HashChange
  Keyboard Message Mouse Storage Text Touch UI`)) {
  creatable.$set(name.toLowerCase() + "event", name + "Event");
}
for (const name of ["event", "events", "htmlevents", "svgevents"]) creatable.$set(name, "Event");
creatable.$set("mouseevents", "MouseEvent").$set("uievents", "UIEvent");

const lazyErrorEvent = new core.Interface("ErrorEvent", () => {
  class ErrorEvent extends Event {
    #colno: number;
    #error: unknown;
    #filename: string;
    #lineno: number;
    #message: string;

    constructor(type: string, init: any = undefined) {
      if (arguments.length === 0) throw new TypeError("Failed to construct 'ErrorEvent': 1 argument required.");
      super(type, init);
      const { colno, error, filename = "", lineno, message = "" } = init ?? {};
      this.$impl.flags |= B.IsError;
      this.#colno = colno >>> 0;
      this.#error = error;
      this.#filename = `${filename}`.toWellFormed();
      this.#lineno = lineno >>> 0;
      this.#message = `${message}`;
    }
    get message() {
      return this.#message;
    }
    get filename() {
      return this.#filename;
    }
    get lineno() {
      return this.#lineno;
    }
    get colno() {
      return this.#colno;
    }
    get error() {
      return this.#error;
    }
  }
  return expose(ErrorEvent);
});

const lazyStringList = new core.Interface("DOMStringList", () => {
  class DOMStringList {
    declare $impl: string[];

    constructor() {
      core.illegalConstructor();
    }
    get length() {
      return this.$impl.length;
    }
    item(index: number) {
      if (arguments.length === 0) throw new TypeError("Failed to execute 'item': 1 argument required.");
      return this.$impl[index >>> 0] ?? null;
    }
    contains(text: string) {
      if (arguments.length === 0) throw new TypeError("Failed to execute 'contains': 1 argument required.");
      return this.$impl.includes(`${text}`);
    }
  }
  Object.defineProperty(DOMStringList.prototype, Symbol.iterator, {
    value: [].values,
    writable: true,
    configurable: true,
  });
  return expose(DOMStringList);
});

function stringList(strings: string[]) {
  const list = Object.create(lazyStringList.load().prototype);
  $putByIdDirectPrivate(list, "impl", strings);
  strings.forEach((value, i) => Object.defineProperty(list, i, { value, enumerable: true, configurable: true }));
  return list;
}

function createEvent(name: string) {
  const found = creatable.$get(core.asciiLower(name));
  const isExposed = found !== "TouchEvent" || "ontouchstart" in realm.page.window;
  if (found === undefined || !isExposed)
    throw domError("NotSupportedError", `The provided event type ('${name}') is invalid.`);
  const event = new (found === "MessageEvent" ? realm.page.window.MessageEvent : hooks.loadInterface(found))("");
  implOf(event).flags |= B.Uninitialized;
  return event;
}

hooks.fire = fire;

const lazyAnimationPlaybackEvent = lazyEvent("AnimationPlaybackEvent", { currentTime: null, timelineTime: null });
const lazyClipboardEvent = lazyEvent("ClipboardEvent", { clipboardData: null }, Event, {
  clipboardData: instanceOf("DataTransfer"),
});
const lazyCommandEvent = lazyEvent("CommandEvent", { source: null, command: "" }, Event, {
  source: instanceOf("Element"),
});
const lazySnapEvent = lazyEvent("SnapEvent", { snapTargetBlock: null, snapTargetInline: null }, Event, {
  snapTargetBlock: instanceOf("Node"),
  snapTargetInline: instanceOf("Node"),
});
const lazyCompositionEvent = lazyEvent("CompositionEvent", { data: "" }, UIEvent);
const lazyContentVisibilityAutoStateChangeEvent = lazyEvent("ContentVisibilityAutoStateChangeEvent", {
  skipped: false,
});
const lazyDragEvent = lazyEvent("DragEvent", { dataTransfer: null }, MouseEvent, {
  dataTransfer: instanceOf("DataTransfer"),
});
const lazyFontFaceSetLoadEvent = lazyEvent("FontFaceSetLoadEvent", { fontfaces: [] });
const lazyFormDataEvent = lazyEvent("FormDataEvent", { formData: undefined }, Event, {
  formData: instanceOf("FormData", false),
});
const lazyHashChangeEvent = lazyEvent("HashChangeEvent", { oldURL: "", newURL: "" }, Event, {
  oldURL: wellFormed,
  newURL: wellFormed,
});
const lazyMediaQueryListEvent = lazyEvent("MediaQueryListEvent", { media: "", matches: false });
const lazyPageTransitionEvent = lazyEvent("PageTransitionEvent", { persisted: false });
const lazyPageRevealEvent = lazyEvent("PageRevealEvent", { viewTransition: null }, Event, {
  viewTransition: instanceOf("ViewTransition"),
});
const lazyPageSwapEvent = lazyEvent("PageSwapEvent", { activation: null, viewTransition: null }, Event, {
  activation: instanceOf("NavigationActivation"),
  viewTransition: instanceOf("ViewTransition"),
});
const lazyPopStateEvent = lazyEvent("PopStateEvent", { state: null, hasUAVisualTransition: false });
const lazyProgressEvent = lazyEvent("ProgressEvent", { lengthComputable: false, loaded: 0, total: 0 });
const lazyPromiseRejectionEvent = lazyEvent("PromiseRejectionEvent", { promise: undefined, reason: undefined });
const lazyStorageEvent = lazyEvent(
  "StorageEvent",
  { key: null, oldValue: null, newValue: null, url: "", storageArea: null },
  Event,
  {
    key: nullableText,
    oldValue: nullableText,
    newValue: nullableText,
    url: wellFormed,
    storageArea: instanceOf("Storage"),
  },
);
const lazySubmitEvent = lazyEvent("SubmitEvent", { submitter: null }, Event, { submitter: instanceOf("HTMLElement") });
const lazyTextEvent = lazyEvent("TextEvent", { data: "" }, UIEvent);
const lazyToggleEvent = lazyEvent("ToggleEvent", { oldState: "", newState: "", source: null }, Event, {
  source: instanceOf("Element"),
});
lazyEvent("InterestEvent", { source: null }, Event, { source: instanceOf("Element") });
lazyEvent("GamepadEvent", { gamepad: null }, Event, { gamepad: instanceOf("Gamepad") });
lazyEvent("DeviceMotionEvent", {
  acceleration: null,
  accelerationIncludingGravity: null,
  rotationRate: null,
  interval: 0,
});
lazyEvent("DeviceOrientationEvent", { alpha: null, beta: null, gamma: null, absolute: false });

for (const [lazy, method] of [
  [lazyCompositionEvent, "initCompositionEvent"],
  [lazyTextEvent, "initTextEvent"],
] as const) {
  const members = {
    [method](
      this: any,
      type: string,
      bubbles = false,
      cancelable = false,
      view = null,
      data = lazy === lazyTextEvent ? "undefined" : "",
    ) {
      if ($argumentCount() < 1) core.tooFew(1);
      if (this.$impl.flags & B.Dispatching) return;
      this.initUIEvent(type, bubbles, cancelable, view, 0);
      initialize.$get(lazy.name)!(this, { data: `${data}` });
    },
  };
  core.mixin(members, lazy);
}
core.mixin(
  {
    initStorageEvent(
      this: any,
      type: string,
      bubbles = false,
      cancelable = false,
      key = null,
      oldValue = null,
      newValue = null,
      url = "",
      storageArea = null,
    ) {
      if ($argumentCount() < 1) core.tooFew(1);
      if (this.$impl.flags & B.Dispatching) return;
      this.initEvent(type, bubbles, cancelable);
      initialize.$get("StorageEvent")!(this, { key, oldValue, newValue, url: `${url}`, storageArea });
    },
  },
  lazyStorageEvent,
);
for (const lazy of [lazyCommandEvent, lazyToggleEvent]) {
  core.extend(lazy, ({ prototype }) => {
    const { get } = Object.getOwnPropertyDescriptor(prototype, "source")!;
    const members = {
      get source() {
        const { current } = (this as any).$impl as E;
        return wrapOrNull(retarget(core.nodeOf(get!.$call(this)), current?.type ? current : null));
      },
    };
    Object.defineProperties(prototype, Object.getOwnPropertyDescriptors(members));
  });
}

export default {
  AnimationEvent,
  get AnimationPlaybackEvent() {
    return lazyAnimationPlaybackEvent.load();
  },
  BeforeUnloadEvent,
  get ClipboardEvent() {
    return lazyClipboardEvent.load();
  },
  get SnapEvent() {
    return lazySnapEvent.load();
  },
  get CommandEvent() {
    return lazyCommandEvent.load();
  },
  get CompositionEvent() {
    return lazyCompositionEvent.load();
  },
  get ContentVisibilityAutoStateChangeEvent() {
    return lazyContentVisibilityAutoStateChangeEvent.load();
  },
  get DragEvent() {
    return lazyDragEvent.load();
  },
  get ErrorEvent() {
    return lazyErrorEvent.load();
  },
  CustomEvent,
  Event,
  EventTarget,
  FocusEvent,
  get FontFaceSetLoadEvent() {
    return lazyFontFaceSetLoadEvent.load();
  },
  get FormDataEvent() {
    return lazyFormDataEvent.load();
  },
  get HashChangeEvent() {
    return lazyHashChangeEvent.load();
  },
  InputEvent,
  KeyboardEvent,
  get MediaQueryListEvent() {
    return lazyMediaQueryListEvent.load();
  },
  MouseEvent,
  get PageTransitionEvent() {
    return lazyPageTransitionEvent.load();
  },
  PointerEvent,
  get PopStateEvent() {
    return lazyPopStateEvent.load();
  },
  get ProgressEvent() {
    return lazyProgressEvent.load();
  },
  get PromiseRejectionEvent() {
    return lazyPromiseRejectionEvent.load();
  },
  get PageRevealEvent() {
    return lazyPageRevealEvent.load();
  },
  get PageSwapEvent() {
    return lazyPageSwapEvent.load();
  },
  get StorageEvent() {
    return lazyStorageEvent.load();
  },
  get SubmitEvent() {
    return lazySubmitEvent.load();
  },
  get TextEvent() {
    return lazyTextEvent.load();
  },
  get ToggleEvent() {
    return lazyToggleEvent.load();
  },
  TransitionEvent,
  UIEvent,
  WheelEvent,
  callBack,
  clipboardHandlers,
  createEvent,
  defineHandlers,
  afterMicrotasks,
  dispatch,
  dispatchAlong,
  dispatchBelow,
  dispatchFromScript,
  dispatchToNative,
  dispatchToWindowForDocument,
  finite,
  fire,
  forceCancel: (event: Event) => void (event.$impl.flags |= B.Canceled),
  fromEventLoop,
  globalHandlers,
  handlerAttributes: () => [...elementHandlerNames, ...windowHandlers],
  hasBlockingListenerAbove,
  hasListenerAbove,
  hasListeners,
  isHeard,
  isListenedTo,
  microtaskCheckpoint,
  removeAllListeners,
  timedTypes,
  readHandler,
  reflectedByBody,
  simpleEvent,
  stringList,
  get DOMStringList() {
    return lazyStringList.load();
  },
  windowHandlers,
  writeHandler,
};
