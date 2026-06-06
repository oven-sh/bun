// The `app` module — Electron-compatible application lifecycle.

import { EventEmitter } from "node:events";
import { BrowserWindow, routeWindowEvent } from "./browser-window";
import { routeIpcEvent } from "./ipc-main";
import * as native from "./native";
import { customSchemes, routeProtocolEvent } from "./protocol";
import { routeCookiesEvent } from "./session";
import { routeWebRequestEvent } from "./web-request";
import { routeMenuCommand } from "./menu";
import {
  hasSingleInstanceLock,
  releaseSingleInstanceLock,
  requestSingleInstanceLock,
} from "./single-instance";

// Pure, platform-parameterized app.getPath resolution. Exposed so the per-OS
// userData/appData/cache bases are verifiable on any host.
export function resolveAppPath(
  platform: NodeJS.Platform,
  name: string,
  appName: string,
  env: NodeJS.ProcessEnv,
  execPath: string,
): string {
  switch (name) {
    case "home":
      return env.HOME ?? env.USERPROFILE ?? "/";
    case "temp":
      return env.TMPDIR ?? env.TEMP ?? "/tmp";
    case "userData":
    case "appData":
    case "cache": {
      const base =
        platform === "darwin"
          ? `${env.HOME}/Library/Application Support`
          : platform === "win32"
            ? (env.APPDATA ?? `${env.USERPROFILE}\\AppData\\Roaming`)
            : (env.XDG_CONFIG_HOME ?? `${env.HOME}/.config`);
      return name === "appData" ? base : `${base}/${appName}`;
    }
    case "exe":
      return execPath;
    default:
      throw new Error(`app.getPath: unknown path name '${name}'`);
  }
}

class CommandLine {
  readonly switches: string[] = [];

  appendSwitch(key: string, value?: string): void {
    this.switches.push(value === undefined ? key : `${key}=${value}`);
  }

  hasSwitch(key: string): boolean {
    return this.switches.some(s => s === key || s.startsWith(`${key}=`));
  }

  getSwitchValue(key: string): string {
    const hit = this.switches.find(s => s.startsWith(`${key}=`));
    return hit ? hit.slice(key.length + 1) : "";
  }
}

class App extends EventEmitter {
  readonly commandLine = new CommandLine();

  private _ready = false;
  private _readyPromise: Promise<void>;
  private _readyResolve!: () => void;
  private _name = "bun-electron";
  private _quitting = false;
  private _exitCode = 0;

  constructor() {
    super();
    this._readyPromise = new Promise(resolve => {
      this._readyResolve = resolve;
    });
  }

  isReady(): boolean {
    return this._ready;
  }

  whenReady(): Promise<void> {
    this._ensureStarted();
    return this._readyPromise;
  }

  getName(): string {
    return this._name;
  }

  setName(name: string): void {
    this._name = name;
  }

  getVersion(): string {
    return process.env.npm_package_version ?? "0.0.0";
  }

  getAppPath(): string {
    const main = process.argv[1];
    return main ? require("node:path").dirname(require("node:path").resolve(main)) : process.cwd();
  }

  getLocale(): string {
    const raw = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "en-US";
    return raw.split(".")[0].replace("_", "-") || "en-US";
  }

  getSystemLocale(): string {
    return this.getLocale();
  }

  getPreferredSystemLanguages(): string[] {
    const langs = process.env.LANGUAGE || process.env.LANG || "en-US";
    return langs
      .split(/[:.]/)[0]
      .split(",")
      .map((l) => l.replace("_", "-"))
      .filter(Boolean);
  }

  requestSingleInstanceLock(): boolean {
    return requestSingleInstanceLock(this._name);
  }

  hasSingleInstanceLock(): boolean {
    return hasSingleInstanceLock();
  }

  releaseSingleInstanceLock(): void {
    releaseSingleInstanceLock();
  }

  private _badgeCount = 0;

  setBadgeCount(count = 0): boolean {
    if (typeof count !== "number" || count < 0 || !Number.isInteger(count)) {
      throw new TypeError("count must be a non-negative integer");
    }
    this._badgeCount = count;
    return true;
  }

  getBadgeCount(): number {
    return this._badgeCount;
  }

  private _appUserModelId = "";

  setAppUserModelId(id: string): void {
    this._appUserModelId = String(id);
  }

  /** CEF + shim version string. Not part of Electron's API. */
  getRuntimeVersion(): string {
    return native.version();
  }

  quit(): void {
    if (this._quitting) return;
    this._quitting = true;
    this.emit("before-quit");
    if (!native.isInitialized()) {
      process.exit(this._exitCode);
    }
    native.quit();
    this._maybeFinishQuit();
  }

  exit(code = 0): void {
    this._exitCode = code;
    native.shutdown();
    process.exit(code);
  }

  isQuitting(): boolean {
    return this._quitting;
  }

  focus(): void {
    BrowserWindow.getAllWindows()[0]?.focus();
  }

  getPath(name: string): string {
    return resolveAppPath(process.platform, name, this._name, process.env, process.execPath);
  }

  // -- internal ------------------------------------------------------------

  private _started = false;

  _ensureStarted(): void {
    if (this._started) return;
    this._started = true;

    native.setEventHandler(events => {
      for (const ev of events) this._dispatch(ev);
    });

    const switches = [...this.commandLine.switches];
    if (process.env.BUN_ELECTRON_SWITCHES) {
      switches.push(...process.env.BUN_ELECTRON_SWITCHES.split(","));
    }

    native.init({
      switches,
      customSchemes: customSchemes(),
      cacheDir: process.env.BUN_ELECTRON_CACHE_DIR,
      logFile: process.env.BUN_ELECTRON_LOG_FILE,
      remoteDebuggingPort: process.env.BUN_ELECTRON_DEBUG_PORT
        ? Number(process.env.BUN_ELECTRON_DEBUG_PORT)
        : undefined,
    });
  }

  private _dispatch(ev: native.NativeEvent): void {
    if (process.env.BUN_ELECTRON_TRACE) {
      console.error("[bun-electron]", JSON.stringify(ev));
    }
    switch (ev.type) {
      case "ready":
        this._ready = true;
        this._readyResolve();
        this.emit("ready");
        return;
      case "quit":
        this._maybeFinishQuit();
        return;
      case "ipc-message":
      case "ipc-invoke":
      case "ipc-sync":
        routeIpcEvent(ev);
        return;
      case "protocol-request":
        void routeProtocolEvent(ev);
        return;
      case "cookies-result":
        routeCookiesEvent(ev);
        return;
      case "web-request-before":
      case "web-request-headers":
      case "web-request-completed":
      case "web-request-error":
        routeWebRequestEvent(ev);
        return;
      case "menu-command":
        routeMenuCommand(ev.commandId as number);
        return;
      default:
        if (typeof ev.windowId === "number") {
          routeWindowEvent(ev);
          if (ev.type === "closed") this._onWindowClosed();
        }
    }
  }

  private _onWindowClosed(): void {
    if (BrowserWindow.getAllWindows().length > 0) return;
    if (this._quitting) {
      this._maybeFinishQuit();
      return;
    }
    // Electron semantics: apps quit when the last window closes unless a
    // listener overrides it.
    if (this.listenerCount("window-all-closed") > 0) {
      this.emit("window-all-closed");
    } else {
      this.quit();
    }
  }

  private _finishing = false;

  private _maybeFinishQuit(): void {
    if (!this._quitting || this._finishing) return;
    if (BrowserWindow.getAllWindows().length > 0) return;
    this._finishing = true;
    // Give CEF a beat to finish tearing down browsers before CefShutdown.
    setTimeout(() => {
      this.emit("will-quit");
      native.shutdown();
      this.emit("quit");
      process.exit(this._exitCode);
    }, 100);
  }
}

export const app = new App();
