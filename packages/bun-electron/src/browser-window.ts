// BrowserWindow + WebContents — Electron-compatible window management.

import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import * as native from "./native";
import { NativeImage } from "./native-image";
import { encodeArgs } from "./serialize";

export interface BrowserWindowOptions {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  show?: boolean;
  title?: string;
  resizable?: boolean;
  minimizable?: boolean;
  maximizable?: boolean;
  fullscreen?: boolean;
  alwaysOnTop?: boolean;
  frame?: boolean;
  backgroundColor?: string;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  webPreferences?: {
    preload?: string;
    [key: string]: unknown;
  };
}

export { NativeImage };

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

const windows = new Map<number, BrowserWindow>();
let nextEvalId = 1;
const pendingEvals = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let nextCaptureId = 1;
const pendingCaptures = new Map<number, { resolve: (v: NativeImage) => void; reject: (e: Error) => void }>();
let nextCssKey = 1;
let nextFileDialogId = 1;
const pendingFileDialogs = new Map<number, (result: { canceled: boolean; filePaths: string[] }) => void>();

// "#rrggbb" / "#aarrggbb" -> CEF cef_color_t hex (AARRGGBB).
function parseBackgroundColor(color: string): string | undefined {
  const hex = color.replace(/^#/, "");
  if (hex.length === 6) return `ff${hex}`;
  if (hex.length === 8) return hex;
  return undefined;
}

export class WebContents extends EventEmitter {
  constructor(private readonly win: BrowserWindow) {
    super();
  }

  get id(): number {
    return this.win.id;
  }

  send(channel: string, ...args: unknown[]): void {
    native.ipcSend(this.win.id, channel, encodeArgs(args));
  }

  /** Inserts CSS into the page; resolves with a key for removeInsertedCSS. */
  async insertCSS(css: string): Promise<string> {
    const key = `be-css-${nextCssKey++}`;
    await this.executeJavaScript(
      `(() => {
        const style = document.createElement("style");
        style.id = ${JSON.stringify(key)};
        style.textContent = ${JSON.stringify(css)};
        document.head.appendChild(style);
      })()`,
    );
    return key;
  }

  async removeInsertedCSS(key: string): Promise<void> {
    await this.executeJavaScript(`document.getElementById(${JSON.stringify(key)})?.remove()`);
  }

  /** Captures the visible page as a PNG via the DevTools protocol. */
  capturePage(): Promise<NativeImage> {
    if (this.win.isDestroyed()) {
      return Promise.reject(new Error("webContents was destroyed"));
    }
    const captureId = nextCaptureId++;
    return new Promise((resolve, reject) => {
      pendingCaptures.set(captureId, { resolve, reject });
      this.win._whenBrowserReady(() => {
        native.capturePage(this.win.id, captureId);
      });
    });
  }

  isLoading(): boolean {
    return this.win._isLoading;
  }

  executeJavaScript(code: string, _userGesture?: boolean): Promise<unknown> {
    if (this.win.isDestroyed()) {
      return Promise.reject(new Error("webContents was destroyed"));
    }
    const evalId = nextEvalId++;
    return new Promise((resolve, reject) => {
      pendingEvals.set(evalId, { resolve, reject });
      this.win._whenBrowserReady(() => {
        native.windowEvalJs(this.win.id, code, evalId);
      });
    });
  }

  loadURL(url: string): Promise<void> {
    return this.win.loadURL(url);
  }

  getURL(): string {
    return (native.windowGetState(this.win.id)?.url as string) ?? "";
  }

  getTitle(): string {
    return (native.windowGetState(this.win.id)?.title as string) ?? "";
  }

  openDevTools(): void {
    this.win._command("open_devtools");
  }

  closeDevTools(): void {
    this.win._command("close_devtools");
  }

  reload(): void {
    this.win._command("reload");
  }

  stop(): void {
    this.win._command("stop");
  }

  goBack(): void {
    this.win._command("go_back");
  }

  goForward(): void {
    this.win._command("go_forward");
  }

  setZoomLevel(level: number): void {
    this.win._command("set_zoom", String(level));
  }

  isDestroyed(): boolean {
    return this.win.isDestroyed();
  }
}

export class BrowserWindow extends EventEmitter {
  readonly id: number;
  readonly webContents: WebContents;

  private _destroyed = false;
  private _browserReady = false;
  private _browserReadyQueue: Array<() => void> = [];
  private _loadResolvers: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  private _resizable = true;
  private _minimizable = true;
  private _maximizable = true;
  private _minSize: [number, number] = [0, 0];
  private _maxSize: [number, number] = [0, 0];
  /** @internal */
  _isLoading = false;

  constructor(options: BrowserWindowOptions = {}) {
    super();
    // Window creation requires CEF to be running; mirror Electron's "cannot
    // create BrowserWindow before app is ready" behavior loosely by starting
    // the app on demand.
    const { app } = require("./app") as typeof import("./app");
    app._ensureStarted();

    const adoptId = (options as { __adoptId?: number }).__adoptId;
    if (adoptId !== undefined) {
      // Wrapping a window that already exists natively (window.open popup).
      this.id = adoptId;
    } else {
      let preloadSource: string | undefined;
      if (options.webPreferences?.preload) {
        preloadSource = readFileSync(options.webPreferences.preload, "utf8");
      }
      this._resizable = options.resizable ?? true;
      this._minimizable = options.minimizable ?? true;
      this._maximizable = options.maximizable ?? true;
      this._minSize = [options.minWidth ?? 0, options.minHeight ?? 0];
      this._maxSize = [options.maxWidth ?? 0, options.maxHeight ?? 0];

      this.id = native.windowCreate({
        width: options.width,
        height: options.height,
        x: options.x,
        y: options.y,
        show: options.show ?? true,
        title: options.title,
        resizable: options.resizable,
        minimizable: options.minimizable,
        maximizable: options.maximizable,
        fullscreen: options.fullscreen,
        always_on_top: options.alwaysOnTop,
        frameless: options.frame === false ? true : undefined,
        min_width: options.minWidth,
        min_height: options.minHeight,
        max_width: options.maxWidth,
        max_height: options.maxHeight,
        preload: preloadSource,
        background_color: options.backgroundColor ? parseBackgroundColor(options.backgroundColor) : undefined,
      });
    }
    if (this.id < 0) {
      throw new Error("Failed to create BrowserWindow (CEF not initialized)");
    }
    this.webContents = new WebContents(this);
    windows.set(this.id, this);
    app.emit("browser-window-created", {}, this);
  }

  /** @internal Wrap a natively-created popup window (window.open). */
  static _adopt(id: number): BrowserWindow {
    const win = new BrowserWindow({ __adoptId: id } as BrowserWindowOptions);
    // The popup browser already exists by the time window-open is emitted.
    win._browserReady = true;
    return win;
  }

  static getAllWindows(): BrowserWindow[] {
    return [...windows.values()];
  }

  static fromId(id: number): BrowserWindow | null {
    return windows.get(id) ?? null;
  }

  static getFocusedWindow(): BrowserWindow | null {
    for (const win of windows.values()) {
      if (win._state()?.focused) return win;
    }
    return null;
  }

  loadURL(url: string): Promise<void> {
    if (this._destroyed) return Promise.reject(new Error("window was destroyed"));
    return new Promise<void>((resolve, reject) => {
      this._loadResolvers.push({ resolve, reject });
      this._whenBrowserReady(() => this._command("load_url", url));
    });
  }

  loadFile(filePath: string): Promise<void> {
    return this.loadURL(pathToFileURL(filePath).href);
  }

  close(): void {
    this._command("close");
  }

  destroy(): void {
    this._command("destroy");
  }

  show(): void {
    this._command("show");
  }

  hide(): void {
    this._command("hide");
  }

  focus(): void {
    this._command("focus");
  }

  minimize(): void {
    this._command("minimize");
  }

  maximize(): void {
    this._command("maximize");
  }

  restore(): void {
    this._command("restore");
  }

  center(): void {
    this._command("center");
  }

  setTitle(title: string): void {
    this._command("set_title", title);
  }

  getTitle(): string {
    return (this._state()?.title as string) ?? "";
  }

  setFullScreen(flag: boolean): void {
    this._command("set_fullscreen", flag ? "1" : "0");
  }

  isFullScreen(): boolean {
    return Boolean(this._state()?.fullscreen);
  }

  setAlwaysOnTop(flag: boolean): void {
    this._command("set_always_on_top", flag ? "1" : "0");
  }

  setResizable(flag: boolean): void {
    this._resizable = flag;
    this._command("set_resizable", flag ? "1" : "0");
  }

  isResizable(): boolean {
    return this._resizable;
  }

  setMinimizable(flag: boolean): void {
    this._minimizable = flag;
    this._command("set_minimizable", flag ? "1" : "0");
  }

  isMinimizable(): boolean {
    return this._minimizable;
  }

  setMaximizable(flag: boolean): void {
    this._maximizable = flag;
    this._command("set_maximizable", flag ? "1" : "0");
  }

  isMaximizable(): boolean {
    return this._maximizable;
  }

  setMinimumSize(width: number, height: number): void {
    this._minSize = [width, height];
    this._command("set_min_size", native.encodeKV({ width, height }));
  }

  getMinimumSize(): [number, number] {
    return [...this._minSize];
  }

  setMaximumSize(width: number, height: number): void {
    this._maxSize = [width, height];
    this._command("set_max_size", native.encodeKV({ width, height }));
  }

  getMaximumSize(): [number, number] {
    return [...this._maxSize];
  }

  capturePage(): Promise<NativeImage> {
    return this.webContents.capturePage();
  }

  /** Sets the window (and taskbar/dock) icon from a NativeImage or PNG path. */
  setIcon(icon: NativeImage | string): void {
    const image = typeof icon === "string" ? NativeImage.createFromPath(icon) : icon;
    if (image.isEmpty()) throw new TypeError("Failed to load image from path or buffer");
    this._command("set_icon", image.toPNG().toString("base64"));
  }

  /** @internal Backs dialog.showOpenDialog/showSaveDialog. */
  _runFileDialog(
    mode: "open" | "open-multiple" | "open-folder" | "save",
    options: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }>; properties?: string[] },
  ): Promise<{ canceled: boolean; filePaths: string[] }> {
    let resolvedMode: string = mode;
    if (options.properties?.includes("multiSelections")) resolvedMode = "open-multiple";
    if (options.properties?.includes("openDirectory")) resolvedMode = "open-folder";
    const dialogId = nextFileDialogId++;
    return new Promise((resolve) => {
      pendingFileDialogs.set(dialogId, resolve);
      this._whenBrowserReady(() => {
        native.runFileDialog(this.id, dialogId, {
          mode: resolvedMode,
          title: options.title,
          default_path: options.defaultPath,
          filter: options.filters?.map((f) => f.extensions.map((e) => `.${e}`).join(";")),
        });
      });
    });
  }

  setBounds(bounds: Partial<Rectangle>): void {
    this._command("set_bounds", native.encodeKV(bounds));
  }

  getBounds(): Rectangle {
    const s = this._state();
    return {
      x: (s?.x as number) ?? 0,
      y: (s?.y as number) ?? 0,
      width: (s?.width as number) ?? 0,
      height: (s?.height as number) ?? 0,
    };
  }

  setSize(width: number, height: number): void {
    this.setBounds({ width, height });
  }

  getSize(): [number, number] {
    const b = this.getBounds();
    return [b.width, b.height];
  }

  setPosition(x: number, y: number): void {
    this.setBounds({ x, y });
  }

  getPosition(): [number, number] {
    const b = this.getBounds();
    return [b.x, b.y];
  }

  isVisible(): boolean {
    return Boolean(this._state()?.visible);
  }

  isMinimized(): boolean {
    return Boolean(this._state()?.minimized);
  }

  isMaximized(): boolean {
    return Boolean(this._state()?.maximized);
  }

  isFocused(): boolean {
    return Boolean(this._state()?.focused);
  }

  isDestroyed(): boolean {
    return this._destroyed;
  }

  // -- internal ------------------------------------------------------------

  _command(cmd: string, arg?: string): void {
    if (this._destroyed) return;
    native.windowCommand(this.id, cmd, arg);
  }

  _state(): Record<string, unknown> | null {
    if (this._destroyed) return null;
    return native.windowGetState(this.id);
  }

  _whenBrowserReady(fn: () => void): void {
    if (this._browserReady) fn();
    else this._browserReadyQueue.push(fn);
  }

  _handleEvent(ev: native.NativeEvent): void {
    switch (ev.type) {
      case "window-created":
        this.emit("ready-to-show");
        break;
      case "browser-created": {
        this._browserReady = true;
        const queue = this._browserReadyQueue;
        this._browserReadyQueue = [];
        for (const fn of queue) fn();
        break;
      }
      case "close":
        this.emit("close");
        break;
      case "closed":
        this._destroyed = true;
        windows.delete(this.id);
        for (const { reject } of this._loadResolvers.splice(0)) {
          reject(new Error("window was closed before the page finished loading"));
        }
        this.emit("closed");
        break;
      case "did-finish-load":
        for (const { resolve } of this._loadResolvers.splice(0)) resolve();
        this.webContents.emit("did-finish-load");
        this.webContents.emit("dom-ready");
        break;
      case "did-fail-load": {
        const err = new Error(`${ev.errorText} (${ev.errorCode}) loading '${ev.url}'`) as Error & {
          errno: unknown;
          code: string;
        };
        err.errno = ev.errorCode;
        err.code = String(ev.errorText);
        for (const { reject } of this._loadResolvers.splice(0)) reject(err);
        this.webContents.emit("did-fail-load", {
          errorCode: ev.errorCode,
          errorDescription: ev.errorText,
          validatedURL: ev.url,
        });
        break;
      }
      case "loading-state":
        this._isLoading = Boolean(ev.isLoading);
        if (ev.isLoading) this.webContents.emit("did-start-loading");
        else this.webContents.emit("did-stop-loading");
        break;
      case "file-dialog-result": {
        const resolve = pendingFileDialogs.get(ev.dialogId as number);
        if (resolve) {
          pendingFileDialogs.delete(ev.dialogId as number);
          resolve({
            canceled: Boolean(ev.canceled),
            filePaths: Array.isArray(ev.paths) ? (ev.paths as string[]) : [],
          });
        }
        break;
      }
      case "capture-result": {
        const pending = pendingCaptures.get(ev.captureId as number);
        if (pending) {
          pendingCaptures.delete(ev.captureId as number);
          const result = ev.result as { data?: string; message?: string } | null;
          if (ev.success && result?.data) {
            pending.resolve(new NativeImage(Buffer.from(result.data, "base64")));
          } else {
            pending.reject(new Error(result?.message ?? "capturePage failed"));
          }
        }
        break;
      }
      case "page-title-updated":
        this.emit("page-title-updated", { preventDefault() {} }, ev.title);
        this.webContents.emit("page-title-updated", { preventDefault() {} }, ev.title);
        break;
      case "address-changed":
        this.webContents.emit("did-navigate", {}, ev.url);
        break;
      case "console-message":
        this.webContents.emit("console-message", {
          level: ev.level,
          message: ev.message,
          lineNumber: ev.line,
          sourceId: ev.source,
        });
        break;
      case "eval-result": {
        const pending = pendingEvals.get(ev.evalId as number);
        if (pending) {
          pendingEvals.delete(ev.evalId as number);
          if (ev.isError) pending.reject(new Error(String(ev.result)));
          else pending.resolve(ev.result);
        }
        break;
      }
      case "focus":
        this.emit("focus");
        break;
      case "blur":
        this.emit("blur");
        break;
      case "resize":
        this.emit("resize");
        break;
      case "move":
        this.emit("move");
        break;
      case "fullscreen":
        this.emit(ev.fullscreen ? "enter-full-screen" : "leave-full-screen");
        break;
    }
  }
}

export function routeWindowEvent(ev: native.NativeEvent): void {
  if (ev.type === "window-open") {
    // A window.open() popup: wrap the natively-created window and notify the
    // opener (Electron's did-create-window).
    const child = BrowserWindow._adopt(ev.windowId as number);
    const opener = windows.get(ev.openerId as number);
    opener?.webContents.emit("did-create-window", child, { url: ev.url });
    return;
  }
  const win = windows.get(ev.windowId as number);
  win?._handleEvent(ev);
}

export function windowById(id: number): BrowserWindow | undefined {
  return windows.get(id);
}
