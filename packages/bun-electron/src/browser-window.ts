// BrowserWindow + WebContents — Electron-compatible window management.

import { EventEmitter } from "node:events";
import { pathToFileURL } from "node:url";
import * as native from "./native";

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
  webPreferences?: Record<string, unknown>;
}

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

const windows = new Map<number, BrowserWindow>();
let nextEvalId = 1;
const pendingEvals = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

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
    native.ipcSend(this.win.id, channel, JSON.stringify(args));
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

  constructor(options: BrowserWindowOptions = {}) {
    super();
    // Window creation requires CEF to be running; mirror Electron's "cannot
    // create BrowserWindow before app is ready" behavior loosely by starting
    // the app on demand.
    const { app } = require("./app") as typeof import("./app");
    app._ensureStarted();

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
      background_color: options.backgroundColor
        ? parseBackgroundColor(options.backgroundColor)
        : undefined,
    });
    if (this.id < 0) {
      throw new Error("Failed to create BrowserWindow (CEF not initialized)");
    }
    this.webContents = new WebContents(this);
    windows.set(this.id, this);
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
        const err = new Error(
          `${ev.errorText} (${ev.errorCode}) loading '${ev.url}'`,
        ) as Error & { errno: unknown; code: string };
        err.errno = ev.errorCode;
        err.code = String(ev.errorText);
        for (const { reject } of this._loadResolvers.splice(0)) reject(err);
        this.webContents.emit("did-fail-load", { errorCode: ev.errorCode, errorDescription: ev.errorText, validatedURL: ev.url });
        break;
      }
      case "loading-state":
        if (ev.isLoading) this.webContents.emit("did-start-loading");
        else this.webContents.emit("did-stop-loading");
        break;
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
  const win = windows.get(ev.windowId as number);
  win?._handleEvent(ev);
}

export function windowById(id: number): BrowserWindow | undefined {
  return windows.get(id);
}
