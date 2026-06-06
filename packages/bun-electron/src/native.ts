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

// Pure, platform-parameterized layout resolution. Exposed so the per-OS path
// branches (dist dir, shim/helper names, mac framework bundle) can be verified
// deterministically from any host, not just the one we're running on.
export interface PlatformLayout {
  distDir: string;
  shimName: string;
  /** Helper subprocess path, relative to distDir. */
  helperRelPath: string;
  /** mac framework bundle dir, relative to distDir (undefined off mac). */
  frameworkRelPath?: string;
  /** CEF resources dir for CefSettings.resources_dir (undefined on mac). */
  resourcesDir?: string;
  /** CEF locales dir (undefined on mac). */
  localesDir?: string;
}

export function resolveLayout(
  platform: NodeJS.Platform,
  arch: string,
  pkgRoot: string = PKG_ROOT,
  distOverride?: string,
): PlatformLayout {
  const osName = platform === "darwin" ? "macos" : platform === "win32" ? "windows" : "linux";
  const archName = arch === "arm64" ? "arm64" : "x64";
  const dir = distOverride ?? path.join(pkgRoot, "dist", `${osName}-${archName}`);
  const dylibSuffix = platform === "darwin" ? "dylib" : "so";
  if (platform === "win32") {
    return {
      distDir: dir,
      shimName: "bun_electron_shim.dll",
      helperRelPath: "bun-electron-helper.exe",
      resourcesDir: dir,
      localesDir: path.join(dir, "locales"),
    };
  }
  if (platform === "darwin") {
    return {
      distDir: dir,
      shimName: "libbun_electron_shim.dylib",
      helperRelPath: path.join("bun-electron Helper.app", "Contents", "MacOS", "bun-electron Helper"),
      frameworkRelPath: "Chromium Embedded Framework.framework",
      // mac reads resources/locales from inside the framework bundle.
    };
  }
  return {
    distDir: dir,
    shimName: `libbun_electron_shim.${dylibSuffix}`,
    helperRelPath: "bun-electron-helper",
    resourcesDir: dir,
    localesDir: path.join(dir, "locales"),
  };
}

export function distDir(): string {
  if (process.env.BUN_ELECTRON_DIST) return process.env.BUN_ELECTRON_DIST;
  return resolveLayout(process.platform, process.arch).distDir;
}

function shimPath(): string {
  const dir = distDir();
  // suffix is correct for the *running* platform; resolveLayout covers others.
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

// Build the be_init kv pairs for a platform. Pure (no FFI / no side effects)
// so the per-OS init layout — mac framework dir, win/linux resources+locales,
// helper subprocess path — can be verified on any host.
export function buildInitKV(
  platform: NodeJS.Platform,
  arch: string,
  options: InitOptions,
  layout: PlatformLayout,
  env: NodeJS.ProcessEnv = process.env,
  pid: number = process.pid,
): Record<string, string | number | boolean | string[] | undefined> {
  const dir = layout.distDir;
  const isMac = platform === "darwin";
  const tempBase =
    env.XDG_CACHE_HOME || env.TMPDIR || (platform === "win32" ? env.TEMP! : "/tmp");
  return {
    subprocess_path: path.join(dir, layout.helperRelPath),
    resources_dir: layout.resourcesDir,
    locales_dir: layout.localesDir,
    framework_dir: layout.frameworkRelPath ? path.join(dir, layout.frameworkRelPath) : undefined,
    cache_dir: options.cacheDir ?? path.join(tempBase, `bun-electron-${pid}`),
    log_file: options.logFile,
    log_severity: options.logSeverity,
    remote_debugging_port: options.remoteDebuggingPort,
    switch: options.switches ?? [],
    custom_scheme: options.customSchemes ?? [],
  };
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
    be_send_input_event: (id: number, kv: Buffer) => void;
    be_window_get_handle: (id: number) => bigint | number;
    be_devtools_method: (id: number, callId: number, method: Buffer, params: Buffer) => void;
    be_allow_ipc_origin: (origin: Buffer) => void;
    be_web_request_set_active: (active: number) => void;
    be_web_request_continue: (requestId: number, cancel: number) => void;
    be_resource_reply: (id: number, status: number, mime: Buffer, body: Buffer) => void;
    be_run_file_dialog: (id: number, dialogId: number, kv: Buffer) => void;
    be_cookies_op: (opId: number, op: Buffer, kv: Buffer) => void;
    be_screen_info: () => bigint | number | null;
    be_enumerate_windows: () => bigint | number | null;
    be_capture_window: (xid: number) => bigint | number | null;
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
    be_send_input_event: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.void },
    be_window_get_handle: { args: [FFIType.i32], returns: FFIType.u64 },
    be_devtools_method: { args: [FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.void },
    be_allow_ipc_origin: { args: [FFIType.ptr], returns: FFIType.void },
    be_web_request_set_active: { args: [FFIType.i32], returns: FFIType.void },
    be_web_request_continue: { args: [FFIType.i32, FFIType.i32], returns: FFIType.void },
    be_resource_reply: { args: [FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.void },
    be_run_file_dialog: { args: [FFIType.i32, FFIType.i32, FFIType.ptr], returns: FFIType.void },
    be_cookies_op: { args: [FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.void },
    be_screen_info: { args: [], returns: FFIType.ptr },
    be_enumerate_windows: { args: [], returns: FFIType.ptr },
    be_capture_window: { args: [FFIType.u32], returns: FFIType.ptr },
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
  customSchemes?: string[];
}

export function init(options: InitOptions = {}): void {
  if (initialized) return;
  const s = loadShim();
  const layout = resolveLayout(process.platform, process.arch, PKG_ROOT, distDir());

  if (process.platform === "darwin" && layout.frameworkRelPath) {
    const lib = path.join(layout.distDir, layout.frameworkRelPath, "Chromium Embedded Framework");
    if (!s.symbols.be_load_library(cstr(lib))) {
      throw new Error(`Failed to load CEF framework from ${lib}`);
    }
  }

  const kv = encodeKV(buildInitKV(process.platform, process.arch, options, layout));

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
  const isMac = process.platform === "darwin";
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

export function sendInputEvent(id: number, kv: Record<string, string | number | boolean | undefined>): void {
  loadShim().symbols.be_send_input_event(id, cstr(encodeKV(kv)));
}

export function windowGetHandle(id: number): bigint {
  return BigInt(loadShim().symbols.be_window_get_handle(id));
}

export function devtoolsMethod(id: number, callId: number, method: string, paramsJson: string): void {
  loadShim().symbols.be_devtools_method(id, callId, cstr(method), cstr(paramsJson));
}

export function allowIpcOrigin(origin: string): void {
  loadShim().symbols.be_allow_ipc_origin(cstr(origin));
}

export function webRequestSetActive(active: boolean): void {
  loadShim().symbols.be_web_request_set_active(active ? 1 : 0);
}

export function webRequestContinue(requestId: number, cancel: boolean): void {
  loadShim().symbols.be_web_request_continue(requestId, cancel ? 1 : 0);
}

export function resourceReply(id: number, status: number, mime: string, bodyBase64: string): void {
  loadShim().symbols.be_resource_reply(id, status, cstr(mime), cstr(bodyBase64));
}

export function runFileDialog(id: number, dialogId: number, kv: Record<string, string | number | boolean | string[] | undefined>): void {
  loadShim().symbols.be_run_file_dialog(id, dialogId, cstr(encodeKV(kv)));
}

export function cookiesOp(opId: number, op: string, kv: Record<string, string | number | boolean | undefined>): void {
  loadShim().symbols.be_cookies_op(opId, cstr(op), cstr(encodeKV(kv)));
}

export function screenInfo(): unknown[] {
  const raw = takeCString(loadShim().symbols.be_screen_info());
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function enumerateWindows(): Array<{ xid: number; title: string; width: number; height: number }> {
  const raw = takeCString(loadShim().symbols.be_enumerate_windows());
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function captureWindow(xid: number): { width: number; height: number; data: string } | null {
  const raw = takeCString(loadShim().symbols.be_capture_window(xid));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
