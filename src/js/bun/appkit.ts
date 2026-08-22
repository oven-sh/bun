// Hardcoded module "bun:appkit"
//
// Plain ES classes over three native wrappers (AppKitView, AppKitWindow and
// the AppKitApp singleton). The tree lives here: a parent's #children array
// keeps child Views alive, Window.#content keeps the root, and `openWindows`
// keeps every open Window. The natives only hold weak references back.

type NativeView = {
  set(key: string, value: unknown): void;
  get(key: string): unknown;
  insertChild(child: NativeView, index: number): void;
  removeChild(child: NativeView): void;
  click(): void;
  snapshot(): Uint8Array | null;
  release(): void;
  readonly released: boolean;
  readonly frame: { x: number; y: number; width: number; height: number };
  onAction: Function | undefined;
  onChange: Function | undefined;
  onSubmit: Function | undefined;
  onFocus: Function | undefined;
  onBlur: Function | undefined;
  onSelect: Function | undefined;
  onActivate: Function | undefined;
  onFrame: Function | undefined;
  onResize: Function | undefined;
  readonly drawableSize: { width: number; height: number } | null | undefined;
  draw(): void;
  readonly native: NativeObjCObject;
};

type NativeObjCObject = {
  msgSend(selector: string, ...args: unknown[]): unknown;
  readonly className: string;
  readonly isClass: boolean;
  readonly address: bigint;
  release(): void;
  readonly released: boolean;
  /** `-description`. */
  toString(): string;
};

type NativeObjCClass = {
  msgSend(selector: string, ...args: unknown[]): unknown;
  readonly name: string;
  readonly address: bigint;
  toString(): string;
};

type NativeObjC = NativeObjCObject | NativeObjCClass;

type NativeObjCSelector = {
  readonly name: string;
  toString(): string;
};

type NativeWindow = {
  set(key: string, value: unknown): void;
  get(key: string): unknown;
  setContent(view: NativeView | null): void;
  show(): void;
  hide(): void;
  center(): void;
  focus(): void;
  close(): void;
  snapshot(): Uint8Array | null;
  readonly closed: boolean;
  readonly visible: boolean;
  readonly key: boolean;
  onClose: Function | undefined;
  shouldClose: Function | undefined;
  onResize: Function | undefined;
  onMove: Function | undefined;
  onFocus: Function | undefined;
  onBlur: Function | undefined;
  readonly native: NativeObjCObject;
};

type NativeApp = {
  start(policy: string): void;
  quit(): void;
  activate(): void;
  hide(): void;
  set(key: string, value: unknown): void;
  readonly isDark: boolean;
  readonly hasDisplay: boolean;
  readonly liveViews: number;
  testing(op: string, a?: unknown, b?: unknown): unknown;
  onBeforeQuit: Function | undefined;
  onReopen: Function | undefined;
  onMenu: Function | undefined;
};

type NativeGpu = {
  readonly available: boolean;
  readonly name: string | null;
  readonly unifiedMemory: boolean;
  registerErrors(make: (kind: "compile" | "execution", message: string) => Error): void;
  buffer(data: unknown, opts?: unknown): unknown;
  texture(opts: unknown): unknown;
  library(source: unknown, opts?: unknown): unknown;
  renderPipeline(opts: unknown): unknown;
  computePipeline(fn: unknown, opts?: unknown): unknown;
  sampler(opts?: unknown): unknown;
  depthStencil(opts?: unknown): unknown;
  frame(opts?: unknown): NativeFrame;
};

type NativeFrame = {
  renderPass(target: unknown, options?: unknown): NativeFrame;
  commitAndWait(): void;
  readonly committed: boolean;
};

// The Gpu* classes are the native wrappers themselves; their constructors throw.
type Binding = {
  AppKitView: new (kind: string) => NativeView;
  AppKitWindow: new (options: object) => NativeWindow;
  app: NativeApp;
  gpu: NativeGpu;
  GpuBuffer: Function;
  GpuTexture: Function;
  GpuLibrary: Function;
  GpuFunction: Function;
  GpuRenderPipeline: Function;
  GpuComputePipeline: Function;
  GpuSampler: Function;
  GpuDepthStencil: Function;
  GpuFrame: { prototype: NativeFrame };
  ObjCObject: { prototype: NativeObjCObject };
  ObjCClass: { prototype: NativeObjCClass };
  ObjCSelector: { new (name: string): NativeObjCSelector; prototype: NativeObjCSelector };
  objcLookupClass(name: string): NativeObjCClass;
  objcJs(value: unknown): unknown;
  objcNs(value: unknown): NativeObjCObject | null;
  objcSame(a: unknown, b: unknown): boolean;
};

const binding = $rust("appkit.rs", "createBinding") as Binding;
const AppKitView = binding.AppKitView;
const AppKitWindow = binding.AppKitWindow;
const nativeApp = binding.app;
const nativeGpu = binding.gpu;
// What bun:appkit/react and bun:internal-for-testing reach that is not public API.
const hooks = require("internal/appkit_private") as typeof import("../internal/appkit_private").default;
const { basename } = require("node:path") as typeof import("node:path");

const ArrayIsArray = Array.isArray;
const ObjectKeys = Object.keys;
const ObjectFreeze = Object.freeze;
const ObjectHasOwn = Object.hasOwn;
const ObjectDefineProperty = Object.defineProperty;
const ObjectGetPrototypeOf = Object.getPrototypeOf;

const plainDispatch = (fn: Function, args: unknown[]) => fn.$apply(undefined, args);
// bun:appkit/react replaces this so handlers run inside its batching.
let dispatch: (fn: Function, args: unknown[]) => unknown = plainDispatch;
hooks.setEventDispatcher = function (fn) {
  dispatch = typeof fn === "function" ? fn : plainDispatch;
};
hooks.liveViews = () => nativeApp.liveViews;
hooks.testing = (op, a, b) => nativeApp.testing(op, a, b);

// A listener that throws must not stop the others or change their verdict;
// the error surfaces the way an uncaught one does.
function guarded(fn: Function, args: unknown[]): unknown {
  try {
    return dispatch(fn, args);
  } catch (error) {
    reportError(error);
    return undefined;
  }
}

function typeError(message: string) {
  return new TypeError(message);
}

// ---------------------------------------------------------------------------
// app

type Listener = (...args: unknown[]) => unknown;

const openWindows = new Set<Window>();
const listeners = new Map<string, Set<Listener>>();
const appEvents = ["beforequit", "reopen", "menu"];
let started = false;
let activationPolicy = "regular";
const defaultAppName: string = basename(process.execPath);
let appName = defaultAppName;
let appBadge: string | null = null;
let keepAlive = false;
let menuSpec: MenuSpec[] | null = null;
// id -> the user's MenuItem, for items without a native `action`.
let menuItems = new Map<number, MenuItem>();
// Assigned before NSApp exists; replayed in order at start. `name` is always
// sent so the menu titles and `app.name` agree on the default.
const pendingAppProps = new Map<string, unknown>([["name", appName]]);

function emit(event: string, args: unknown[]): unknown[] {
  const set = listeners.get(event);
  const results: unknown[] = [];
  if (!set) return results;
  for (const fn of Array.from(set)) {
    results.push(dispatch(fn, args));
  }
  return results;
}

function setAppProp(key: string, value: unknown) {
  if (started) nativeApp.set(key, value);
  else pendingAppProps.set(key, value);
}

function ensureStarted() {
  if (started) return;
  nativeApp.onBeforeQuit = function () {
    let vetoed = false;
    const event = {
      preventDefault() {
        vetoed = true;
      },
    };
    const set = listeners.get("beforequit");
    if (set) {
      for (const fn of Array.from(set)) {
        if (guarded(fn, [event]) === false) vetoed = true;
      }
    }
    return !vetoed;
  };
  nativeApp.onReopen = function (hasVisibleWindows: boolean) {
    emit("reopen", [!!hasVisibleWindows]);
  };
  nativeApp.onMenu = function (id: number) {
    const item = menuItems.get(id);
    if (!item) return;
    const { onClick } = item;
    if (typeof onClick === "function") dispatch(onClick, []);
    emit("menu", [item]);
  };
  nativeApp.start(activationPolicy);
  started = true;
  for (const [key, value] of pendingAppProps) {
    pendingAppProps.delete(key);
    nativeApp.set(key, value);
  }
}

type MenuItem = {
  title: string;
  onClick?: () => void;
  action?: string;
  key?: string;
  shift?: boolean;
  option?: boolean;
  control?: boolean;
  command?: boolean;
  enabled?: boolean;
  checked?: boolean;
  submenu?: (MenuItem | "separator")[];
};
type MenuSpec = { title: string; items: (MenuItem | "separator")[] };

// The native side refuses deeper nesting too; checking here also turns a cyclic spec into a clean error.
const MAX_MENU_DEPTH = 16;

function normalizeMenuItems(items: unknown, path: string, registry: Map<number, MenuItem>, depth = 0): object[] {
  if (depth > MAX_MENU_DEPTH) throw typeError(`${path}: submenus nest too deeply`);
  if (!ArrayIsArray(items)) throw typeError(`${path} must be an array`);
  const out: object[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item === "separator" || item === "-" || (item && (item as any).separator === true)) {
      out.push({ separator: true });
      continue;
    }
    if (!item || typeof item !== "object") throw typeError(`${path}[${i}] must be an object or "separator"`);
    const { title, onClick, action, key, shift, option, control, command, enabled, checked, submenu } =
      item as MenuItem;
    if (typeof title !== "string") throw typeError(`${path}[${i}].title must be a string`);
    const normalized: Record<string, unknown> = {
      title,
      key: typeof key === "string" ? key : "",
      shift: !!shift,
      option: !!option,
      control: !!control,
      command: command === undefined ? true : !!command,
      enabled: enabled === undefined ? true : !!enabled,
      checked: !!checked,
    };
    if (onClick !== undefined && typeof onClick !== "function") {
      throw typeError(`${path}[${i}].onClick must be a function`);
    }
    if (onClick !== undefined && action !== undefined) {
      throw typeError(`${path}[${i}]: onClick and action are mutually exclusive`);
    }
    if ((onClick !== undefined || action !== undefined) && submenu !== undefined) {
      throw typeError(`${path}[${i}]: an item with a submenu does not fire onClick or an action`);
    }
    if (action !== undefined) {
      if (typeof action !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*:$/.test(action)) {
        throw typeError(`${path}[${i}].action must be one of the standard action selectors, like "copy:"`);
      }
      normalized.action = action;
    }
    if (submenu !== undefined) {
      normalized.submenu = normalizeMenuItems(submenu, `${path}[${i}].submenu`, registry, depth + 1);
    } else if (action === undefined) {
      const id = registry.size + 1;
      registry.set(id, item as MenuItem);
      normalized.id = id;
    }
    out.push(normalized);
  }
  return out;
}

function normalizeMenus(spec: unknown): { menus: object[]; registry: Map<number, MenuItem> } | null {
  if (spec == null) return null;
  if (!ArrayIsArray(spec)) throw typeError("app.menu must be an array of { title, items } or null");
  const menus: object[] = [];
  const registry = new Map<number, MenuItem>();
  for (let i = 0; i < spec.length; i++) {
    const menu = spec[i];
    if (!menu || typeof menu !== "object" || typeof menu.title !== "string") {
      throw typeError(`app.menu[${i}] must be { title: string, items: [...] }`);
    }
    menus.push({
      title: menu.title,
      items: normalizeMenuItems(menu.items ?? [], `app.menu[${i}].items`, registry),
    });
  }
  return { menus, registry };
}

const app = {
  get name(): string {
    return appName;
  },
  set name(value: string | null | undefined) {
    if (value != null && typeof value !== "string") throw typeError("app.name must be a string or null");
    appName = value == null || value === "" ? defaultAppName : value;
    setAppProp("name", appName);
  },
  get activationPolicy(): string {
    return activationPolicy;
  },
  set activationPolicy(value: string) {
    if (value !== "regular" && value !== "accessory" && value !== "background") {
      throw typeError('app.activationPolicy must be "regular", "accessory" or "background"');
    }
    if (started) nativeApp.set("activationPolicy", value);
    activationPolicy = value;
  },
  get keepAlive(): boolean {
    return keepAlive;
  },
  set keepAlive(value: boolean) {
    const on = !!value;
    // Holding the process open is only useful with the application running to
    // receive events (a menu bar tool with no window yet), so this starts it.
    if (on) ensureStarted();
    keepAlive = on;
    if (started) nativeApp.set("keepAlive", on);
  },
  get badge(): string | null {
    return appBadge;
  },
  set badge(value: string | number | null) {
    appBadge = value == null || value === "" ? null : String(value);
    setAppProp("badge", appBadge);
  },
  get menu(): MenuSpec[] | null {
    return menuSpec;
  },
  set menu(spec: MenuSpec[] | null) {
    const result = normalizeMenus(spec);
    setAppProp("menu", result?.menus ?? null);
    menuItems = result?.registry ?? new Map();
    menuSpec = spec ?? null;
  },
  get windows(): Window[] {
    return [...openWindows];
  },
  get isDark(): boolean {
    return !!nativeApp.isDark;
  },
  get hasDisplay(): boolean {
    return !!nativeApp.hasDisplay;
  },
  get isRunning(): boolean {
    return started;
  },
  activate() {
    ensureStarted();
    nativeApp.activate();
  },
  hide() {
    if (started) nativeApp.hide();
  },
  quit() {
    // Before anything started AppKit there is nobody to ask: plain process.exit().
    nativeApp.quit();
  },
  on(event: string, listener: Listener) {
    if (!appEvents.includes(event)) throw typeError(`Unknown app event "${event}"`);
    if (typeof listener !== "function") throw typeError("listener must be a function");
    let set = listeners.get(event);
    if (!set) listeners.set(event, (set = new Set()));
    set.add(listener);
    return app;
  },
  off(event: string, listener: Listener) {
    listeners.get(event)?.delete(listener);
    return app;
  },
};

// ---------------------------------------------------------------------------
// View

let nativeOf: (view: View) => NativeView;
let kindOf: (view: View) => string;
let propsOf: (view: View) => Record<string, unknown>;
let setParentOf: (view: View, parent: Container | Window | null) => void;
let rawParentOf: (view: View) => Container | Window | null;
let forgetNativeObjectOf: (view: View) => void;

// The props each View class accepts, keyed by prototype. defineProps and
// defineEvent register here; applyProp rejects anything else.
const ownPropKeys = new WeakMap<object, Set<string>>();

function registerProp(proto: object, key: string) {
  let keys = ownPropKeys.get(proto);
  if (!keys) ownPropKeys.set(proto, (keys = new Set()));
  keys.add(key);
}

function hasProp(view: View, key: string): boolean {
  for (let proto = ObjectGetPrototypeOf(view); proto !== null; proto = ObjectGetPrototypeOf(proto)) {
    if (ownPropKeys.get(proto)?.has(key)) return true;
  }
  return false;
}

class View {
  #native: NativeView;
  #parent: Container | Window | null = null;
  #props: Record<string, unknown> = {};
  #kind: string;
  #nativeObject: object | undefined;

  static {
    nativeOf = view => view.#native;
    kindOf = view => view.#kind;
    propsOf = view => view.#props;
    setParentOf = (view, parent) => {
      view.#parent = parent;
    };
    rawParentOf = view => view.#parent;
    forgetNativeObjectOf = view => {
      view.#nativeObject = undefined;
    };
  }

  constructor(kind: string, props?: Record<string, unknown>) {
    if (typeof kind !== "string") {
      throw typeError("View is abstract; construct a concrete view such as VStack, Text or Button");
    }
    this.#kind = kind;
    this.#native = new AppKitView(kind);
    if (props != null) {
      if (typeof props !== "object") throw typeError(`${kind} options must be an object`);
      for (const key of ObjectKeys(props)) {
        const value = props[key];
        if (value === undefined) continue;
        applyProp(this, key, value);
      }
    }
  }

  get parent(): Container | null {
    const parent = this.#parent;
    return parent instanceof Window ? null : (parent as Container | null);
  }

  get window(): Window | null {
    let node: View | Container | Window | null = this;
    while (node && !(node instanceof Window)) node = rawParentOf(node as View);
    return (node as Window | null) ?? null;
  }

  get frame() {
    if (this.#native.released) return { x: 0, y: 0, width: 0, height: 0 };
    return this.#native.frame;
  }

  /** Whether the native view has been freed (React unmounted it); reads keep answering, mutations throw. */
  get released(): boolean {
    return this.#native.released;
  }

  /** The widget's outer NSView (for Table, TextEditor and ScrollView that is the NSScrollView). */
  get native(): object {
    if (this.#native.released) throw $ERR_INVALID_STATE(`${this.#kind} has been released`);
    return (this.#nativeObject = liveHandle(this.#nativeObject) ?? wrapObject(this.#native.native));
  }

  remove(): void {
    const parent = this.#parent;
    if (!parent) return;
    if (parent instanceof Window) parent.content = null;
    else (parent as Container).removeChild(this);
  }

  snapshot(): Uint8Array | null {
    return this.#native.snapshot();
  }
}

// The cache is written before the native call so that a handler the call
// fires synchronously (hiding a focused field ends its editing) reads the new
// value; it is put back if the native side rejects it.
function setProp(view: View, key: string, value: unknown) {
  const props = propsOf(view);
  if (value === undefined) value = null;
  const had = ObjectHasOwn(props, key);
  const previous = props[key];
  if (value === null) delete props[key];
  else props[key] = value;
  try {
    nativeOf(view).set(key, value);
  } catch (e) {
    if (had) props[key] = previous;
    else delete props[key];
    throw e;
  }
}

/**
 * Defines one accessor per key of `defaults`. An unset (or `null`-reset) prop
 * reads as its default; `live` keys read through to the native control instead.
 */
function defineProps(Class: { prototype: object }, defaults: Record<string, unknown>, live: string[] = []) {
  for (const key of ObjectKeys(defaults)) {
    const isLive = live.includes(key);
    const fallback = defaults[key];
    registerProp(Class.prototype, key);
    ObjectDefineProperty(Class.prototype, key, {
      get(this: View) {
        const native = nativeOf(this);
        if (isLive && !native.released) return native.get(key);
        const value = propsOf(this)[key];
        return value === undefined ? (fallback === LIVE ? null : fallback) : value;
      },
      set(this: View, value: unknown) {
        setProp(this, key, value);
      },
      enumerable: true,
      configurable: true,
    });
  }
}

function defineClick(Class: { prototype: object }) {
  ObjectDefineProperty(Class.prototype, "click", {
    value: function click(this: View) {
      nativeOf(this).click();
    },
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

type Slot =
  | "onAction"
  | "onChange"
  | "onSubmit"
  | "onFocus"
  | "onBlur"
  | "onSelect"
  | "onActivate"
  | "onFrame"
  | "onResize";

/**
 * Defines an `on*` handler property backed by a native event slot. `read`
 * turns the native payload arguments into the ones the user's handler receives.
 */
function defineEvent(
  Class: { prototype: object },
  prop: string,
  slot: Slot,
  read: (native: NativeView, payload: unknown[], view: View) => unknown[],
) {
  registerProp(Class.prototype, prop);
  ObjectDefineProperty(Class.prototype, prop, {
    get(this: View) {
      return propsOf(this)[prop] ?? null;
    },
    set(this: View, handler: Function | null | undefined) {
      if (handler != null && typeof handler !== "function") {
        throw typeError(`${kindOf(this)}.${prop} must be a function`);
      }
      const props = propsOf(this);
      const native = nativeOf(this);
      if (handler == null) {
        delete props[prop];
        native[slot] = undefined;
        return;
      }
      props[prop] = handler;
      const view = this;
      native[slot] = function (...payload: unknown[]) {
        const current = propsOf(view)[prop] as Function | undefined;
        if (!current) return;
        return dispatch(current, read(native, payload, view));
      };
    },
    enumerable: true,
    configurable: true,
  });
}

const noArgs = () => [];
const liveOr =
  (key: string) =>
  (native: NativeView, [payload]: unknown[]) => [payload !== undefined ? payload : native.get(key)];
const LIVE = undefined;

defineProps(View, {
  hidden: false,
  alpha: 1,
  tooltip: null,
  id: null,
  width: null,
  height: null,
  minWidth: null,
  maxWidth: null,
  minHeight: null,
  maxHeight: null,
  grow: 0,
  background: null,
  cornerRadius: 0,
  border: null,
});

// ---------------------------------------------------------------------------
// Containers

let childrenOf: (container: Container) => View[];

/** Throws unless `child` is a View this container may take: not an ancestor, and not in another parent. */
function adoptable(container: Container, child: unknown, method: string): void {
  if (!(child instanceof View)) throw typeError(`${kindOf(container)}.${method}: child must be a View`);
  for (let ancestor: Container | null = container; ancestor; ancestor = ancestor.parent) {
    if (ancestor === (child as View)) throw typeError("A view cannot contain itself or one of its ancestors");
  }
  const parent = rawParentOf(child);
  if (parent !== null && parent !== container) {
    throw $ERR_INVALID_STATE(
      `${kindOf(container)}.${method}: this ${kindOf(child)} already has a parent; call remove() on it first`,
    );
  }
}

class Container extends View {
  #children: View[] = [];

  static {
    childrenOf = container => container.#children;
  }

  // `children` cannot go through the View constructor: #children does not
  // exist until super() returns.
  constructor(kind: string, props?: Record<string, unknown>) {
    let children: unknown;
    if (props != null && typeof props === "object") {
      children = props.children;
      if (children !== undefined) props = { ...props, children: undefined };
    }
    super(kind, props);
    if (children !== undefined) this.children = children as View[];
  }

  get children(): readonly View[] {
    return ObjectFreeze(this.#children.slice());
  }

  set children(views: readonly View[]) {
    if (!ArrayIsArray(views)) throw typeError(`${kindOf(this)}.children must be an array of views`);
    this.replaceChildren.$apply(this, views);
  }

  append(...views: View[]): void {
    for (const view of views) this.insertBefore(view, null);
  }

  insertBefore(child: View, before: View | null | undefined): void {
    adoptable(this, child, "insertBefore");
    const children = this.#children;
    // Re-inserting an existing child moves it in place (React reorders this
    // way); natively the view never leaves the window, so it keeps focus.
    const from = children.indexOf(child);
    if (from >= 0 && child === before) return;
    let index: number;
    if (before == null) {
      index = children.length;
    } else {
      index = children.indexOf(before);
      if (index < 0)
        throw $ERR_INVALID_STATE(`${kindOf(this)}.insertBefore: reference view is not a child of this container`);
    }
    // The native index counts the children with the moved one taken out.
    if (from >= 0 && from < index) index--;
    nativeOf(this).insertChild(nativeOf(child), index);
    if (from >= 0) children.splice(from, 1);
    children.splice(index, 0, child);
    setParentOf(child, this);
  }

  // Bookkeeping happens before the native call: removing a focused field fires
  // its onBlur from inside removeChild, and that handler must see the child gone.
  removeChild(child: View): void {
    const children = this.#children;
    const index = children.indexOf(child);
    if (index < 0) throw $ERR_INVALID_STATE(`${kindOf(this)}.removeChild: view is not a child of this container`);
    children.splice(index, 1);
    setParentOf(child, null);
    try {
      nativeOf(this).removeChild(nativeOf(child));
    } catch (e) {
      children.splice(index, 0, child);
      setParentOf(child, this);
      throw e;
    }
  }

  replaceChildren(...views: View[]): void {
    const wanted = new Set<View>();
    for (const view of views) {
      adoptable(this, view, "replaceChildren");
      if (wanted.has(view)) throw typeError(`${kindOf(this)}.replaceChildren: the same view appears twice`);
      wanted.add(view);
    }
    const children = this.#children;
    for (let i = children.length - 1; i >= 0; i--) {
      if (!wanted.has(children[i])) this.removeChild(children[i]);
    }
    for (const view of views) this.insertBefore(view, null);
  }
}
registerProp(Container.prototype, "children");

const stackDefaults = { spacing: 8, padding: 0, align: "fill", distribution: "fill" };

class VStack extends Container {
  constructor(props?: Record<string, unknown>) {
    super("VStack", props);
  }
}
defineProps(VStack, stackDefaults);

class HStack extends Container {
  constructor(props?: Record<string, unknown>) {
    super("HStack", props);
  }
}
defineProps(HStack, { ...stackDefaults, align: "center" });

class ZStack extends Container {
  constructor(props?: Record<string, unknown>) {
    super("View", props);
  }
}

class Group extends Container {
  constructor(props?: Record<string, unknown>) {
    super("Group", props);
  }
}
defineProps(Group, { ...stackDefaults, padding: 4, title: "" });

class ScrollView extends Container {
  constructor(props?: Record<string, unknown>) {
    super("ScrollView", props);
  }
}
defineProps(ScrollView, { scrollBars: ObjectFreeze({ horizontal: false, vertical: true }) });

class SplitView extends Container {
  constructor(props?: Record<string, unknown>) {
    super("SplitView", props);
  }
}
defineProps(SplitView, { vertical: false });

// ---------------------------------------------------------------------------
// Leaves

class Text extends View {
  constructor(props?: Record<string, unknown> | string) {
    super("Text", typeof props === "string" ? { text: props } : props);
  }
}
defineProps(Text, { text: "", font: null, color: null, textAlign: "natural", selectable: false, lineLimit: 1 });

class Button extends View {
  constructor(props?: Record<string, unknown> | string) {
    super("Button", typeof props === "string" ? { title: props } : props);
  }
}
defineProps(Button, {
  title: "",
  kind: "default",
  enabled: true,
  symbol: null,
  keyEquivalent: null,
  font: null,
  tint: null,
});
defineEvent(Button, "onClick", "onAction", noArgs);
defineClick(Button);

const toggleDefaults = { title: "", checked: LIVE, enabled: true, font: null };

class Checkbox extends View {
  constructor(props?: Record<string, unknown>) {
    super("Checkbox", props);
  }
}
defineProps(Checkbox, toggleDefaults, ["checked"]);
defineEvent(Checkbox, "onChange", "onChange", liveOr("checked"));
defineClick(Checkbox);

class Radio extends View {
  constructor(props?: Record<string, unknown>) {
    super("Radio", props);
  }
}
defineProps(Radio, toggleDefaults, ["checked"]);
defineEvent(Radio, "onChange", "onChange", liveOr("checked"));
defineClick(Radio);

class Switch extends View {
  constructor(props?: Record<string, unknown>) {
    super("Switch", props);
  }
}
defineProps(Switch, { checked: LIVE }, ["checked"]);
defineEvent(Switch, "onChange", "onChange", liveOr("checked"));
defineClick(Switch);

// SecureField and SearchField are TextFields natively too; these tokens let
// their constructors pick the kind without opening that up to callers.
const secureKind = Symbol("SecureField");
const searchKind = Symbol("SearchField");

class TextField extends View {
  constructor(props?: Record<string, unknown>, kind?: symbol) {
    super(kind === secureKind ? "SecureField" : kind === searchKind ? "SearchField" : "TextField", props);
  }
}
defineProps(
  TextField,
  {
    value: LIVE,
    placeholder: null,
    editable: true,
    enabled: true,
    font: null,
    textAlign: "natural",
    continuous: true,
  },
  ["value"],
);
defineEvent(TextField, "onChange", "onChange", liveOr("value"));
defineEvent(TextField, "onSubmit", "onSubmit", liveOr("value"));
defineEvent(TextField, "onFocus", "onFocus", noArgs);
defineEvent(TextField, "onBlur", "onBlur", noArgs);

class SecureField extends TextField {
  constructor(props?: Record<string, unknown>) {
    super(props, secureKind);
  }
}

class SearchField extends TextField {
  constructor(props?: Record<string, unknown>) {
    super(props, searchKind);
  }
}

class TextEditor extends View {
  constructor(props?: Record<string, unknown>) {
    super("TextEditor", props);
  }
}
defineProps(TextEditor, { value: LIVE, editable: true, font: null, color: null }, ["value"]);
defineEvent(TextEditor, "onChange", "onChange", liveOr("value"));

class Slider extends View {
  constructor(props?: Record<string, unknown>) {
    super("Slider", props);
  }
}
defineProps(Slider, { value: LIVE, min: 0, max: 1, step: 0, continuous: true }, ["value"]);
defineEvent(Slider, "onChange", "onChange", liveOr("value"));

const emptyList = ObjectFreeze([]);

class Picker extends View {
  constructor(props?: Record<string, unknown>) {
    super("Picker", props);
  }
}
defineProps(Picker, { items: emptyList, selectedIndex: LIVE }, ["selectedIndex"]);
defineEvent(Picker, "onChange", "onChange", liveOr("selectedIndex"));

class Segmented extends View {
  constructor(props?: Record<string, unknown>) {
    super("Segmented", props);
  }
}
defineProps(Segmented, { items: emptyList, selectedIndex: LIVE }, ["selectedIndex"]);
defineEvent(Segmented, "onChange", "onChange", liveOr("selectedIndex"));

class Progress extends View {
  constructor(props?: Record<string, unknown>) {
    super("Progress", props);
  }
}
defineProps(Progress, { value: 0, min: 0, max: 100, indeterminate: false, running: true, spinner: false });

class Image extends View {
  constructor(props?: Record<string, unknown>) {
    super("Image", props);
  }
}
defineProps(Image, { image: null, scaling: "down", tint: null, size: 0 });

class Divider extends View {
  constructor(props?: Record<string, unknown>) {
    super("Divider", props);
  }
}
defineProps(Divider, { vertical: null });

class Spacer extends View {
  constructor(props?: Record<string, unknown>) {
    super("Spacer", props);
  }
}
defineProps(Spacer, { minLength: 0 });

class Table extends View {
  constructor(props?: Record<string, unknown>) {
    super("Table", props);
  }
}
defineProps(
  Table,
  {
    columns: emptyList,
    rows: emptyList,
    selectedIndexes: LIVE,
    multiple: false,
    headerVisible: null,
    alternatingRows: false,
    rowHeight: null,
  },
  ["selectedIndexes"],
);
defineEvent(Table, "onSelect", "onSelect", liveOr("selectedIndexes"));
defineEvent(Table, "onActivate", "onActivate", (_native, [row]) => [row]);

// ---------------------------------------------------------------------------
// Metal

class GpuCompileError extends Error {}
ObjectDefineProperty(GpuCompileError.prototype, "name", {
  value: "GpuCompileError",
  configurable: true,
  writable: true,
});
class GpuExecutionError extends Error {}
ObjectDefineProperty(GpuExecutionError.prototype, "name", {
  value: "GpuExecutionError",
  configurable: true,
  writable: true,
});
nativeGpu.registerErrors((kind, message) =>
  kind === "compile" ? new GpuCompileError(message) : new GpuExecutionError(message),
);

const GpuBuffer = binding.GpuBuffer;
const GpuTexture = binding.GpuTexture;
const GpuLibrary = binding.GpuLibrary;
const GpuFunction = binding.GpuFunction;
const GpuRenderPipeline = binding.GpuRenderPipeline;
const GpuComputePipeline = binding.GpuComputePipeline;
const GpuSampler = binding.GpuSampler;
const GpuDepthStencil = binding.GpuDepthStencil;
const GpuFrame = binding.GpuFrame;

// The only JavaScript between a caller and the natives: `renderPass` unwraps a MetalView.
{
  const proto = GpuFrame.prototype;
  const renderPass = proto.renderPass;
  proto.renderPass = function (this: NativeFrame, target: unknown, options?: unknown) {
    if (target instanceof MetalView) target = nativeOf(target);
    return renderPass.$call(this, target, options);
  };
}

// MSL size/alignment (Metal Shading Language spec §2): 3-wide vectors take the
// room of 4-wide ones, and a matrix is `columns` column vectors.
type Scalar = "f32" | "f16" | "i32" | "u32" | "i16" | "u16" | "u8" | "bool";
type TypeInfo = { size: number; align: number; scalar: Scalar; count: number; columns: number; rows: number };
const scalarBytes: Record<Scalar, number> = { f32: 4, f16: 2, i32: 4, u32: 4, i16: 2, u16: 2, u8: 1, bool: 1 };
function vec(scalar: Scalar, n: number): TypeInfo {
  const width = scalarBytes[scalar] * (n === 3 ? 4 : n);
  return { size: width, align: width, scalar, count: n, columns: 1, rows: n };
}
function mat(scalar: Scalar, columns: number, rows: number): TypeInfo {
  const column = vec(scalar, rows);
  return { size: column.size * columns, align: column.align, scalar, count: columns * rows, columns, rows };
}
const mslTypes: Record<string, TypeInfo> = {
  bool: vec("bool", 1),
  uchar4: vec("u8", 4),
  short: vec("i16", 1),
  ushort: vec("u16", 1),
  half: vec("f16", 1),
  half2: vec("f16", 2),
  half3: vec("f16", 3),
  half4: vec("f16", 4),
  int: vec("i32", 1),
  int2: vec("i32", 2),
  int3: vec("i32", 3),
  int4: vec("i32", 4),
  uint: vec("u32", 1),
  uint2: vec("u32", 2),
  uint3: vec("u32", 3),
  uint4: vec("u32", 4),
  float: vec("f32", 1),
  float2: vec("f32", 2),
  float3: vec("f32", 3),
  float4: vec("f32", 4),
  float2x2: mat("f32", 2, 2),
  float3x3: mat("f32", 3, 3),
  float4x4: mat("f32", 4, 4),
};

type StructField = { name: string; type: string; offset: number; size: number; align: number; info: TypeInfo };

const alignUp = (n: number, align: number) => Math.ceil(n / align) * align;

function writeScalar(view: DataView, at: number, scalar: Scalar, value: unknown, path: string) {
  if (scalar === "bool") {
    if (typeof value !== "boolean" && typeof value !== "number") throw typeError(`${path} must be a boolean`);
    view.setUint8(at, value ? 1 : 0);
    return;
  }
  if (typeof value !== "number") throw typeError(`${path} must be a number`);
  switch (scalar) {
    case "f32":
      return view.setFloat32(at, value, true);
    case "f16":
      return view.setFloat16(at, value, true);
    case "i32":
      return view.setInt32(at, value, true);
    case "u32":
      return view.setUint32(at, value, true);
    case "i16":
      return view.setInt16(at, value, true);
    case "u16":
      return view.setUint16(at, value, true);
    case "u8":
      return view.setUint8(at, value);
  }
}

class StructLayout {
  readonly name: string;
  readonly size: number;
  readonly align: number;
  readonly fields: Readonly<Record<string, Readonly<StructField>>>;
  #order: StructField[];

  constructor(spec: Record<string, string>, name: string) {
    if (!spec || typeof spec !== "object" || ArrayIsArray(spec)) {
      throw typeError("gpu.struct(fields) expects an object mapping field names to MSL type names");
    }
    if (typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw typeError("gpu.struct(fields, name): name must be an identifier");
    }
    const order: StructField[] = [];
    const fields: Record<string, StructField> = {};
    let offset = 0;
    let align = 1;
    for (const key of ObjectKeys(spec)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
        throw typeError(`gpu.struct: field name "${key}" is not an identifier`);
      const type = spec[key];
      const info = typeof type === "string" && ObjectHasOwn(mslTypes, type) ? mslTypes[type] : undefined;
      if (!info) {
        throw typeError(
          `gpu.struct: field "${key}" has unknown type ${JSON.stringify(type)}; expected one of ${ObjectKeys(mslTypes).join(", ")}`,
        );
      }
      offset = alignUp(offset, info.align);
      const field = ObjectFreeze({ name: key, type, offset, size: info.size, align: info.align, info });
      order.push(field);
      fields[key] = field;
      offset += info.size;
      const fieldAlign = info.align;
      if (fieldAlign > align) align = fieldAlign;
    }
    if (order.length === 0) throw typeError("gpu.struct(fields) needs at least one field");
    this.name = name;
    this.align = align;
    this.size = alignUp(offset, align);
    this.fields = ObjectFreeze(fields);
    this.#order = order;
  }

  /** The matching MSL declaration, ready to paste into shader source. */
  get msl(): string {
    let out = `struct ${this.name} {\n`;
    for (const f of this.#order) out += `  ${f.type} ${f.name};\n`;
    return out + "};";
  }

  pack(values: Record<string, unknown>, target?: ArrayBufferLike | ArrayBufferView | null, byteOffset: number = 0) {
    if (!values || typeof values !== "object") throw typeError(`${this.name}.pack(values) expects an object`);
    let buffer: ArrayBufferLike;
    let base: number;
    let room: number;
    if (target === undefined || target === null) {
      buffer = new ArrayBuffer(this.size);
      base = 0;
      room = this.size;
      target = buffer;
    } else if (target instanceof ArrayBuffer || target instanceof SharedArrayBuffer) {
      buffer = target;
      base = 0;
      room = target.byteLength;
    } else if (ArrayBuffer.isView(target)) {
      buffer = target.buffer;
      base = target.byteOffset;
      room = target.byteLength;
    } else {
      throw typeError(`${this.name}.pack: target must be an ArrayBuffer or a typed array`);
    }
    if (typeof byteOffset !== "number" || !(byteOffset >= 0) || byteOffset % 1 !== 0) {
      throw new RangeError(`${this.name}.pack: byteOffset must be a non-negative integer`);
    }
    const { size } = this;
    if (byteOffset + size > room) {
      throw new RangeError(
        `${this.name}.pack: ${size} bytes at offset ${byteOffset} do not fit in a target of ${room} bytes`,
      );
    }
    for (const key of ObjectKeys(values)) {
      if (!ObjectHasOwn(this.fields, key)) throw typeError(`${this.name}.pack: unknown field "${key}"`);
    }
    const view = new DataView(buffer, base + byteOffset, this.size);
    for (const field of this.#order) {
      const value = values[field.name];
      if (value === undefined) continue;
      const { scalar, count, columns, rows } = field.info;
      const path = `${this.name}.${field.name}`;
      const step = scalarBytes[scalar];
      if (count === 1) {
        // A one-element array is fine for a scalar too.
        const v =
          typeof value === "object" && value !== null && (value as ArrayLike<unknown>).length === 1
            ? (value as ArrayLike<unknown>)[0]
            : value;
        writeScalar(view, field.offset, scalar, v, path);
        continue;
      }
      const list = value as ArrayLike<unknown>;
      if (typeof list !== "object" || list === null || typeof list.length !== "number") {
        throw typeError(`${path} must be an array or typed array of ${count} numbers (${field.type})`);
      }
      // Matrices are column-major; each column is padded like a vector, so a
      // 3-row column takes 4 slots. Accept both the tight and the padded form.
      const paddedRows = rows === 3 ? 4 : rows;
      let stride: number;
      if (list.length === count) stride = rows;
      else if (list.length === columns * paddedRows) stride = paddedRows;
      else {
        const shape = paddedRows === rows ? String(count) : `${count} (or ${columns * paddedRows} padded)`;
        throw typeError(`${path} must have ${shape} elements for ${field.type}, got ${list.length}`);
      }
      for (let c = 0; c < columns; c++) {
        const columnAt = field.offset + c * paddedRows * step;
        for (let r = 0; r < rows; r++) {
          writeScalar(view, columnAt + r * step, scalar, list[c * stride + r], `${path}[${c * stride + r}]`);
        }
      }
    }
    return target;
  }
}

// Every native member throws `TypeError: Metal is not available` without a
// device, except the three getters.
const gpu = {
  get available(): boolean {
    return nativeGpu.available;
  },
  get name(): string | null {
    return nativeGpu.name;
  },
  get unifiedMemory(): boolean {
    return nativeGpu.unifiedMemory;
  },
  buffer(data: unknown, opts?: unknown) {
    return nativeGpu.buffer(data, opts);
  },
  texture(opts: unknown) {
    return nativeGpu.texture(opts);
  },
  library(source: unknown, opts?: unknown) {
    return nativeGpu.library(source, opts);
  },
  renderPipeline(opts: unknown) {
    return nativeGpu.renderPipeline(opts);
  },
  computePipeline(fn: unknown, opts?: unknown) {
    return nativeGpu.computePipeline(fn, opts);
  },
  sampler(opts?: unknown) {
    return nativeGpu.sampler(opts);
  },
  depthStencil(opts?: unknown) {
    return nativeGpu.depthStencil(opts);
  },
  frame(opts?: unknown) {
    return nativeGpu.frame(opts);
  },
  /** Pure layout math; works without a GPU. */
  struct(fields: Record<string, string>, name: string = "Uniforms") {
    return new StructLayout(fields, name);
  },
};

class MetalView extends View {
  constructor(props?: Record<string, unknown>) {
    super("MetalView", props);
  }

  /** Drawable size in pixels (points × backing scale). */
  get drawableSize(): { width: number; height: number } {
    return nativeOf(this).drawableSize ?? { width: 0, height: 0 };
  }

  get gpu() {
    return gpu;
  }

  /** Render one frame now: runs `onFrame` synchronously. How headless code and tests drive the view. */
  draw(): void {
    nativeOf(this).draw();
  }
}
defineProps(MetalView, { clearColor: "#000000", preferredFPS: 60, running: true });
// Native payloads: onFrame(frame, { time, dt, width, height }), onResize({ width, height }).
defineEvent(MetalView, "onFrame", "onFrame", (_native, payload) => payload);
defineEvent(MetalView, "onResize", "onResize", (_native, payload) => payload);

// React deletes whole subtrees; each deleted view comes through here once, in
// no particular order, so only the JavaScript links are undone (the container
// is going too) before the NSView is freed.
function releaseView(view: View): void {
  if (!(view instanceof View)) throw typeError("releaseView: argument must be a View");
  const native = nativeOf(view);
  if (native.released) return;
  const parent = rawParentOf(view);
  if (parent instanceof Container) {
    const siblings = childrenOf(parent);
    const index = siblings.indexOf(view);
    if (index >= 0) siblings.splice(index, 1);
  } else if (parent instanceof Window && windowContentOf(parent) === view) {
    setWindowContent(parent, null);
  }
  setParentOf(view, null);
  if (view instanceof Container) {
    const children = childrenOf(view);
    for (const child of children) setParentOf(child, null);
    children.length = 0;
  }
  // Handlers go (they hold closures); plain props stay so getters keep answering.
  const props = propsOf(view);
  for (const key of ObjectKeys(props)) if (typeof props[key] === "function") delete props[key];
  forgetNativeObjectOf(view);
  native.release();
}

// ---------------------------------------------------------------------------
// Window

/** Native options that stay assignable after creation, with what each reads as until assigned. */
const windowDefaults: Record<string, unknown> = {
  title: LIVE,
  width: LIVE,
  height: LIVE,
  x: LIVE,
  y: LIVE,
  minWidth: null,
  minHeight: null,
  maxWidth: null,
  maxHeight: null,
  background: "windowBackground",
  alpha: 1,
};
const windowSettable = ObjectKeys(windowDefaults);
/** Native options fixed once the window exists; readable afterwards, and this is what they read as if not given. */
const windowCreateOnlyDefaults: Record<string, unknown> = {
  resizable: true,
  closable: true,
  minimizable: true,
  fullSizeContent: false,
  titlebarTransparent: false,
  titleHidden: false,
  restoreName: null,
};
const windowCreateOnly = ObjectFreeze(ObjectKeys(windowCreateOnlyDefaults));
const windowNativeOptions = [...windowSettable, ...windowCreateOnly];
const windowLiveProps = ["title", "width", "height", "x", "y"];
const windowEvents = ["onClose", "shouldClose", "onResize", "onMove", "onFocus", "onBlur"];

function isWindowProp(key: string): boolean {
  return key === "content" || key === "visible" || windowSettable.includes(key) || windowEvents.includes(key);
}

function contentError(view: unknown): Error | null {
  if (!(view instanceof View)) return typeError("Window.content must be a View or null");
  if (rawParentOf(view)) {
    return $ERR_INVALID_STATE(`Window.content: this ${kindOf(view)} already has a parent; call remove() on it first`);
  }
  return null;
}

/** The one place a user-supplied prop name is checked and assigned, for constructors and bun:appkit/react alike. */
function applyProp(target: View | Window, key: string, value: unknown): void {
  if (target instanceof Window) {
    if (!isWindowProp(key) && !windowCreateOnly.includes(key)) throw typeError(`Unknown Window option "${key}"`);
  } else if (!(target instanceof View)) {
    throw typeError("applyProp: target must be a View or a Window");
  } else if (!hasProp(target, key)) {
    throw typeError(`Unknown property "${key}" for ${kindOf(target)}`);
  }
  (target as any)[key] = value;
}

let windowNativeOf: (window: Window) => NativeWindow;
let windowPropsOf: (window: Window) => Record<string, unknown>;
let windowHandlersOf: (window: Window) => Record<string, Function | undefined>;
let windowContentOf: (window: Window) => View | null;
let setWindowContent: (window: Window, view: View | null) => void;

class Window {
  #native: NativeWindow;
  #content: View | null = null;
  #props: Record<string, unknown> = {};
  #handlers: Record<string, Function | undefined> = {};
  #nativeObject: object | undefined;

  static {
    windowNativeOf = window => window.#native;
    windowPropsOf = window => window.#props;
    windowHandlersOf = window => window.#handlers;
    windowContentOf = window => window.#content;
    setWindowContent = (window, view) => {
      window.#content = view;
    };
  }

  constructor(options: Record<string, unknown> = {}) {
    if (options == null) options = {};
    if (typeof options !== "object") throw typeError("Window options must be an object");
    for (const key of ObjectKeys(options)) {
      if (!isWindowProp(key) && !windowCreateOnly.includes(key)) throw typeError(`Unknown Window option "${key}"`);
    }
    for (const key of windowEvents) {
      if (options[key] != null && typeof options[key] !== "function")
        throw typeError(`Window.${key} must be a function`);
    }
    const initialContent = options.content;
    if (initialContent != null) {
      const error = contentError(initialContent);
      if (error) throw error;
    }
    ensureStarted();

    const nativeOptions: Record<string, unknown> = {};
    for (const key of windowNativeOptions) {
      const value = options[key];
      if (value === undefined) continue;
      nativeOptions[key] = value;
      if (!windowLiveProps.includes(key) && value !== null) this.#props[key] = value;
    }

    const native = (this.#native = new AppKitWindow(nativeOptions));
    openWindows.add(this);

    const self = this;
    native.onClose = function () {
      openWindows.delete(self);
      const content = self.#content;
      if (content) {
        setParentOf(content, null);
        self.#content = null;
      }
      self.#nativeObject = undefined;
      const handler = self.#handlers.onClose;
      if (handler) dispatch(handler, []);
    };
    native.shouldClose = function () {
      const handler = self.#handlers.shouldClose;
      if (!handler) return true;
      return guarded(handler, []) !== false;
    };
    native.onResize = function (size: { width: number; height: number }) {
      const handler = self.#handlers.onResize;
      if (handler) dispatch(handler, [size]);
    };
    native.onMove = function (position: { x: number; y: number }) {
      const handler = self.#handlers.onMove;
      if (handler) dispatch(handler, [position]);
    };
    native.onFocus = function () {
      const handler = self.#handlers.onFocus;
      if (handler) dispatch(handler, []);
    };
    native.onBlur = function () {
      const handler = self.#handlers.onBlur;
      if (handler) dispatch(handler, []);
    };

    for (const key of windowEvents) {
      if (options[key] !== undefined) (this as any)[key] = options[key];
    }
    if (initialContent !== undefined) this.content = initialContent as View | null;
    if (options.visible !== false) this.show();
  }

  get content(): View | null {
    return this.#content;
  }

  // Links are switched before the native call so that a handler it fires (the
  // old content's focused field blurring) already sees the new content.
  set content(view: View | null | undefined) {
    if (view == null) view = null;
    const previous = this.#content;
    if (previous === view) return;
    if (view !== null) {
      const error = contentError(view);
      if (error) throw error;
    }
    this.#content = view;
    if (previous) setParentOf(previous, null);
    if (view) setParentOf(view, this);
    try {
      this.#native.setContent(view ? nativeOf(view) : null);
    } catch (e) {
      if (this.#content === view) {
        this.#content = previous;
        if (view) setParentOf(view, null);
        if (previous) setParentOf(previous, this);
      }
      throw e;
    }
  }

  get visible(): boolean {
    return this.#native.visible;
  }

  set visible(value: boolean) {
    if (value) this.show();
    else this.hide();
  }

  get closed(): boolean {
    return this.#native.closed;
  }

  get key(): boolean {
    return this.#native.key;
  }

  /** The NSWindow. */
  get native(): object {
    if (this.#native.closed) throw $ERR_INVALID_STATE("window is closed");
    return (this.#nativeObject = liveHandle(this.#nativeObject) ?? wrapObject(this.#native.native));
  }

  show(): void {
    this.#native.show();
  }

  hide(): void {
    this.#native.hide();
  }

  center(): void {
    this.#native.center();
  }

  focus(): void {
    this.#native.focus();
  }

  close(): void {
    this.#native.close();
  }

  snapshot(): Uint8Array | null {
    return this.#native.snapshot();
  }
}

for (const key of windowSettable) {
  const live = windowLiveProps.includes(key);
  const fallback = windowDefaults[key];
  ObjectDefineProperty(Window.prototype, key, {
    get(this: Window) {
      if (live) return windowNativeOf(this).get(key);
      const value = windowPropsOf(this)[key];
      return value === undefined ? fallback : value;
    },
    set(this: Window, value: unknown) {
      if (value === undefined) value = null;
      if (live) {
        windowNativeOf(this).set(key, value);
        return;
      }
      const props = windowPropsOf(this);
      const had = ObjectHasOwn(props, key);
      const previous = props[key];
      if (value === null) delete props[key];
      else props[key] = value;
      try {
        windowNativeOf(this).set(key, value);
      } catch (e) {
        if (had) props[key] = previous;
        else delete props[key];
        throw e;
      }
    },
    enumerable: true,
    configurable: true,
  });
}

for (const key of windowCreateOnly) {
  const fallback = windowCreateOnlyDefaults[key];
  ObjectDefineProperty(Window.prototype, key, {
    get(this: Window) {
      const value = windowPropsOf(this)[key];
      return value === undefined ? fallback : value;
    },
    set(this: Window, _value: unknown) {
      throw typeError(`Window.${key} cannot be changed after the window is created`);
    },
    enumerable: true,
    configurable: true,
  });
}

for (const key of windowEvents) {
  ObjectDefineProperty(Window.prototype, key, {
    get(this: Window) {
      return windowHandlersOf(this)[key] ?? null;
    },
    set(this: Window, handler: Function | null | undefined) {
      if (handler != null && typeof handler !== "function") throw typeError(`Window.${key} must be a function`);
      windowHandlersOf(this)[key] = handler ?? undefined;
    },
    enumerable: true,
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// objc: any Objective-C class and selector by name, for what the classes
// above do not cover. Natives (binding.ObjCObject / ObjCClass) are handed out
// wrapped in a Proxy whose string properties are selectors. The proxy target
// is the native itself: that keeps it (and the id it retains) alive, lets the
// native side see through proxies passed back as arguments, and is what
// console.log shows.

const ObjCObject = binding.ObjCObject;
const ObjCClass = binding.ObjCClass;
const ObjCSelector = binding.ObjCSelector;
const objcPointer = Symbol("objc.pointer");

// The natives' own methods, taken once so that a script reaching the shared
// prototype through Object.getPrototypeOf(handle) cannot reroute sends.
const getter = (proto: object, name: string) => Object.getOwnPropertyDescriptor(proto, name)!.get!;
const { msgSend: objectMsgSend, toString: objectToString, release: objectRelease } = ObjCObject.prototype;
const objectClassName = getter(ObjCObject.prototype, "className");
const objectIsClass = getter(ObjCObject.prototype, "isClass");
const objectAddress = getter(ObjCObject.prototype, "address");
const objectReleased = getter(ObjCObject.prototype, "released");
const { msgSend: classMsgSend, toString: classToString } = ObjCClass.prototype;
const className = getter(ObjCClass.prototype, "name");
const classAddress = getter(ObjCClass.prototype, "address");

const isClassNative = (native: NativeObjC): native is NativeObjCClass => native instanceof ObjCClass;
const nativeToString = (native: NativeObjC): string =>
  isClassNative(native) ? classToString.$call(native) : objectToString.$call(native);
const nativeAddress = (native: NativeObjC): bigint =>
  isClassNative(native) ? classAddress.$call(native) : objectAddress.$call(native);

/** native wrapper -> its proxy, so one wrapper always surfaces as the same object. */
const proxyOfNative = new WeakMap<object, object>();
/** proxy -> native wrapper. */
const nativeOfProxy = new WeakMap<object, NativeObjC>();
/** Classes are immortal, so their proxies are shared by name. */
const classProxies = new Map<string, object>();

/**
 * `setFrame_display_` -> `setFrame:display:` taking 2 arguments. Leading
 * underscores are kept, an interior `__` is a literal `_`, and every other
 * `_` is a `:`.
 */
function selectorFromProperty(property: string): { selector: string; colons: number } {
  const length = property.length;
  let lead = 0;
  while (lead < length && property.charCodeAt(lead) === 95) lead++;
  let end = length;
  while (end > lead && property.charCodeAt(end - 1) === 95) end--;
  const trailing = length - end;
  let selector = property.slice(0, lead);
  let colons = trailing;
  for (let i = lead; i < end; i++) {
    if (property.charCodeAt(i) !== 95) {
      selector += property[i];
    } else if (i + 1 < end && property.charCodeAt(i + 1) === 95) {
      selector += "_";
      i++;
    } else {
      selector += ":";
      colons++;
    }
  }
  for (let i = 0; i < trailing; i++) selector += ":";
  return { selector, colons };
}

function receiverName(native: NativeObjC): string {
  if (isClassNative(native)) return `+[${className.$call(native)}`;
  return `${objectIsClass.$call(native) ? "+" : "-"}[${objectClassName.$call(native)}`;
}

/**
 * Arguments go to the native side as they are, for it to convert by the
 * method's signature or reject. A View or Window is caught here because the
 * native side would only see an object it cannot convert; the likely intent
 * was its `.native`.
 */
function argumentOf(value: unknown): unknown {
  if (value instanceof View) {
    throw typeError(`pass view.native (the NSView) rather than the ${kindOf(value)} itself`);
  }
  if (value instanceof Window) {
    throw typeError("pass window.native (the NSWindow) rather than the Window itself");
  }
  return value;
}

/** Natives (at any depth of an array/object the native side built) become proxies, in place. */
function fromNative(value: unknown): unknown {
  if (typeof value !== "object" || value === null || nativeOfProxy.has(value)) return value;
  if (value instanceof ObjCObject || value instanceof ObjCClass) return wrapObject(value);
  if (ArrayIsArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = fromNative(value[i]);
    return value;
  }
  if (ObjectGetPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    for (const key of ObjectKeys(record)) record[key] = fromNative(record[key]);
  }
  return value;
}

function send(native: NativeObjC, selector: string, args: ArrayLike<unknown>): unknown {
  const argv: unknown[] = [selector];
  for (let i = 0; i < args.length; i++) argv.push(argumentOf(args[i]));
  return fromNative((isClassNative(native) ? classMsgSend : objectMsgSend).$apply(native, argv));
}

function selectorMethod(native: NativeObjC, property: string): Function {
  const { selector, colons } = selectorFromProperty(property);
  return function (...args: unknown[]) {
    const { length } = args;
    if (length !== colons) {
      throw typeError(
        `${receiverName(native)} ${selector}]: "${property}" stands for a selector taking ${colons} argument${colons === 1 ? "" : "s"}, but ${length} ${length === 1 ? "was" : "were"} passed`,
      );
    }
    return send(native, selector, args);
  };
}

/**
 * The few string properties that are not selectors. `toJSON` matters:
 * JSON.stringify would otherwise send `toJSON:`. `release` is the wrapper's:
 * the native side refuses the reference-counting selectors.
 */
function reservedMethod(native: NativeObjC, property: string): Function | undefined {
  switch (property) {
    case "msgSend":
      return function msgSend(selector: unknown, ...args: unknown[]) {
        if (typeof selector !== "string" || selector.length === 0) {
          throw typeError("msgSend(selector, ...args): selector must be a non-empty string");
        }
        return send(native, selector, args);
      };
    case "toString":
      return function toString() {
        return nativeToString(native);
      };
    case "toJSON":
      return function toJSON() {
        const converted = binding.objcJs(native);
        return converted === native ? nativeToString(native) : fromNative(converted);
      };
    case "release":
      if (!isClassNative(native)) {
        return function release() {
          objectRelease.$call(native);
        };
      }
  }
  return undefined;
}

function wrapObject(native: NativeObjC): object {
  let proxy = proxyOfNative.get(native);
  if (proxy !== undefined) return proxy;
  const isClass = isClassNative(native);
  if (isClass) {
    proxy = classProxies.get(className.$call(native));
    if (proxy !== undefined) return proxy;
  }
  const methods = new Map<string, Function>();
  // `-description` for an object, the name for a class.
  const toPrimitive = () => nativeToString(native);
  proxy = new Proxy(native, {
    get(_target, property) {
      if (typeof property === "string") {
        // Not a thenable: promises resolve with the object itself.
        if (property === "then") return undefined;
        let method = methods.get(property);
        if (method === undefined) {
          method = reservedMethod(native, property) ?? selectorMethod(native, property);
          methods.set(property, method);
        }
        return method;
      }
      if (property === objcPointer) return nativeAddress(native);
      if (property === Symbol.toPrimitive) return toPrimitive;
      if (property === Symbol.toStringTag) return isClass ? "ObjCClass" : "ObjCObject";
      return undefined;
    },
    set(_target, property) {
      throw typeError(
        `Cannot assign to ${String(property)} on an Objective-C object; call the setter, e.g. setTitle_(value)`,
      );
    },
    defineProperty() {
      throw typeError("Cannot define properties on an Objective-C object");
    },
    deleteProperty() {
      throw typeError("Cannot delete properties of an Objective-C object");
    },
  });
  proxyOfNative.set(native, proxy);
  nativeOfProxy.set(proxy, native);
  if (isClass) classProxies.set(className.$call(native), proxy);
  return proxy;
}

/** The cached `.native` handle of a view or window, unless the script released it. */
function liveHandle(handle: object | undefined): object | undefined {
  return handle !== undefined && objectReleased.$call(nativeOfProxy.get(handle)) ? undefined : handle;
}

const objcClassesName = () => "[objc.classes]";
const objcClasses = new Proxy(Object.create(null) as Record<string, object>, {
  get(_target, name) {
    // The names JavaScript itself probes (await, String(), JSON.stringify)
    // are never class names.
    if (name === "then") return undefined;
    if (name === "toString" || name === "toJSON" || name === Symbol.toPrimitive) return objcClassesName;
    if (typeof name !== "string") return undefined;
    let proxy = classProxies.get(name);
    if (proxy === undefined) {
      proxy = wrapObject(binding.objcLookupClass(name));
      classProxies.set(name, proxy);
    }
    return proxy;
  },
  set() {
    throw typeError("objc.classes is read-only");
  },
  defineProperty() {
    throw typeError("objc.classes is read-only");
  },
  deleteProperty() {
    throw typeError("objc.classes is read-only");
  },
});

const objc = {
  classes: objcClasses,
  pointer: objcPointer,
  sel(name: string): NativeObjCSelector {
    if (typeof name !== "string" || name.length === 0) {
      throw typeError("objc.sel(name): name must be a non-empty string");
    }
    return new ObjCSelector(name);
  },
  js(value: unknown): unknown {
    const converted = binding.objcJs(value);
    return converted === value ? value : fromNative(converted);
  },
  ns(value: unknown): object | null {
    return fromNative(binding.objcNs(argumentOf(value))) as object | null;
  },
  /** The same live `id`; a handle is also the same as itself, and nothing else compares. */
  same(a: unknown, b: unknown): boolean {
    return binding.objcSame(a, b) || (a === b && typeof a === "object" && a !== null && nativeOfProxy.has(a));
  },
};

hooks.applyProp = applyProp;
hooks.releaseView = releaseView;
hooks.windowCreateOnly = windowCreateOnly;

export default {
  app,
  Window,
  View,
  Container,
  VStack,
  HStack,
  ZStack,
  Group,
  ScrollView,
  SplitView,
  Text,
  Button,
  Checkbox,
  Radio,
  Switch,
  TextField,
  SecureField,
  SearchField,
  TextEditor,
  Slider,
  Picker,
  Segmented,
  Progress,
  Image,
  Divider,
  Spacer,
  Table,
  MetalView,
  gpu,
  GpuBuffer,
  GpuTexture,
  GpuLibrary,
  GpuFunction,
  GpuRenderPipeline,
  GpuComputePipeline,
  GpuSampler,
  GpuDepthStencil,
  GpuFrame,
  GpuCompileError,
  GpuExecutionError,
  objc,
};
