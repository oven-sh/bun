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
  onBeforeQuit: Function | undefined;
  onReopen: Function | undefined;
  onMenu: Function | undefined;
};

type NativeGpu = {
  readonly available: boolean;
  readonly name: string | null;
  readonly unifiedMemory: boolean;
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
  renderPass(target: unknown): NativeFrame;
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
};

function unavailable(): never {
  throw new Error("AppKit is only available on macOS");
}
// A call rather than a bare `throw` so the bundler does not treat the rest of
// the module as dead code on other platforms.
if (process.platform !== "darwin") unavailable();

const binding = $rust("appkit.rs", "createBinding") as Binding;
const AppKitView = binding.AppKitView;
const AppKitWindow = binding.AppKitWindow;
const nativeApp = binding.app;
const nativeGpu = binding.gpu;

const ArrayIsArray = Array.isArray;
const ObjectKeys = Object.keys;
const ObjectFreeze = Object.freeze;
const ObjectDefineProperty = Object.defineProperty;
const ObjectGetPrototypeOf = Object.getPrototypeOf;

// bun:appkit/react replaces this so handlers run inside flushSync.
let dispatch: (fn: Function, args: unknown[]) => unknown = (fn, args) => fn.$apply(undefined, args);

function __setEventDispatcher(fn: ((handler: Function, args: unknown[]) => unknown) | null | undefined) {
  dispatch = typeof fn === "function" ? fn : (handler, args) => handler.$apply(undefined, args);
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
// name/badge/menu assigned before NSApp exists are replayed at start.
const pendingAppProps = new Map<string, unknown>();
let appName: string | null = null;
let appBadge: string | null = null;
let keepAlive = false;
let menuSpec: MenuSpec[] | null = null;
// id -> the user's MenuItem, for items without a native `action`.
let menuItems = new Map<number, MenuItem>();

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
  started = true;
  nativeApp.onBeforeQuit = function () {
    let vetoed = false;
    const event = {
      preventDefault() {
        vetoed = true;
      },
    };
    const results = emit("beforequit", [event]);
    for (const r of results) if (r === false) vetoed = true;
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
  for (const [key, value] of pendingAppProps) nativeApp.set(key, value);
  pendingAppProps.clear();
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
      if (typeof action !== "string") throw typeError(`${path}[${i}].action must be a selector string`);
      if (!/^[A-Za-z_][A-Za-z0-9_]*:$/.test(action)) {
        throw typeError(`${path}[${i}].action must be a selector name ending in ":", like "copy:"`);
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
  get name(): string | null {
    return appName;
  },
  set name(value: string | null) {
    if (value != null && typeof value !== "string") throw typeError("app.name must be a string or null");
    appName = value ?? null;
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
    keepAlive = !!value;
    nativeApp.set("keepAlive", keepAlive);
  },
  get badge(): string | null {
    return appBadge;
  },
  set badge(value: string | number | null) {
    appBadge = value == null ? null : String(value);
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
  /** False when no screen is attached (ssh, CI, sandboxes): windows still work but are never shown. */
  get hasDisplay(): boolean {
    ensureStarted();
    return !!nativeApp.hasDisplay;
  },
  get isRunning(): boolean {
    return started;
  },
  /** Number of native views alive; for leak tests. */
  get liveViews(): number {
    return nativeApp.liveViews;
  },
  activate() {
    ensureStarted();
    nativeApp.activate();
  },
  hide() {
    if (started) nativeApp.hide();
  },
  quit() {
    if (started) nativeApp.quit();
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

const commonProps = [
  "hidden",
  "alpha",
  "tooltip",
  "id",
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "grow",
  "background",
  "cornerRadius",
  "border",
];

class View {
  #native: NativeView;
  #parent: Container | Window | null = null;
  #props: Record<string, unknown> = {};
  #kind: string;

  static {
    nativeOf = view => view.#native;
    kindOf = view => view.#kind;
    propsOf = view => view.#props;
    setParentOf = (view, parent) => {
      view.#parent = parent;
    };
    rawParentOf = view => view.#parent;
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
    return this.#native.frame;
  }

  remove(): void {
    const parent = this.#parent;
    if (!parent) return;
    if (parent instanceof Window) parent.content = null;
    else (parent as Container).removeChild(this);
  }

  click(): void {
    this.#native.click();
  }

  snapshot(): Uint8Array | null {
    return this.#native.snapshot();
  }
}

function setProp(view: View, key: string, value: unknown) {
  const props = propsOf(view);
  if (value === undefined) value = null;
  nativeOf(view).set(key, value);
  if (value === null) delete props[key];
  else props[key] = value;
}

/** Defines cached accessors; `live` keys read through to the native control. */
function defineProps(Class: { prototype: object }, keys: string[], live: string[] = []) {
  for (const key of keys) {
    const isLive = live.includes(key);
    registerProp(Class.prototype, key);
    ObjectDefineProperty(Class.prototype, key, {
      get(this: View) {
        if (isLive) return nativeOf(this).get(key);
        const value = propsOf(this)[key];
        return value === undefined ? null : value;
      },
      set(this: View, value: unknown) {
        setProp(this, key, value);
      },
      enumerable: true,
      configurable: true,
    });
  }
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

defineProps(View, commonProps);

// ---------------------------------------------------------------------------
// Containers

class Container extends View {
  #children: View[] = [];

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
    if (!(child instanceof View)) throw typeError(`${kindOf(this)}.insertBefore: child must be a View`);
    for (let ancestor: Container | null = this; ancestor; ancestor = ancestor.parent) {
      if (ancestor === (child as View)) throw typeError("A view cannot contain itself or one of its ancestors");
    }
    const currentParent = rawParentOf(child);
    if (currentParent === this) {
      if (child === before) return;
      // Re-inserting an existing child moves it (React reorders this way).
      this.removeChild(child);
    } else if (currentParent) {
      throw typeError(
        `${kindOf(this)}.insertBefore: this ${kindOf(child)} already has a parent; call remove() on it first`,
      );
    }
    let index: number;
    if (before == null) {
      index = this.#children.length;
    } else {
      index = this.#children.indexOf(before);
      if (index < 0) throw typeError(`${kindOf(this)}.insertBefore: reference view is not a child of this container`);
    }
    nativeOf(this).insertChild(nativeOf(child), index);
    this.#children.splice(index, 0, child);
    setParentOf(child, this);
  }

  removeChild(child: View): void {
    const index = this.#children.indexOf(child);
    if (index < 0) throw typeError(`${kindOf(this)}.removeChild: view is not a child of this container`);
    nativeOf(this).removeChild(nativeOf(child));
    this.#children.splice(index, 1);
    setParentOf(child, null);
  }

  replaceChildren(...views: View[]): void {
    for (let i = this.#children.length - 1; i >= 0; i--) this.removeChild(this.#children[i]);
    for (const view of views) this.insertBefore(view, null);
  }
}
registerProp(Container.prototype, "children");

const stackProps = ["spacing", "padding", "align", "distribution"];

class VStack extends Container {
  constructor(props?: Record<string, unknown>) {
    super("VStack", props);
  }
}
defineProps(VStack, stackProps);

class HStack extends Container {
  constructor(props?: Record<string, unknown>) {
    super("HStack", props);
  }
}
defineProps(HStack, stackProps);

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
defineProps(Group, [...stackProps, "title"]);

class ScrollView extends Container {
  constructor(props?: Record<string, unknown>) {
    super("ScrollView", props);
  }
}
defineProps(ScrollView, ["scrollBars"]);

class SplitView extends Container {
  constructor(props?: Record<string, unknown>) {
    super("SplitView", props);
  }
}
defineProps(SplitView, ["vertical"]);

// ---------------------------------------------------------------------------
// Leaves

class Text extends View {
  constructor(props?: Record<string, unknown> | string) {
    super("Text", typeof props === "string" ? { text: props } : props);
  }
}
defineProps(Text, ["text", "font", "color", "textAlign", "selectable", "lineLimit"]);

class Button extends View {
  constructor(props?: Record<string, unknown> | string) {
    super("Button", typeof props === "string" ? { title: props } : props);
  }
}
defineProps(Button, ["title", "kind", "enabled", "symbol", "keyEquivalent", "font", "tint"]);
defineEvent(Button, "onClick", "onAction", noArgs);

class Checkbox extends View {
  constructor(props?: Record<string, unknown>) {
    super("Checkbox", props);
  }
}
defineProps(Checkbox, ["title", "checked", "enabled", "font"], ["checked"]);
defineEvent(Checkbox, "onChange", "onChange", liveOr("checked"));

class Radio extends View {
  constructor(props?: Record<string, unknown>) {
    super("Radio", props);
  }
}
defineProps(Radio, ["title", "checked", "enabled", "font"], ["checked"]);
defineEvent(Radio, "onChange", "onChange", liveOr("checked"));

class Switch extends View {
  constructor(props?: Record<string, unknown>) {
    super("Switch", props);
  }
}
defineProps(Switch, ["checked"], ["checked"]);
defineEvent(Switch, "onChange", "onChange", liveOr("checked"));

const textFieldProps = ["value", "placeholder", "editable", "enabled", "font", "textAlign", "continuous"];

function defineTextField(Class: { prototype: object }) {
  defineProps(Class, textFieldProps, ["value"]);
  defineEvent(Class, "onChange", "onChange", liveOr("value"));
  defineEvent(Class, "onSubmit", "onSubmit", liveOr("value"));
  defineEvent(Class, "onFocus", "onFocus", noArgs);
  defineEvent(Class, "onBlur", "onBlur", noArgs);
}

class TextField extends View {
  constructor(props?: Record<string, unknown>) {
    super("TextField", props);
  }
}
defineTextField(TextField);

class SecureField extends View {
  constructor(props?: Record<string, unknown>) {
    super("SecureField", props);
  }
}
defineTextField(SecureField);

class SearchField extends View {
  constructor(props?: Record<string, unknown>) {
    super("SearchField", props);
  }
}
defineTextField(SearchField);

class TextEditor extends View {
  constructor(props?: Record<string, unknown>) {
    super("TextEditor", props);
  }
}
defineProps(TextEditor, ["value", "editable", "font", "color"], ["value"]);
defineEvent(TextEditor, "onChange", "onChange", liveOr("value"));

class Slider extends View {
  constructor(props?: Record<string, unknown>) {
    super("Slider", props);
  }
}
defineProps(Slider, ["value", "min", "max", "step", "continuous"], ["value"]);
defineEvent(Slider, "onChange", "onChange", liveOr("value"));

class Picker extends View {
  constructor(props?: Record<string, unknown>) {
    super("Picker", props);
  }
}
defineProps(Picker, ["items", "selectedIndex"], ["selectedIndex"]);
defineEvent(Picker, "onChange", "onChange", liveOr("selectedIndex"));

class Segmented extends View {
  constructor(props?: Record<string, unknown>) {
    super("Segmented", props);
  }
}
defineProps(Segmented, ["items", "selectedIndex"], ["selectedIndex"]);
defineEvent(Segmented, "onChange", "onChange", liveOr("selectedIndex"));

class Progress extends View {
  constructor(props?: Record<string, unknown>) {
    super("Progress", props);
  }
}
defineProps(Progress, ["value", "min", "max", "indeterminate", "running", "spinner"]);

class Image extends View {
  constructor(props?: Record<string, unknown>) {
    super("Image", props);
  }
}
defineProps(Image, ["image", "scaling", "tint", "size"]);

class Divider extends View {
  constructor(props?: Record<string, unknown>) {
    super("Divider", props);
  }
}
defineProps(Divider, ["vertical"]);

class Spacer extends View {
  constructor(props?: Record<string, unknown>) {
    super("Spacer", props);
  }
}
defineProps(Spacer, ["minLength"]);

class Table extends View {
  constructor(props?: Record<string, unknown>) {
    super("Table", props);
  }
}
defineProps(
  Table,
  ["columns", "rows", "selectedIndexes", "multiple", "headerVisible", "alternatingRows", "rowHeight"],
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

/** Natives report these two by `name`; give callers a class to `instanceof` against. */
function asGpuError(error: unknown): unknown {
  const name = (error as Error | null)?.name;
  let Class: typeof GpuCompileError | undefined;
  if (name === "GpuCompileError") Class = GpuCompileError;
  else if (name === "GpuExecutionError") Class = GpuExecutionError;
  if (!Class || error instanceof Class) return error;
  const converted = new Class((error as Error).message, { cause: (error as Error).cause });
  if (typeof (error as Error).stack === "string") converted.stack = (error as Error).stack;
  return converted;
}

const GpuBuffer = binding.GpuBuffer;
const GpuTexture = binding.GpuTexture;
const GpuLibrary = binding.GpuLibrary;
const GpuFunction = binding.GpuFunction;
const GpuRenderPipeline = binding.GpuRenderPipeline;
const GpuComputePipeline = binding.GpuComputePipeline;
const GpuSampler = binding.GpuSampler;
const GpuDepthStencil = binding.GpuDepthStencil;
const GpuFrame = binding.GpuFrame;

/** Re-throws the native's named errors as the exported classes. */
function rethrowTyped(Class: { prototype: any }, method: string) {
  const original = Class.prototype[method];
  Class.prototype[method] = function (this: unknown, ...args: unknown[]) {
    try {
      return original.$apply(this, args);
    } catch (e) {
      throw asGpuError(e);
    }
  };
}

// The only JavaScript between a caller and the natives: `renderPass` unwraps
// a MetalView, and the methods that can fail with a Gpu*Error name its class.
{
  const proto = GpuFrame.prototype;
  const renderPass = proto.renderPass;
  proto.renderPass = function (this: NativeFrame, target: unknown) {
    if (target instanceof MetalView) target = nativeOf(target);
    return renderPass.$call(this, target);
  };
  rethrowTyped(GpuFrame, "pipeline");
  rethrowTyped(GpuFrame, "commitAndWait");
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
      const info = typeof type === "string" && Object.hasOwn(mslTypes, type) ? mslTypes[type] : undefined;
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
      if (!Object.hasOwn(this.fields, key)) throw typeError(`${this.name}.pack: unknown field "${key}"`);
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
    try {
      return nativeGpu.library(source, opts);
    } catch (e) {
      throw asGpuError(e);
    }
  },
  renderPipeline(opts: unknown) {
    try {
      return nativeGpu.renderPipeline(opts);
    } catch (e) {
      throw asGpuError(e);
    }
  },
  computePipeline(fn: unknown, opts?: unknown) {
    try {
      return nativeGpu.computePipeline(fn, opts);
    } catch (e) {
      throw asGpuError(e);
    }
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
defineProps(MetalView, ["clearColor", "preferredFPS", "running"]);
// Native payloads: onFrame(frame, { time, dt, width, height }), onResize({ width, height }).
defineEvent(MetalView, "onFrame", "onFrame", (_native, payload) => payload);
defineEvent(MetalView, "onResize", "onResize", (_native, payload) => payload);

// ---------------------------------------------------------------------------
// Window

/** Native options that stay assignable after creation (each gets an accessor below). */
const windowSettable = [
  "title",
  "width",
  "height",
  "x",
  "y",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "background",
  "alpha",
];
/** Native options fixed once the window exists. */
const windowCreateOnly = [
  "resizable",
  "closable",
  "minimizable",
  "fullSizeContent",
  "titlebarTransparent",
  "titleHidden",
  "restoreName",
];
const windowNativeOptions = [...windowSettable, ...windowCreateOnly];
const windowLiveProps = ["title", "width", "height", "x", "y"];
const windowEvents = ["onClose", "shouldClose", "onResize", "onMove", "onFocus", "onBlur"];

function isWindowProp(key: string): boolean {
  return key === "content" || key === "visible" || windowSettable.includes(key) || windowEvents.includes(key);
}

function contentError(view: unknown): Error | null {
  if (!(view instanceof View)) return typeError("Window.content must be a View or null");
  if (rawParentOf(view)) {
    return typeError(`Window.content: this ${kindOf(view)} already has a parent; call remove() on it first`);
  }
  return null;
}

/** The one place a user-supplied prop name is checked and assigned, for constructors and bun:appkit/react alike. */
function applyProp(target: View | Window, key: string, value: unknown): void {
  if (target instanceof Window) {
    if (windowCreateOnly.includes(key)) {
      throw typeError(`Window.${key} cannot be changed after the window is created`);
    }
    if (!isWindowProp(key)) throw typeError(`Unknown Window option "${key}"`);
  } else if (!hasProp(target, key)) {
    throw typeError(`Unknown property "${key}" for ${kindOf(target)}`);
  }
  (target as any)[key] = value;
}

let windowNativeOf: (window: Window) => NativeWindow;
let windowPropsOf: (window: Window) => Record<string, unknown>;
let windowHandlersOf: (window: Window) => Record<string, Function | undefined>;

class Window {
  #native: NativeWindow;
  #content: View | null = null;
  #props: Record<string, unknown> = {};
  #handlers: Record<string, Function | undefined> = {};

  static {
    windowNativeOf = window => window.#native;
    windowPropsOf = window => window.#props;
    windowHandlersOf = window => window.#handlers;
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
      if (windowSettable.includes(key) && !windowLiveProps.includes(key)) this.#props[key] = value;
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
      const handler = self.#handlers.onClose;
      if (handler) dispatch(handler, []);
    };
    native.shouldClose = function () {
      const handler = self.#handlers.shouldClose;
      if (!handler) return true;
      return dispatch(handler, []) !== false;
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

  set content(view: View | null | undefined) {
    if (view == null) view = null;
    const previous = this.#content;
    if (previous === view) return;
    if (view !== null) {
      const error = contentError(view);
      if (error) throw error;
    }
    this.#native.setContent(view ? nativeOf(view) : null);
    if (previous) setParentOf(previous, null);
    this.#content = view;
    if (view) setParentOf(view, this);
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
  ObjectDefineProperty(Window.prototype, key, {
    get(this: Window) {
      if (live) return windowNativeOf(this).get(key);
      const value = windowPropsOf(this)[key];
      return value === undefined ? null : value;
    },
    set(this: Window, value: unknown) {
      if (value === undefined) value = null;
      windowNativeOf(this).set(key, value);
      if (live) return;
      const props = windowPropsOf(this);
      if (value === null) delete props[key];
      else props[key] = value;
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
  __setEventDispatcher,
  __applyProp: applyProp,
};
