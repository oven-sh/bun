const EventEmitter = require("node:events");
const native = require("internal/desktop/native");
const { allocateSurfaceId } = require("internal/desktop/surfaces");
const { app, Event, closeCancelled, emitCancelable } = require("internal/desktop/app");
const { Window, kAttach, kBare, kContent, kDetach, kOcclusionChanged, kStyle } = require("internal/desktop/window");
const { WebContents, kPrivate, webContents } = require("internal/desktop/electron/web_contents");
const { inert, properties, queueTask, unsupported } = require("internal/desktop/electron/stubs");

type Rectangle = { x: number; y: number; width: number; height: number };

const kView = Symbol("view");

/** To 0xRRGGBBAA. Alpha comes first in hexadecimal, unlike in CSS. */
function parseColor(text: string) {
  const css = String(text).replace(/^#([\da-f])([\da-f]{3})$|^#([\da-f]{2})([\da-f]{6})$/i, "#$2$4$1$3");
  const [r, g, b, a] = Bun.color(css, "[rgba]") ?? [255, 255, 255, 255];
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

class View extends EventEmitter {
  #children: View[] = [];
  #parent: View | undefined;
  #bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
  #visible = true;
  #radius = 0;
  #surface = 0;
  #shownIn: BaseWindow | undefined;
  #sent = "";

  [kView] = {
    /** The window that this is the content view of. */
    root: undefined as BaseWindow | undefined,
    setSurface: (surface: number) => void (this.#surface = surface),
    window: (): BaseWindow | undefined => this[kView].root ?? this.#parent?.[kView].window(),
    isVisible: (): boolean => this.#visible && (this.#parent?.[kView].isVisible() ?? true),
    titlebarArea: () => {
      const area = this[kView].window()?.[kView].titlebarArea();
      if (!area) return;
      const { x, y } = this.#origin();
      return { ...area, x: area.x - x, y: area.y - y };
    },
    release: () => {
      this.#show(undefined);
      this.#surface = 0;
    },
    /** Puts the surfaces of the tree in `window`, in the order in which they are painted. */
    arrange: (window: BaseWindow | undefined, index = 0): number => {
      if (this.#show(window, index)) index++;
      for (const child of this.#children) index = child[kView].arrange(window, index);
      return index;
    },
    changed() {},
  };

  #origin(): { x: number; y: number } {
    const { x, y } = this.#parent ? this.#parent.#origin() : (this[kView].root?.[kContent] ?? { x: 0, y: 0 });
    return { x: x + this.#bounds.x, y: y + this.#bounds.y };
  }

  #show(window: BaseWindow | undefined, index = 0) {
    if (!this.#surface) return false;
    if (this.#shownIn && this.#shownIn !== window && !this.#shownIn.isDestroyed())
      this.#shownIn[kDetach](this.#surface);
    this.#shownIn = window;
    this.#place();
    window?.[kAttach](this.#surface, index);
    this[kView].changed();
    return true;
  }

  #place() {
    if (!this.#surface) return;
    const settings = {
      id: this.#surface,
      bounds: { ...this.#bounds, ...this.#origin() },
      visible: this[kView].isVisible(),
      radius: this.#radius,
    };
    const text = JSON.stringify(settings);
    if (text !== this.#sent) native.send("surface.set", settings);
    this.#sent = text;
  }

  #placeTree() {
    this.#place();
    this[kView].changed();
    for (const child of this.#children) child.#placeTree();
  }

  #rearrange() {
    const window = this[kView].window();
    if (window && !window.isDestroyed()) (window as any).contentView[kView].arrange(window);
  }

  get children() {
    return [...this.#children];
  }

  addChildView(view: View, index?: number) {
    if (!(view instanceof View)) throw new TypeError("Error processing argument at index 0, conversion failure");
    if (view === this) throw new Error("A view cannot be added as its own child");
    if (view.#parent) view.#parent.#children.splice(view.#parent.#children.indexOf(view), 1);
    view.#parent = this;
    this.#children.splice(index ?? this.#children.length, 0, view);
    if (this[kView].window()) this.#rearrange();
    else view[kView].arrange(undefined);
  }

  removeChildView(view: View) {
    if (!this.#children.includes(view)) return;
    this.#children.splice(this.#children.indexOf(view), 1);
    view.#parent = undefined;
    view[kView].arrange(undefined);
  }

  setBounds({ x = 0, y = 0, width = 0, height = 0 }: Rectangle) {
    const before = this.#bounds;
    if (x === before.x && y === before.y && width === before.width && height === before.height) return;
    this.#bounds = { x, y, width, height };
    this.#placeTree();
    this.emit("bounds-changed");
  }

  getBounds() {
    return { ...this.#bounds };
  }

  setBackgroundColor(color: string) {
    if (!this.#surface && !(this instanceof WebContentsView)) {
      this.#surface = allocateSurfaceId();
      native.send("surface.create", { id: this.#surface, width: 0, height: 0 });
      native.send("surface.set", { id: this.#surface, passthrough: true });
      backgrounds.register(this, this.#surface);
      this.#rearrange();
    }
    if (this.#surface) native.send("surface.set", { id: this.#surface, background: parseColor(color) });
  }

  setBackgroundBlur() {}

  setBorderRadius(radius: number) {
    this.#radius = radius;
    this.#place();
  }

  setVisible(visible: boolean) {
    this.#visible = !!visible;
    this.#placeTree();
  }

  getVisible() {
    return this.#visible;
  }
}
const backgrounds = new FinalizationRegistry<number>(surface => native.destroySurface(surface));

class WebContentsView extends View {
  #webContents;

  get webContents() {
    return this.#webContents[kPrivate].isGone ? undefined : this.#webContents;
  }

  constructor(options: any = {}) {
    super();
    this.#webContents = options.webContents ?? new WebContents(options.webPreferences, options[kView] ?? "browserView");
    const state = this.#webContents[kPrivate];
    if (state.view) throw new TypeError("options.webContents is already attached to a window");
    state.type = options[kView] ?? "browserView";
    state.view = this[kView];
    this[kView].setSurface(state.surface);
    this[kView].changed = state.environmentChanged;
    if (state.type !== "window" && !state.preferences.transparent) this.setBackgroundColor("#fff");
  }

  setBackgroundColor(color: string) {
    super.setBackgroundColor(color);
    const state = this.#webContents[kPrivate];
    state.background = parseColor(color);
    state.guest?.backgroundChanged();
  }
}

class ImageView extends View {
  setImage = unsupported.throws("ImageView");
}

const toCssColor = (color: string) => "#" + parseColor(color).toString(16).padStart(8, "0");

class BaseWindow extends Window {
  #contentView!: View;
  #backgroundColor: string;
  #overlay: any;
  #insets = process.platform === "darwin" ? [78, 0] : [0, process.platform === "win32" ? 138 : 113];
  #flags: Record<string, boolean>;

  constructor(options: any = {}) {
    super({
      focus: options.focusable,
      ...options,
      backgroundColor: options.backgroundColor ? toCssColor(options.backgroundColor) : undefined,
      [kBare]: true,
    });
    this.#flags = {
      autoHideMenuBar: !!options.autoHideMenuBar,
      contentProtected: false,
      enabled: true,
      focusable: options.focusable !== false,
      fullScreenable: options.fullscreenable !== false,
      hiddenInMissionControl: !!options.hiddenInMissionControl,
      kiosk: !!options.kiosk,
      maximizable: options.maximizable !== false,
      minimizable: options.minimizable !== false,
      movable: options.movable !== false,
      shadow: options.hasShadow !== false,
    };
    this.#backgroundColor =
      options.backgroundColor ?? (options.transparent || options.vibrancy ? "#00000000" : "#FFFFFF");
    this.setBackgroundColor(this.#backgroundColor);
    this.setContentView(new View());
    const { titleBarOverlay } = options;
    if (titleBarOverlay && (options.titleBarStyle ?? "default") !== "default") {
      this.#overlay = titleBarOverlay === true ? {} : { ...titleBarOverlay };
      this.#drawOverlay();
    }
    if (options.x === undefined && options.center !== false) this.center();

    const internal = (names: (string | symbol)[], listener: () => void) =>
      names.forEach(name => this[kView].listeners.set(name as any, listener));
    internal(["content-resized"], () => this.#layOut());
    internal(["show"], () => this.#drawOverlay());
    internal(
      [
        "focus",
        "blur",
        "hide",
        "minimize",
        "restore",
        "move",
        "enter-full-screen",
        "leave-full-screen",
        kOcclusionChanged,
      ],
      () => this.#eachView(view => view[kView].changed()),
    );
  }

  [kView] = {
    /** `removeAllListeners()` must not reach these. */
    listeners: new Map<string, () => void>(),
    titlebarArea: () => {
      if (!this.#overlay || this.isDestroyed() || this.isFullScreen()) return;
      const { width } = this[kContent];
      const [left, right] = this.#insets;
      return { x: left, y: 0, width: width - left - right, height: this.#titlebarHeight() };
    },
  };

  #titlebarHeight(): number {
    return this.#overlay.height || (process.platform === "darwin" ? 28 : 30);
  }

  #drawOverlay() {
    if (this.#overlay && process.platform !== "darwin") {
      const { color, symbolColor } = this.#overlay;
      const value = {
        height: this.#titlebarHeight(),
        color: color && parseColor(color),
        symbolColor: symbolColor && parseColor(symbolColor),
      };
      this.#insets = native.ask("window.overlay", { id: this.id, value }) ?? this.#insets;
    }
    this.#eachView(view => view[kView].changed());
  }

  emit(name: string, ...args: unknown[]) {
    // The constructor of the base class emits before the fields exist.
    this[kView]?.listeners.get(name)?.();
    if (args.length === 0) args = [new Event()];
    const result = super.emit(name, ...args);
    if (process.platform !== "linux" && (name === "move" || name === "resize"))
      super.emit(name.replace(/e$/, "ed"), new Event());
    return result;
  }

  #eachView(callback: (view: View) => void, view = this.#contentView) {
    callback(view);
    for (const child of view.children) this.#eachView(callback, child);
  }

  #layOut() {
    const { width, height } = this[kContent];
    this.#contentView.setBounds({ x: 0, y: 0, width, height });
    this.#contentView[kView].arrange(this);
  }

  static getAllWindows() {
    return Window.getAllWindows().filter(window => window instanceof this);
  }

  static getFocusedWindow() {
    const window = Window.getFocusedWindow();
    return window instanceof this ? window : null;
  }

  static fromId(id: number) {
    const window = Window.fromId(id);
    return window instanceof this ? window : null;
  }

  getContentView() {
    return this.#contentView;
  }

  setContentView(view: View) {
    if (this.#contentView) {
      this.#contentView[kView].root = undefined;
      this.#contentView[kView].arrange(undefined);
    }
    this.#contentView = view;
    view[kView].root = this;
    this.#layOut();
  }

  destroy() {
    if (this.isDestroyed()) return;
    this.#contentView[kView].arrange(undefined);
    super.destroy();
  }

  getBackgroundColor() {
    return "#" + (parseColor(this.#backgroundColor) >>> 8).toString(16).padStart(6, "0").toUpperCase();
  }

  setBackgroundColor(color: string) {
    this.#backgroundColor = color;
    super.setBackgroundColor(toCssColor(color));
  }

  setTitleBarOverlay(options: object) {
    if (!this.#overlay) throw new Error("Titlebar overlay is not enabled");
    Object.assign(this.#overlay, options);
    this.#drawOverlay();
  }

  setContentBounds(bounds: Rectangle) {
    this.setBounds(bounds);
  }

  setAutoHideMenuBar(hide: boolean) {
    this.#flags.autoHideMenuBar = !!hide;
    this.setMenuBarVisibility(!hide);
  }

  setContentProtection(on: boolean) {
    super.setContentProtection((this.#flags.contentProtected = !!on));
  }

  setKiosk(on: boolean) {
    this.setFullScreen((this.#flags.kiosk = !!on));
  }

  setAlwaysOnTop(on: boolean, level?: string, relativeLevel?: number) {
    const changed = !!on !== this.isAlwaysOnTop();
    super.setAlwaysOnTop(on, level, relativeLevel);
    if (changed) this.emit("always-on-top-changed", new Event(), !!on);
  }

  static {
    const flags = {
      autoHideMenuBar: ["isMenuBarAutoHide", "setAutoHideMenuBar"],
      contentProtected: ["isContentProtected", "setContentProtection"],
      enabled: ["isEnabled", "setEnabled"],
      focusable: ["isFocusable", "setFocusable"],
      fullScreenable: ["isFullScreenable", "setFullScreenable"],
      hiddenInMissionControl: ["isHiddenInMissionControl", "setHiddenInMissionControl"],
      kiosk: ["isKiosk", "setKiosk"],
      maximizable: ["isMaximizable", "setMaximizable"],
      minimizable: ["isMinimizable", "setMinimizable"],
      movable: ["isMovable", "setMovable"],
      shadow: ["hasShadow", "setHasShadow"],
    };
    for (const name in flags) {
      const [getter, setter] = flags[name];
      inert(this.prototype, {
        [getter](this: BaseWindow) {
          return this.#flags[name];
        },
        [setter](this: BaseWindow, value: boolean) {
          this.#flags[name] = !!value;
          const { fullScreenable, maximizable } = this.#flags;
          this[kStyle]({ [name]: !!value, zoomable: this.isResizable() && (fullScreenable || maximizable) });
        },
      });
    }
    properties(this.prototype, flags as any);
  }
}
properties(BaseWindow.prototype, {
  accessibleTitle: ["getTitle", "invalidateShadow"],
  closable: ["isClosable", "setClosable"],
  contentView: ["getContentView", "setContentView"],
  documentEdited: ["isDocumentEdited", "setDocumentEdited"],
  fullScreen: ["isFullScreen", "setFullScreen"],
  menuBarVisible: ["isMenuBarVisible", "setMenuBarVisibility"],
  representedFilename: ["getRepresentedFilename", "setRepresentedFilename"],
  resizable: ["isResizable", "setResizable"],
  simpleFullScreen: ["isSimpleFullScreen", "setSimpleFullScreen"],
  visibleOnAllWorkspaces: ["isVisibleOnAllWorkspaces", "setVisibleOnAllWorkspaces"],
});
inert(BaseWindow.prototype, {
  addTabbedWindow: undefined,
  blur: undefined,
  closeFilePreview: undefined,
  getAccentColor: false,
  getWindowButtonPosition: null,
  hookWindowMessage: undefined,
  invalidateShadow: undefined,
  isSnapped: false,
  isTabletMode: false,
  isWindowMessageHooked: false,
  moveAbove(this: BaseWindow) {
    this.moveTop();
  },
  previewFile: unsupported.throws("previewFile"),
  setAccentColor: undefined,
  setAppDetails: undefined,
  setAspectRatio: undefined,
  setAutoHideCursor: undefined,
  setIcon: undefined,
  setOverlayIcon: undefined,
  setParentWindow: undefined,
  setProgressBar: undefined,
  setShape: undefined,
  setSheetOffset: undefined,
  setThumbarButtons: false,
  setThumbnailClip: undefined,
  setThumbnailToolTip: undefined,
  setTouchBar: undefined,
  unhookAllWindowMessages: undefined,
  unhookWindowMessage: undefined,
});
// What the roles of menu items call.
const target = (window: any) => webContents.getFocusedWebContents() ?? window.webContents;
for (const name of [
  "undo",
  "redo",
  "cut",
  "copy",
  "paste",
  "pasteAndMatchStyle",
  "delete",
  "selectAll",
  "getZoomFactor",
  "setZoomFactor",
]) {
  BaseWindow.prototype[name] = function (argument: unknown) {
    return target(this)?.[name](argument);
  };
}

class BrowserWindow extends BaseWindow {
  webContents;
  #browserViews = new Set<any>();
  #view: WebContentsView;

  constructor(options: any = {}) {
    super(options);
    const view = (this.#view = new WebContentsView({ ...options, [kView]: "window" }));
    view.setBackgroundColor(
      options.backgroundColor ?? (options.transparent || options.vibrancy ? "#00000000" : "#FFFFFF"),
    );
    const contents = (this.webContents = view.webContents);
    this.setContentView(view);
    contents.on("page-title-updated", (_: unknown, title: string, explicitSet: boolean) => {
      if (this.isDestroyed()) return;
      const event = new Event();
      this.emit("page-title-updated", event, title, explicitSet);
      if (!event.defaultPrevented) this.setTitle(title);
    });
    contents.once("ready-to-show", () => this.isDestroyed() || super.emit("ready-to-show", new Event()));
    contents.once("destroyed", () => this.destroy());
    if (this.isVisible()) contents.focus();
    app.emit("browser-window-created", new Event(), this);
  }

  setBackgroundColor(color: string) {
    super.setBackgroundColor(color);
    if (#view in this) this.#view.setBackgroundColor(color);
  }

  emit(name: string, ...args: unknown[]) {
    if (name === "ready-to-show") return false;
    if (name === "focus" || name === "blur") app.emit("browser-window-" + name, new Event(), this);
    return super.emit(name, ...args);
  }

  static fromWebContents(contents: any) {
    const window = contents.getOwnerBrowserWindow();
    return window instanceof BrowserWindow ? window : null;
  }

  static fromBrowserView(view: any) {
    return BrowserWindow.fromWebContents(view.webContents);
  }

  close() {
    if (this.isDestroyed()) return;
    if (!this.isClosable() || !emitCancelable(this, "close")) return closeCancelled();
    queueTask(() => this.webContents.close({ waitForBeforeUnload: true }));
  }

  destroy() {
    if (this.isDestroyed()) return;
    if (this.webContents.isDestroyed()) super.destroy();
    else this.webContents.destroy();
  }

  focusOnWebView() {
    this.webContents.focus();
  }

  addBrowserView(view: any) {
    this.#browserViews.$add(view);
    (this as any).contentView.addChildView(view);
  }

  removeBrowserView(view: any) {
    if (this.#browserViews.$delete(view)) (this as any).contentView.removeChildView(view);
  }

  setBrowserView(view: any) {
    for (const other of this.getBrowserViews()) this.removeBrowserView(other);
    if (view) this.addBrowserView(view);
  }

  setTopBrowserView(view: any) {
    this.#browserViews.$delete(view);
    this.addBrowserView(view);
  }

  getBrowserViews() {
    return [...this.#browserViews];
  }

  getBrowserView() {
    return this.getBrowserViews()[0] ?? null;
  }
}
inert(BrowserWindow.prototype, { blurWebView: undefined, showDefinitionForSelection: undefined });
for (const name of ["loadURL", "loadFile", "reload", "capturePage"]) {
  BrowserWindow.prototype[name] = function (...args: unknown[]) {
    return this.webContents[name](...args);
  };
}

class BrowserView extends WebContentsView {
  setAutoResize = unsupported.throws("setAutoResize");
}

export default { BaseWindow, BrowserView, BrowserWindow, ImageView, View, WebContentsView, target };
