// FFI bridge to the bun-electron native shim (native/shim.h) plus the
// native->JS event pump.

import { CString, dlopen, FFIType, suffix } from "bun:ffi";
import { existsSync } from "node:fs";
import path from "node:path";

export interface NativeEvent {
  type: string;
  windowId?: number;
  [key: string]: unknown;
}

const PKG_ROOT = path.join(import.meta.dir, "..");

export function distDir(): string {
  if (process.env.BUN_ELECTRON_DIST) return process.env.BUN_ELECTRON_DIST;
  const platform = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return path.join(PKG_ROOT, "dist", `${platform}-${arch}`);
}

function shimPath(): string {
  const dir = distDir();
  const name = process.platform === "win32" ? "bun_electron_shim.dll" : `libbun_electron_shim.${suffix}`;
  const p = path.join(dir, name);
  if (!existsSync(p)) {
    throw new Error(
      `bun-electron native shim not found at ${p}.\n` +
        `Build it first: bun run fetch-cef && bun run build (in packages/bun-electron)`,
    );
  }
  return p;
}

function cstr(s: string): Buffer {
  return Buffer.from(s + "\0", "utf8");
}

// "key=value\n" lines with percent-encoded values (see shim.h).
export function encodeKV(kv: Record<string, string | number | boolean | string[] | undefined>): string {
  let out = "";
  for (const [key, value] of Object.entries(kv)) {
    if (value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      const s = typeof v === "boolean" ? (v ? "1" : "0") : String(v);
      out += `${key}=${encodeURIComponent(s)}\n`;
    }
  }
  return out;
}

interface Shim {
  symbols: {
    be_load_library: (p: Buffer) => number;
    be_init: (p: Buffer) => number;
    be_get_event_fd: () => number;
    be_poll_events: () => bigint | number | null;
    be_free: (p: bigint | number) => void;
    be_window_create: (p: Buffer) => number;
    be_window_command: (id: number, cmd: Buffer, arg: Buffer | null) => void;
    be_window_get_state: (id: number) => bigint | number | null;
    be_window_eval_js: (id: number, code: Buffer, evalId: number) => void;
    be_capture_page: (id: number, captureId: number) => void;
    be_ipc_send: (id: number, channel: Buffer, args: Buffer) => void;
    be_ipc_reply: (id: number, invokeId: number, result: Buffer, isError: number) => void;
    be_do_message_loop_work: () => void;
    be_quit: () => void;
    be_shutdown: () => void;
    be_version: () => bigint | number | null;
  };
}

let shim: Shim | null = null;
let eventHandler: ((events: NativeEvent[]) => void) | null = null;
let initialized = false;
let pumpTimer: ReturnType<typeof setInterval> | null = null;
let scheduledPump: ReturnType<typeof setTimeout> | null = null;

function loadShim(): Shim {
  if (shim) return shim;
  const file = shimPath();

  if (process.platform === "win32") {
    // Dependent DLLs (libcef.dll) live next to the shim, not next to bun.exe;
    // widen the loader search path before dlopen.
    const kernel32 = dlopen("kernel32.dll", {
      SetDllDirectoryW: { args: [FFIType.ptr], returns: FFIType.i32 },
    });
    const wide = Buffer.from(distDir() + "\0", "utf16le");
    kernel32.symbols.SetDllDirectoryW(wide);
  }

  shim = dlopen(file, {
    be_load_library: { args: [FFIType.ptr], returns: FFIType.i32 },
    be_init: { args: [FFIType.ptr], returns: FFIType.i32 },
    be_get_event_fd: { args: [], returns: FFIType.i32 },
    be_poll_events: { args: [], returns: FFIType.ptr },
    be_free: { args: [FFIType.ptr], returns: FFIType.void },
    be_window_create: { args: [FFIType.ptr], returns: FFIType.i32 },
    be_window_command: { args: [FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.void },
    be_window_get_state: { args: [FFIType.i32], returns: FFIType.ptr },
    be_window_eval_js: { args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.void },
    be_capture_page: { args: [FFIType.i32, FFIType.i32], returns: FFIType.void },
    be_ipc_send: { args: [FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.void },
    be_ipc_reply: { args: [FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.void },
    be_do_message_loop_work: { args: [], returns: FFIType.void },
    be_quit: { args: [], returns: FFIType.void },
    be_shutdown: { args: [], returns: FFIType.void },
    be_version: { args: [], returns: FFIType.ptr },
  }) as unknown as Shim;
  return shim;
}

function takeCString(ptr: bigint | number | null): string | null {
  if (!ptr) return null;
  const s = new CString(ptr as never).toString();
  loadShim().symbols.be_free(ptr as never);
  return s;
}

export function pollAndDispatch(): void {
  if (!shim) return;
  const raw = takeCString(shim.symbols.be_poll_events());
  if (!raw) return;
  let events: NativeEvent[];
  try {
    events = JSON.parse(raw);
  } catch {
    return;
  }
  // The mac external message pump asks us to call CefDoMessageLoopWork.
  for (const ev of events) {
    if (ev.type === "pump-schedule") {
      const delay = Math.max(0, Math.min(Number(ev.delayMs) || 0, 50));
      if (scheduledPump) clearTimeout(scheduledPump);
      scheduledPump = setTimeout(() => {
        scheduledPump = null;
        shim?.symbols.be_do_message_loop_work();
      }, delay);
    }
  }
  const visible = events.filter(e => e.type !== "pump-schedule");
  if (visible.length && eventHandler) eventHandler(visible);
}

export function setEventHandler(handler: (events: NativeEvent[]) => void): void {
  eventHandler = handler;
}

export interface InitOptions {
  cacheDir?: string;
  logFile?: string;
  logSeverity?: number;
  remoteDebuggingPort?: number;
  switches?: string[];
}

export function init(options: InitOptions = {}): void {
  if (initialized) return;
  const s = loadShim();
  const dir = distDir();

  const isMac = process.platform === "darwin";
  const frameworkDir = path.join(dir, "Chromium Embedded Framework.framework");
  if (isMac) {
    const lib = path.join(frameworkDir, "Chromium Embedded Framework");
    if (!s.symbols.be_load_library(cstr(lib))) {
      throw new Error(`Failed to load CEF framework from ${lib}`);
    }
  }

  const helperName =
    process.platform === "win32"
      ? "bun-electron-helper.exe"
      : isMac
        ? path.join("bun-electron Helper.app", "Contents", "MacOS", "bun-electron Helper")
        : "bun-electron-helper";

  const kv = encodeKV({
    subprocess_path: path.join(dir, helperName),
    resources_dir: isMac ? undefined : dir,
    locales_dir: isMac ? undefined : path.join(dir, "locales"),
    framework_dir: isMac ? frameworkDir : undefined,
    cache_dir:
      options.cacheDir ??
      path.join(
        process.env.XDG_CACHE_HOME || process.env.TMPDIR || (process.platform === "win32" ? process.env.TEMP! : "/tmp"),
        `bun-electron-${process.pid}`,
      ),
    log_file: options.logFile,
    log_severity: options.logSeverity,
    remote_debugging_port: options.remoteDebuggingPort,
    switch: options.switches ?? [],
  });

  const rc = s.symbols.be_init(cstr(kv));
  if (rc !== 0) {
    throw new Error(`CEF initialization failed (exit code ${rc})`);
  }
  initialized = true;

  // Drain the native event queue on a short timer. be_poll_events returns
  // NULL when nothing is pending, so an empty tick is a single cheap FFI
  // call. The interval also keeps Bun's event loop alive while the app runs.
  // (The shim exposes a notification pipe fd as well, but Bun currently has
  // no good primitive for sleeping on a raw pipe fd from JS.)
  pumpTimer = setInterval(() => {
    pollAndDispatch();
    if (isMac) s.symbols.be_do_message_loop_work();
  }, 2);
}

export function isInitialized(): boolean {
  return initialized;
}

export function windowCreate(kv: Record<string, string | number | boolean | undefined>): number {
  return loadShim().symbols.be_window_create(cstr(encodeKV(kv)));
}

export function windowCommand(id: number, cmd: string, arg?: string): void {
  loadShim().symbols.be_window_command(id, cstr(cmd), arg === undefined ? null : cstr(arg));
}

export function windowGetState(id: number): Record<string, unknown> | null {
  const raw = takeCString(loadShim().symbols.be_window_get_state(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function windowEvalJs(id: number, code: string, evalId: number): void {
  loadShim().symbols.be_window_eval_js(id, cstr(code), evalId);
}

export function capturePage(id: number, captureId: number): void {
  loadShim().symbols.be_capture_page(id, captureId);
}

export function ipcSend(id: number, channel: string, argsJson: string): void {
  loadShim().symbols.be_ipc_send(id, cstr(channel), cstr(argsJson));
}

export function ipcReply(id: number, invokeId: number, resultJson: string, isError: boolean): void {
  loadShim().symbols.be_ipc_reply(id, invokeId, cstr(resultJson), isError ? 1 : 0);
}

export function quit(): void {
  if (initialized) loadShim().symbols.be_quit();
}

export function shutdown(): void {
  if (!initialized) return;
  initialized = false;
  if (pumpTimer) clearInterval(pumpTimer);
  if (scheduledPump) clearTimeout(scheduledPump);
  loadShim().symbols.be_shutdown();
}

export function version(): string {
  return takeCString(loadShim().symbols.be_version()) ?? "unknown";
}
