const EventEmitter = require("node:events");
const native = require("internal/desktop/native");
const accelerator = require("internal/desktop/accelerator");
const cover = require("internal/desktop/cover");
const { allocateSurfaceId, surfaces } = require("internal/desktop/surfaces");
const { app, Event, emitCancelable, allWindowsClosed, closeCancelled, hasDisplay } = require("internal/desktop/app");

type Geometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
  fullscreen: boolean;
  scale: number;
};

const windows = new Map<number, Window>();
let nextId = cover.firstFreeId();
let focusedWindow: Window | null = null;

const kHandle = Symbol("kHandle");
/** A message box: not one of the app's windows. */
const kInternal = Symbol("kInternal");
/** It has no document. What made it attaches surfaces. */
const kBare = Symbol("kBare");
const kContent = Symbol("kContent");
const kAttach = Symbol("kAttach");
const kDetach = Symbol("kDetach");
/** The menu bar and the menus that are open. */
const kMenus = Symbol("kMenus");
const kStyle = Symbol("kStyle");
const kIsOccluded = Symbol("kIsOccluded");
const kOcclusionChanged = Symbol("kOcclusionChanged");
const kSurface = Symbol("kSurface");

const MENU_BAR_HEIGHT = 28;
const changesLooks = /^(?:opacity|background|backgroundColor|trafficLightPosition)$/;
const defaultStyle =
  "@layer{:root{color-scheme:light dark;font:14px system-ui;cursor:default;user-select:none}body{margin:0}}";

let windowContext: any;
function WindowContext() {
  return (windowContext ??= require("internal/desktop/render").api.createContext(null));
}

function parseColor(value: string) {
  const color = Bun.color(value, "{rgba}");
  if (color === null) throw $ERR_INVALID_ARG_VALUE("backgroundColor", value, "is not a color");
  return ((color.r << 24) | (color.g << 16) | (color.b << 8) | Math.round(color.a * 255)) >>> 0;
}

const isMac = process.platform === "darwin";
const levels = {
  __proto__: null,
  normal: 0,
  floating: 3,
  "torn-off-menu": 3,
  "modal-panel": 8,
  dock: 20,
  "main-menu": 24,
  status: 25,
  "pop-up-menu": 101,
  "screen-saver": 1000,
};

function backgroundOf(options: any) {
  if (options.backgroundMaterial === "mica" || options.backgroundMaterial === "tabbed")
    return options.backgroundMaterial;
  if (options.vibrancy && isMac) return `blurred:${options.vibrancy}:${options.visualEffectState ?? "followWindow"}`;
  if (options.vibrancy || options.backgroundMaterial === "acrylic") return "blurred";
  return options.transparent ? "transparent" : "opaque";
}

class Window extends EventEmitter {
  id = nextId++;
  #key: unknown;
  #internal!: boolean;
  #surface = 0;
  #page: any;
  #defaultStyle: string | undefined;
  #renderer: any;
  #menus: any;
  #destroyed = false;
  #visible!: boolean;
  #minimized = false;
  #occluded = false;
  #looks!: { transparent: boolean; visualEffectState: string | undefined };
  #closable!: boolean;
  #modal!: boolean;
  #parent!: Window | null;
  #geometry: Geometry | undefined;
  #normalBounds;
  #limits;
  #zoom = 1;
  #hasBackground!: boolean;
  #menu: any;
  #menuBarVisible!: boolean;
  #hasMenuBar!: boolean;
  #menuBarHeight = 0;
  /** What the platform's window was told. Hiding one on Linux closes it. */
  #settings = new Map<string, unknown>();
  /** What would change the looks of the launch cover, while it is shown. */
  #postponed: Map<string, unknown> | undefined;
  #coverOptions: { variables: string[]; trafficLightPosition: unknown } | undefined;

  constructor(options: Record<string | symbol, any> = {}) {
    if (options.key !== undefined) {
      for (const window of windows.values()) {
        if (window.#key !== options.key) continue;
        nextId--;
        window.removeAllListeners();
        return window;
      }
    }
    super();
    const reserved = options.launchCover ? cover.takeId() : 0;
    if (reserved !== 0) {
      nextId--;
      this.id = reserved;
    }
    native.start();
    if (!hasDisplay()) {
      throw new Error(
        "There is no display server: neither WAYLAND_DISPLAY nor DISPLAY is set. Set BUN_DESKTOP_HEADLESS=1 to run without one.",
      );
    }
    const title = String(options.title ?? app.name);
    const hiddenTitleBar =
      options.titleBarStyle === "hidden" ||
      (process.platform === "darwin" && (options.titleBarStyle ?? "default") !== "default");
    const lights = options.trafficLightPosition ?? (options.titleBarStyle === "hiddenInset" ? { x: 12, y: 11 } : null);
    const icon = options.icon && require("internal/desktop/system").imageBytes(options.icon);
    this.#key = options.key;
    this.#internal = !!options[kInternal];
    this.#visible = options.show !== false;
    this.#closable = options.closable !== false;
    this.#parent = options.parent ?? null;
    this.#modal = !!options.modal && this.#parent !== null;
    this.#menuBarVisible = !options.autoHideMenuBar;
    this.#hasMenuBar = process.platform !== "darwin" && options.frame !== false && !hiddenTitleBar && !this.#modal;
    this.#limits = {
      min: [options.minWidth ?? 0, options.minHeight ?? 0],
      max: options.maxWidth || options.maxHeight ? [options.maxWidth || 32767, options.maxHeight || 32767] : null,
      resizable: options.resizable !== false,
    };
    this.#settings.$set("title", title);
    this.#looks = {
      transparent: !!(options.transparent || options.vibrancy),
      visualEffectState: options.visualEffectState,
    };
    this.#hasBackground = options.backgroundColor !== undefined || backgroundOf(options) !== "opaque";

    const creation = {
      id: this.id,
      title,
      x: options.x,
      y: options.y,
      width: options.width ?? 800,
      height: options.height ?? 600,
      minWidth: this.#limits.min[0],
      minHeight: this.#limits.min[1],
      show: this.#visible,
      focus: this.#visible && options.focus !== false,
      frame: options.frame !== false,
      hiddenTitleBar,
      trafficLightPosition: lights && [lights.x, lights.y],
      background: backgroundOf(options),
      backgroundColor: options.backgroundColor === undefined ? undefined : parseColor(options.backgroundColor),
      resizable: this.#limits.resizable,
      movable: options.movable !== false,
      acceptFirstMouse: !!options.acceptFirstMouse || options.type === "popup",
      minimizable: options.minimizable !== false,
      kind: this.#modal
        ? "dialog"
        : options.type === "panel"
          ? "floating"
          : options.type === "popup"
            ? "popup"
            : "normal",
      maximized: !!options.maximized,
      fullscreen: !!(options.fullscreen || options.kiosk),
      appId: app.identifier,
      icon: icon ? native.putBlob(icon) : undefined,
    };
    if (options.launchCover === false) cover.discard();
    const missed = reserved !== 0 ? cover.adopt(creation, { uncovered: () => this.#uncovered() }) : undefined;
    if (!missed) native.ask("window.create", creation);
    windows.$set(this.id, this);
    native.hold();
    this.#geometry = this.#ask("geometry");
    this.#normalBounds = this.getBounds();
    if (options.launchCover) {
      this.#coverOptions = {
        variables: ["LANG", "LC_ALL", ...(options.launchCover.environment ?? [])],
        trafficLightPosition: creation.trafficLightPosition,
      };
    }
    if (missed) this.#adopted(creation, missed);

    if (this.#limits.max) this.#set("limits", this.#limits);
    this[kStyle]({
      shadow: options.hasShadow ?? !options.transparent,
      closable: this.#closable,
      fullScreenable: options.type === "panel" ? undefined : options.fullscreenable !== false,
      zoomable: this.#limits.resizable && (options.maximizable !== false || options.fullscreenable !== false),
      hiddenInMissionControl: options.hiddenInMissionControl,
      roundedCorners: options.frame !== false || (options.roundedCorners !== false && !options.transparent),
    });
    if (options.alwaysOnTop) this.setAlwaysOnTop(true);
    if (isMac && this.#visible && this.#parent && !this.#modal) this.#tell("parent", this.#parent.id);
    if (options.skipTaskbar) this.setSkipTaskbar(true);
    if (options.opacity !== undefined) this.setOpacity(options.opacity);
    this.#updateMenus();
    if (!options[kBare]) this.#createPage();
    if (!this.#internal) app.emit("window-created", new Event(), this);
  }

  static getAllWindows() {
    return [...windows.values()].filter(window => !window.#internal);
  }

  static getFocusedWindow() {
    return focusedWindow;
  }

  static fromId(id: number) {
    return windows.$get(id) ?? null;
  }

  #check() {
    if (this.#destroyed) throw new Error("The window has been destroyed");
  }

  #tell(command: string, value?: unknown) {
    this.#check();
    if (this.#postponed && changesLooks.test(command)) return void this.#postponed.$set(command, value);
    native.send("window." + command, { id: this.id, value });
  }

  [kStyle](style: object) {
    if (isMac) this.#tell("style", style);
  }

  getMediaSourceId() {
    return `window:${isMac ? this.#ask("windowNumber") : this.getNativeWindowHandle().readBigUInt64LE()}:0`;
  }

  [kIsOccluded]() {
    return this.#occluded;
  }

  #ask(command: string, value?: unknown) {
    this.#check();
    return native.ask("window." + command, { id: this.id, value });
  }

  #set(name: string, value: unknown) {
    this.#settings.$set(name, value);
    this.#tell(name, value);
  }

  #adopted(creation: any, missed: string[]) {
    const { x, y, width, height, title, background, backgroundColor, trafficLightPosition } = creation;
    if (this.#geometry!.maximized) this.#normalBounds = { x, y, width, height };
    this.#tell("title", title);
    this.#tell("limits", this.#limits);
    this.#postponed = new Map(Object.entries({ background, backgroundColor }));
    if (trafficLightPosition) this.#postponed.$set("trafficLightPosition", trafficLightPosition);
    setImmediate(() => {
      if (this.#destroyed) return;
      if (missed.includes("closed")) return this.#dispose();
      if (focusedWindow !== this && missed.lastIndexOf("focus") > missed.lastIndexOf("blur"))
        this[kHandle]("focus", null);
      if (missed.includes("close")) this.close();
    });
  }

  #uncovered() {
    const postponed = this.#postponed!;
    this.#postponed = undefined;
    if (this.#destroyed) return;
    for (const [name, value] of postponed) this.#tell(name, value);
    if (!this.#visible) this.#tell("hide");
  }

  isLaunchCoverShown() {
    return cover.isShownIn(this.id);
  }

  hasLaunchCoverInput() {
    return cover.isShownIn(this.id) && cover.hasInput();
  }

  whenLaunchCoverInput(): Promise<void> {
    return cover.whenInput();
  }

  endLaunchCover(options?: { dropInput?: boolean; keep?: object[] }) {
    if (!cover.isShownIn(this.id)) return;
    const tasks = require("internal/desktop/tasks");
    tasks.post(tasks.BLOCKING, () => {
      tasks.render();
      cover.end(!options?.dropInput, options?.keep);
    });
  }

  saveLaunchCover(rect?: object, field?: { bounds: any; color?: string; letterSpacing?: number }): Promise<boolean> {
    this.#check();
    if (!field) return this.#saveCover({ rect });
    const { x, y, width, height } = field.bounds;
    const color = field.color === undefined ? undefined : parseColor(field.color);
    return this.#saveCover({
      rect,
      field: { rect: { x, y, width, height }, color, letterSpacing: field.letterSpacing },
    });
  }

  #saveCover(details: object): Promise<boolean> {
    if (!this.#coverOptions || !this.#visible || this.#minimized || this.#geometry!.fullscreen)
      return Promise.$resolve(false);
    const { variables, trafficLightPosition } = this.#coverOptions;
    const options = {
      ...this.#normalBounds,
      maximized: this.#geometry!.maximized,
      fullscreen: false,
      trafficLightPosition,
    };
    return cover.save({ ...details, window: this.id, variables, options });
  }

  #coverMoved() {
    clearTimeout(this.#coverTimer);
    this.#coverTimer = setTimeout(
      () => this.#destroyed || !cover.isSaved() || this.#saveCover({ keepsPicture: true }),
      300,
    ).unref();
  }

  #coverTimer: Timer | undefined;

  static clearLaunchCover() {
    cover.clear();
  }

  #createPage() {
    const id = (this.#surface = allocateSurfaceId());
    native.send("surface.create", { id });
    native.send("surface.set", { id, bounds: this.#menuBarHeight === 0 ? null : this[kContent] });
    native.send("surface.attach", { id, window: this.id, index: 0 });
    this.#page = require("internal/desktop/host").pageFor(this, id, !this.#internal);
    this.#defaultStyle = this.#page.insertCSS(defaultStyle);
    surfaces.$set(id, this.#page.handleEvent);
  }

  get [kSurface]() {
    return this.#surface;
  }

  get [kContent]() {
    const { width, height } = this.#geometry!;
    return { x: 0, y: this.#menuBarHeight, width, height: height - this.#menuBarHeight };
  }

  [kAttach](surface: number, index?: number) {
    native.send("surface.attach", { id: surface, window: this.id, index });
    this.#menus?.raise();
  }

  [kDetach](surface: number) {
    native.send("surface.attach", { id: surface, window: null });
  }

  get [kMenus]() {
    return (this.#menus ??= require("internal/desktop/menu").createMenus(this, MENU_BAR_HEIGHT));
  }

  #activeMenu() {
    return this.#menu === undefined ? require("internal/desktop/menu").Menu.getApplicationMenu() : this.#menu;
  }

  #updateMenus() {
    if (this.#destroyed || !this.#hasMenuBar) return;
    const menu = this.#menuBarVisible && !this.#geometry!.fullscreen ? this.#activeMenu() : null;
    const height = menu ? MENU_BAR_HEIGHT : 0;
    if (menu || this.#menus) this[kMenus].setBar(menu);
    if (height === this.#menuBarHeight) return;
    this.#menuBarHeight = height;
    this.#contentResized();
  }

  #contentResized() {
    if (this.#surface !== 0) {
      native.send("surface.set", { id: this.#surface, bounds: this.#menuBarHeight === 0 ? null : this[kContent] });
    }
    this.#menus?.layOut();
    this.emit("content-resized");
  }

  static menusChanged() {
    for (const window of windows.values()) window.#updateMenus();
  }

  static themeChanged() {
    for (const window of windows.values()) {
      if (window.#coverOptions && !window.#postponed) {
        if (cover.isShownIn(window.id)) cover.end(true);
        cover.clear();
      }
      window.#page?.environmentChanged();
      window.#menus?.environmentChanged();
    }
  }

  /** For a key that the content had no use for. */
  handleShortcut(event: { key: string; code: string; m: number }): boolean {
    if (this.#internal) return false;
    return require("internal/desktop/menu").activateByKey(this.#activeMenu(), this, event);
  }

  deferShortcut(event: object) {
    return this.#internal ? undefined : require("internal/desktop/menu").deferByKey(this.#activeMenu(), this, event);
  }

  [kHandle](name: string, value: any) {
    switch (name) {
      case "close":
        return this.close();
      case "closed":
        return this.#dispose();
      case "focus":
        focusedWindow = this;
        app.emit("window-focus", new Event(), this);
        return this.emit("focus");
      case "blur":
        if (focusedWindow === this) focusedWindow = null;
        app.emit("window-blur", new Event(), this);
        return this.emit("blur");
      case "fullscreen":
        return this.emit(value ? "enter-full-screen" : "leave-full-screen");
      case "swipe":
        return this.emit("swipe", new Event(), value);
      case "visibility": {
        if (isMac && this.#occluded !== (!value && this.#visible)) {
          this.#occluded = !this.#occluded;
          this.#page?.environmentChanged();
          this.emit(kOcclusionChanged);
        }
        const minimized = !value && this.#visible && !!this.#ask("isMinimized");
        if (minimized === this.#minimized) return;
        this.#minimized = minimized;
        this.#page?.environmentChanged();
        return this.emit(minimized ? "minimize" : "restore");
      }
      case "bounds": {
        const before = this.#geometry!;
        const { x, y, width, height, maximized, fullscreen } = (this.#geometry = value as Geometry);
        if (!maximized && !fullscreen) this.#normalBounds = { x, y, width, height };
        if (fullscreen !== before.fullscreen) this.#updateMenus();
        if (x !== before.x || y !== before.y) {
          this.#page?.environmentChanged();
          if (this.#coverOptions) this.#coverMoved();
          this.emit("move");
          if (isMac) this.emit("moved");
        }
        if (width !== before.width || height !== before.height) {
          this.#contentResized();
          if (this.#coverOptions) {
            if (cover.isShownIn(this.id)) cover.end(false);
            if (!fullscreen && !before.fullscreen) cover.clear();
          }
          this.emit("resize");
        }
        if (maximized !== before.maximized) this.emit(maximized ? "maximize" : "unmaximize");
        if (!isMac && fullscreen !== before.fullscreen)
          this.emit(fullscreen ? "enter-full-screen" : "leave-full-screen");
      }
    }
  }

  render(content: unknown) {
    const { jsx, createRoot } = require("internal/desktop/render");
    this.#check();
    this.#renderer ??= createRoot(this.document.body);
    this.#renderer.render(jsx(WindowContext(), { value: this, children: content }));
    return this;
  }

  get window() {
    return this.#page.window;
  }

  get document() {
    return this.#page.document;
  }

  loadHTML(html: string, url?: string | URL): Promise<void> {
    this.#check();
    this.#renderer?.unmount();
    this.#renderer = undefined;
    this.#page.removeInsertedCSS(this.#defaultStyle);
    if (url !== undefined) this.#page.setUrl(new URL(url).href);
    const loaded = new Promise<void>(resolve => this.once("did-finish-load", resolve));
    require("internal/desktop/host").willLoad(String(html), this.#page.document.URL);
    this.#page.loadHTML(String(html));
    return loaded;
  }

  async loadFile(file: string | URL) {
    const url = file instanceof URL ? file : Bun.pathToFileURL(file);
    return this.loadHTML(await Bun.file(url).text(), url);
  }

  insertCSS(css: string): string {
    return this.#page.insertCSS(String(css));
  }

  removeInsertedCSS(key: string) {
    this.#page.removeInsertedCSS(key);
  }

  findInPage(text: string, options?: object) {
    return this.#page.find(String(text), options);
  }

  stopFindInPage(action?: string) {
    this.#page.stopFind(action);
  }

  /** What the window shows, once it is up to date. */
  capturePage(rect?: { x: number; y: number; width: number; height: number }) {
    this.#page.flushCanvases();
    this.#page.handleEvent({ t: "frame" });
    const { blob } = native.ask("surface.capture", { id: this.#surface, rect });
    return require("internal/desktop/system").api.nativeImage.createFromBuffer(native.takeBlob(blob));
  }

  hasBackground() {
    return this.#hasBackground;
  }

  close() {
    if (this.#destroyed) return;
    if (this.#closable && this.#page?.beforeUnload() !== false && emitCancelable(this, "close")) this.destroy();
    else closeCancelled();
  }

  destroy() {
    if (this.#destroyed) return;
    if (isMac) for (const child of [this, ...this.getChildWindows()]) if (child.#parent) child.#tell("parent", null);
    this.#tell("destroy");
    this.#dispose();
  }

  #dispose() {
    if (cover.isShownIn(this.id)) {
      this.#postponed?.$clear();
      this.#visible = true;
      cover.end(false);
    }
    for (const child of this.getChildWindows()) child.destroy();
    this.#renderer?.unmount();
    this.#menus?.dispose();
    if (this.#surface !== 0) {
      this.#page.dispose();
      surfaces.$delete(this.#surface);
      native.destroySurface(this.#surface);
    }
    this.#destroyed = true;
    windows.$delete(this.id);
    if (focusedWindow === this) focusedWindow = null;
    if (this.#menu) require("internal/desktop/menu").setWindowMenu(this, undefined);
    native.release();
    this.emit("closed");
    if (!this.#internal && Window.getAllWindows().length === 0) allWindowsClosed();
  }

  isDestroyed() {
    return this.#destroyed;
  }

  #show(focus: boolean) {
    const wasVisible = this.#visible;
    this.#visible = true;
    this.#tell("show", focus);
    if (wasVisible) return;
    this.#occluded = false;
    if (isMac && this.#parent && !this.#modal) this.#tell("parent", this.#parent.id);
    if (process.platform === "linux") for (const [name, value] of this.#settings) this.#tell(name, value);
    this.#page?.environmentChanged();
    this.emit("show");
  }

  show() {
    this.#show(true);
  }

  showInactive() {
    this.#show(false);
  }

  hide() {
    if (cover.isShownIn(this.id)) cover.end(false);
    if (!this.#visible) return;
    this.#visible = false;
    if (isMac && this.#parent) this.#tell("parent", null);
    this.#tell("hide");
    if (focusedWindow === this) this[kHandle]("blur", null);
    this.#page?.environmentChanged();
    this.emit("hide");
  }

  isVisible() {
    return this.#visible && !this.#destroyed;
  }

  focus() {
    if (this.#visible) this.#tell("focus");
  }

  moveTop() {
    this.#tell(isMac ? "moveTop" : "focus");
  }

  isFocused() {
    return !this.#destroyed && !!this.#ask("isFocused");
  }

  isModal() {
    return this.#modal;
  }

  minimize() {
    this.#tell("minimize");
  }

  restore() {
    this.#tell("restore");
  }

  isMinimized() {
    return !!this.#ask("isMinimized");
  }

  maximize() {
    if (!this.#visible && !isMac) this.showInactive();
    this.#tell("maximize", true);
    if (!this.#visible) this.showInactive();
  }

  unmaximize() {
    this.#tell("maximize", false);
  }

  isMaximized() {
    return this.#ask("geometry").maximized;
  }

  setFullScreen(on: boolean) {
    this.#tell("fullscreen", !!on);
  }

  isFullScreen() {
    return this.#ask("geometry").fullscreen;
  }

  setSimpleFullScreen(on: boolean) {
    this.#set("simpleFullscreen", !!on);
  }

  isSimpleFullScreen() {
    return !!this.#settings.$get("simpleFullscreen");
  }

  isNormal() {
    const { maximized, fullscreen } = this.#ask("geometry");
    return !maximized && !fullscreen && !this.isMinimized();
  }

  getBounds() {
    const { x, y, width, height } = this.#ask("geometry");
    return { x, y, width, height };
  }

  setBounds(bounds: { x?: number; y?: number; width?: number; height?: number }, animate?: boolean) {
    const { x, y, width, height } = { ...this.getBounds(), ...bounds };
    if (isMac && !native.options.headless) return this.#tell("bounds", [x, y, width, height, !!animate]);
    if (bounds.x !== undefined || bounds.y !== undefined) this.setPosition(x, y);
    if (bounds.width !== undefined || bounds.height !== undefined) this.setSize(width, height);
  }

  getContentBounds() {
    const { x, y, width, height } = this.getBounds();
    return { x, y: y + this.#menuBarHeight, width, height: height - this.#menuBarHeight };
  }

  getNormalBounds() {
    return { ...this.#normalBounds };
  }

  getSize() {
    const { width, height } = this.getBounds();
    return [width, height];
  }

  setSize(width: number, height: number) {
    this.#tell("size", [width, height]);
  }

  getContentSize() {
    const { width, height } = this.getContentBounds();
    return [width, height];
  }

  setContentSize(width: number, height: number) {
    this.setSize(width, height + this.#menuBarHeight);
  }

  getPosition() {
    const { x, y } = this.getBounds();
    return [x, y];
  }

  setPosition(x: number, y: number) {
    this.#tell("position", [x, y]);
  }

  center() {
    const bounds = this.getBounds();
    const area = require("internal/desktop/system").screen.getDisplayMatching(bounds).workArea;
    this.setPosition(
      Math.round(area.x + (area.width - bounds.width) / 2),
      Math.round(area.y + (area.height - bounds.height) / 2),
    );
  }

  get devicePixelRatio() {
    return this.#geometry!.scale;
  }

  getMinimumSize() {
    return [...this.#limits.min];
  }

  setMinimumSize(width: number, height: number) {
    this.#set("limits", (this.#limits = { ...this.#limits, min: [width, height] }));
  }

  getMaximumSize() {
    return [...(this.#limits.max ?? [0, 0])];
  }

  setMaximumSize(width: number, height: number) {
    const max = width || height ? [width || 32767, height || 32767] : null;
    this.#set("limits", (this.#limits = { ...this.#limits, max }));
  }

  isResizable() {
    return this.#limits.resizable;
  }

  setResizable(resizable: boolean) {
    this.#set("limits", (this.#limits = { ...this.#limits, resizable: !!resizable }));
  }

  isClosable() {
    return this.#closable;
  }

  setClosable(closable: boolean) {
    this[kStyle]({ closable: (this.#closable = !!closable) });
  }

  get title() {
    return this.getTitle();
  }

  set title(title: string) {
    this.setTitle(title);
  }

  getTitle() {
    return this.#settings.$get("title") as string;
  }

  setTitle(title: string) {
    this.#set("title", String(title));
  }

  isAlwaysOnTop() {
    return !!this.#settings.$get("alwaysOnTop");
  }

  setAlwaysOnTop(on: boolean, level = "floating", relativeLevel = 0) {
    this.#set("alwaysOnTop", !!on);
    if (on) this[kStyle]({ level: (levels[level] ?? 3) + relativeLevel });
  }

  setSkipTaskbar(on: boolean) {
    this.#set("skipTaskbar", !!on);
  }

  isVisibleOnAllWorkspaces() {
    return !!this.#settings.$get("allWorkspaces");
  }

  setVisibleOnAllWorkspaces(on: boolean, options?: { visibleOnFullScreen?: boolean }) {
    this.#set("allWorkspaces", !!on);
    if (options?.visibleOnFullScreen) this[kStyle]({ visibleOnFullScreen: !!on });
  }

  setContentProtection(on: boolean) {
    this.#set("contentProtection", !!on);
  }

  getOpacity() {
    return (this.#settings.$get("opacity") as number) ?? 1;
  }

  setOpacity(opacity: number) {
    this.#set("opacity", Math.min(Math.max(opacity, 0), 1));
  }

  setIgnoreMouseEvents(ignore: boolean) {
    this.#set("ignoreMouseEvents", !!ignore);
  }

  flashFrame(on: boolean) {
    if (on) this.#tell("attention");
  }

  setBackgroundColor(color: string) {
    this.#tell("backgroundColor", parseColor(color));
    this.#hasBackground = true;
    this.#page?.environmentChanged();
  }

  setVibrancy(vibrancy: string | null) {
    this.#tell("background", backgroundOf({ ...this.#looks, vibrancy }));
  }

  setBackgroundMaterial(backgroundMaterial: string) {
    this.#tell("background", backgroundOf({ backgroundMaterial }));
  }

  isDocumentEdited() {
    return !!this.#settings.$get("edited");
  }

  setDocumentEdited(edited: boolean) {
    this.#set("edited", !!edited);
  }

  getRepresentedFilename() {
    return (this.#settings.$get("representedFilename") as string) ?? "";
  }

  setRepresentedFilename(file: string) {
    this.#set("representedFilename", String(file));
  }

  setWindowButtonVisibility(visible: boolean) {
    this[kStyle]({ buttons: !!visible });
  }

  setWindowButtonPosition(position: { x: number; y: number } | null) {
    if (process.platform !== "darwin") return;
    position ??= { x: 7, y: 6 };
    this.#tell("trafficLightPosition", [position.x, position.y]);
    if (this.#coverOptions) this.#coverOptions.trafficLightPosition = [position.x, position.y];
  }

  getZoomFactor() {
    return this.#zoom;
  }

  setZoomFactor(factor: number) {
    if (!(factor > 0)) throw $ERR_INVALID_ARG_VALUE("factor", factor, "must be greater than 0");
    this.#zoom = factor;
    this.#page.environmentChanged();
  }

  getNativeWindowHandle() {
    const handle = Buffer.alloc(8);
    handle.writeBigUInt64LE(BigInt(this.#ask("handle") ?? 0));
    return handle;
  }

  getParentWindow() {
    return this.#parent;
  }

  getChildWindows() {
    return [...windows.values()].filter(window => window.#parent === this);
  }

  setMenu(menu: any) {
    if (process.platform === "darwin") return;
    this.#menu = menu;
    require("internal/desktop/menu").setWindowMenu(this, menu);
    this.#updateMenus();
  }

  removeMenu() {
    this.setMenu(null);
  }

  isMenuBarVisible() {
    return this.#menuBarVisible;
  }

  setMenuBarVisibility(visible: boolean) {
    this.#menuBarVisible = !!visible;
    this.#updateMenus();
  }

  getSelectedText(): string {
    return this.#page.selectionText();
  }

  cut() {
    this.#page.edit("cut");
  }

  copy() {
    this.#page.edit("copy");
  }

  paste() {
    this.#page.edit("paste");
  }

  pasteAndMatchStyle() {
    this.#page.edit("pasteAndMatchStyle");
  }

  selectAll() {
    this.#page.edit("selectAll");
  }

  undo() {
    this.#page.edit("undo");
  }

  redo() {
    this.#page.edit("redo");
  }

  sendInputEvent(event: Record<string, any>) {
    let bits = 0;
    for (const modifier of event.modifiers ?? []) bits |= accelerator.parse(modifier + "+a")[1];
    const input: Record<string, unknown> = { ...event, m: bits };
    if (event.button !== undefined) input.button = ["left", "middle", "right"].indexOf(event.button);
    if (event.type === "keyDown" || event.type === "keyUp") {
      const [key, own] = accelerator.parse(event.keyCode);
      input.m = bits |= own;
      input.chord = [key, bits];
      if (!(bits & ~accelerator.SHIFT)) {
        if (key === "space") input.text = " ";
        else if ([...key].length === 1)
          input.text = bits ? key.toUpperCase() : event.keyCode === "Plus" ? "+" : event.keyCode;
      }
    }
    native.hooks.render();
    this.#ask("input", input);
  }

  [Symbol.dispose]() {
    this.destroy();
  }
}

native.handlers.window = event => {
  const window = windows.$get(event.w);
  if (window) window[kHandle](event.e, event.v);
  else cover.missed(event);
};

function useWindow(): Window {
  return require("internal/desktop/render").api.useContext(WindowContext());
}

export default {
  Window,
  useWindow,
  kAttach,
  kBare,
  kContent,
  kDetach,
  kInternal,
  kIsOccluded,
  kMenus,
  kOcclusionChanged,
  kStyle,
  kSurface,
};
