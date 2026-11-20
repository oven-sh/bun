// Native desktop APIs for Bun (`bun:desktop`), aligned with Electron's core primitives.
const { EventEmitter } = require("node:events");

const DesktopWindowNative = $bindgen("desktop_window.bind.ts", "DesktopWindow");
const nativeApp = $bindgen("desktop_app.bind.ts", "app");
const nativeIpcMain = $bindgen("desktop_ipc.bind.ts", "ipcMain");
const nativeProtocol = $bindgen("desktop_protocol.bind.ts", "protocol");

let nextPortId = 1;
class MessagePortMain extends EventEmitter {
  readonly _id: number;
  _peer: MessagePortMain | null = null;
  _senderWin: { sendToRenderer(ch: string, argsJson: string): void } | null = null;
  _closed = false;

  constructor(id: number) {
    super();
    this._id = id;
  }

  start() {}
  ref() {}
  unref() {}

  postMessage(data: unknown) {
    if (this._closed) return;
    if (this._senderWin) {
      this._senderWin.sendToRenderer("__bun_port_data__", JSON.stringify([this._id, data]));
      return;
    }
    if (this._peer && !this._peer._closed) {
      if (this._peer._senderWin) {
        this._peer._senderWin.sendToRenderer("__bun_port_data__", JSON.stringify([this._peer._id, data]));
      } else {
        queueMicrotask(() => {
          if (!this._peer?._closed) this._peer?.emit("message", { data });
        });
      }
    }
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this.emit("close");
    if (this._peer && !this._peer._closed) {
      if (this._peer._senderWin) {
        this._peer._senderWin.sendToRenderer("__bun_port_close__", JSON.stringify([this._peer._id]));
      } else {
        this._peer.close();
      }
    }
  }
}

class MessageChannelMain {
  readonly port1: MessagePortMain;
  readonly port2: MessagePortMain;
  constructor() {
    this.port1 = new MessagePortMain(nextPortId++);
    this.port2 = new MessagePortMain(nextPortId++);
    this.port1._peer = this.port2;
    this.port2._peer = this.port1;
  }
}

const activeTransferredPorts = new Map<number, MessagePortMain>();

type NativeWinLike = {
  id: number;
  getTitle(): string;
  sendToRenderer(ch: string, argsJson: string): void;
  evaluateJavaScript?(code: string): Promise<unknown>;
};

class WebContents extends EventEmitter {
  static #byId = new Map<number, WebContents>();
  #win: NativeWinLike;
  #url = "about:blank";
  #destroyed = false;
  #loading = false;
  #zoomLevel = 0;
  #zoomFactor = 1;
  mainFrame = { url: "about:blank" };

  constructor(win: NativeWinLike) {
    super();
    this.#win = win;
    WebContents.#byId.set(win.id, this);
  }

  static getAllWebContents(): WebContents[] {
    return Array.from(WebContents.#byId.values());
  }

  static fromId(id: number): WebContents | null {
    return WebContents.#byId.get(id) ?? null;
  }

  get id(): number {
    return this.#win.id;
  }

  get session() {
    return session.defaultSession;
  }

  _setURL(url: string) {
    this.#url = url;
    this.mainFrame.url = url;
  }

  _setLoading(loading: boolean) {
    this.#loading = loading;
  }

  isLoading(): boolean {
    return this.#loading;
  }

  _setDestroyed(destroyed: boolean) {
    this.#destroyed = destroyed;
    if (destroyed) {
      WebContents.#byId.delete(this.#win.id);
      this.emit("destroyed");
    }
  }

  isDestroyed(): boolean {
    return this.#destroyed;
  }

  getURL(): string {
    return this.#url;
  }

  getTitle(): string {
    return this.#win.getTitle();
  }

  openDevTools(_options?: unknown) {}
  setIgnoreMenuShortcuts(_ignore: boolean) {}
  setWindowOpenHandler(_handler: unknown) {}
  setBackgroundThrottling(_allowed: boolean) {}
  setVisualZoomLevelLimits(_min: number, _max: number): Promise<void> {
    return Promise.resolve();
  }
  getZoomFactor(): number {
    return this.#zoomFactor;
  }
  setZoomFactor(factor: number) {
    this.#zoomFactor = Number(factor) > 0 ? Number(factor) : 1;
  }
  getZoomLevel(): number {
    return this.#zoomLevel;
  }
  setZoomLevel(level: number) {
    this.#zoomLevel = Number(level) || 0;
  }

  async executeJavaScript(code: string, _userGesture?: boolean): Promise<unknown> {
    if (this.#destroyed || typeof this.#win.evaluateJavaScript !== "function") return undefined;
    const raw = await this.#win.evaluateJavaScript(String(code));
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  }

  async printToPDF(_options?: unknown): Promise<Uint8Array> {
    return new Uint8Array(0);
  }

  async capturePage(_rect?: unknown): Promise<{ toPNG(): Uint8Array }> {
    return { toPNG: () => new Uint8Array(0) };
  }

  postMessage(channel: string, message: unknown, transfer?: unknown[]) {
    if (this.#destroyed) return;
    const portIds: number[] = [];
    if (Array.isArray(transfer)) {
      for (const item of transfer) {
        if (item instanceof MessagePortMain) {
          item._senderWin = this.#win;
          activeTransferredPorts.set(item._id, item);
          if (item._peer) item._peer._senderWin = null;
          portIds.push(item._id);
        }
      }
    }
    this.#win.sendToRenderer("__bun_port_open__", JSON.stringify([channel, message, portIds]));
  }

  send(channel: string, ...args: unknown[]) {
    this.#win.sendToRenderer(channel, JSON.stringify(args));
  }
}

interface WindowCapabilities {
  ipc?: {
    defaultPolicy?: "allow" | "deny";
    allow?: string[];
    deny?: string[];
    origins?: string[];
  };
  protocol?: {
    schemes?: string[];
    roots?: string[];
  };
  navigation?: {
    allow?: string[];
    allowNewWindow?: boolean;
    allowSubframes?: boolean;
  };
  shell?: {
    openExternal?: string[];
  };
}

interface WebPreferences {
  preload?: string;
  sandbox?: boolean;
  nodeIntegration?: boolean;
  contextIsolation?: boolean;
}

interface WindowCapabilityState {
  ipcDefaultPolicy: "allow" | "deny";
  ipcAllow: Set<string> | null;
  ipcDeny: Set<string> | null;
  ipcOrigins: Set<string> | null;
  protocolSchemes: Set<string> | null;
  protocolRoots: string[] | null;
  navigationAllow: string[] | null;
  allowNewWindow: boolean;
  allowSubframes: boolean;
  shellOpenExternal: string[] | null;
  sandbox: boolean;
  nodeIntegration: boolean;
  contextIsolation: boolean;
}

const windowCapabilities = new Map<number, WindowCapabilityState>();

function compileWindowCapabilities(
  capabilities?: WindowCapabilities,
  webPreferences?: WebPreferences,
): WindowCapabilityState {
  const sandbox = Boolean(webPreferences?.sandbox);
  const nodeIntegration = sandbox ? false : Boolean(webPreferences?.nodeIntegration ?? false);
  const contextIsolation = sandbox ? true : webPreferences?.contextIsolation !== false;

  const ipc = capabilities?.ipc;
  // Electron's `sandbox: true` disables Node integration & enforces context isolation without
  // blocking IPC; explicit `capabilities.ipc.defaultPolicy` still controls deny-by-default.
  const ipcDefaultPolicy: "allow" | "deny" = ipc?.defaultPolicy ?? "allow";
  const ipcAllow = Array.isArray(ipc?.allow) ? new Set(ipc.allow.map(String)) : null;
  const ipcDeny = Array.isArray(ipc?.deny) ? new Set(ipc.deny.map(String)) : null;
  const ipcOrigins = Array.isArray(ipc?.origins) ? new Set(ipc.origins.map(String)) : null;

  const proto = capabilities?.protocol;
  const protocolSchemes = Array.isArray(proto?.schemes)
    ? new Set(proto.schemes.map(s => String(s).toLowerCase()))
    : null;
  let protocolRoots: string[] | null = null;
  if (Array.isArray(proto?.roots)) {
    const pathMod = require("node:path");
    const cwd = process.cwd();
    protocolRoots = proto.roots.map(r => pathMod.resolve(cwd, String(r)));
  }

  const nav = capabilities?.navigation;
  const navigationAllow = Array.isArray(nav?.allow) ? nav.allow.map(String) : null;
  const allowNewWindow = Boolean(nav?.allowNewWindow ?? false);
  const allowSubframes = Boolean(nav?.allowSubframes ?? false);

  const shellOpenExternal = Array.isArray(capabilities?.shell?.openExternal)
    ? capabilities.shell.openExternal.map(String)
    : null;

  return {
    ipcDefaultPolicy,
    ipcAllow,
    ipcDeny,
    ipcOrigins,
    protocolSchemes,
    protocolRoots,
    navigationAllow,
    allowNewWindow,
    allowSubframes,
    shellOpenExternal,
    sandbox,
    nodeIntegration,
    contextIsolation,
  };
}

function isPathInside(root: string, target: string): boolean {
  const pathMod = require("node:path");
  const rel = pathMod.relative(root, target);
  return rel !== ".." && !rel.startsWith(".." + pathMod.sep) && !pathMod.isAbsolute(rel);
}

function matchesUrlPattern(urlStr: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.includes("*")) {
    const parts = pattern.split("*");
    let pos = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      if (i === 0) {
        if (!urlStr.startsWith(part)) return false;
        pos = part.length;
      } else if (i === parts.length - 1) {
        return urlStr.endsWith(part) && urlStr.length - part.length >= pos;
      } else {
        const idx = urlStr.indexOf(part, pos);
        if (idx === -1) return false;
        pos = idx + part.length;
      }
    }
    return true;
  }
  try {
    const parsed = new URL(urlStr);
    if (parsed.origin === pattern || parsed.href === pattern) return true;
  } catch {}
  return urlStr === pattern || urlStr.startsWith(pattern);
}

function isIpcAllowed(windowId: number, channel: string, winUrl?: string): boolean {
  const cap = windowCapabilities.get(windowId);
  if (!cap) return true;
  if (cap.ipcOrigins !== null) {
    let origin = "";
    if (winUrl) {
      try {
        origin = new URL(winUrl).origin;
      } catch {}
    }
    if (!cap.ipcOrigins.has(origin)) return false;
  }
  if (cap.ipcDeny?.has(channel)) return false;
  if (cap.ipcAllow?.has(channel)) return true;
  return cap.ipcDefaultPolicy === "allow";
}

function isProtocolSchemeAllowed(windowId: number, scheme: string): boolean {
  const cap = windowCapabilities.get(windowId);
  if (!cap || cap.protocolSchemes === null) return true;
  return cap.protocolSchemes.has(scheme);
}

type DesktopBackendInput =
  | "webkit"
  | "chrome"
  | "cef"
  | {
      type: "webkit" | "chrome" | "cef";
      path?: string;
      url?: string | false;
      args?: string[];
    };

let nextCdpWinId = 100_000;

function resolveBackendSpec(raw: unknown): {
  type: "webkit" | "chrome" | "cef";
  path?: string;
  url?: string | false;
  args?: string[];
} {
  const input = raw ?? process.env.BUN_DESKTOP_BACKEND;
  if (!input) {
    return { type: process.platform === "darwin" ? "webkit" : "chrome" };
  }
  if (typeof input === "string") {
    if (input === "webkit" || input === "chrome" || input === "cef") {
      return { type: input };
    }
    throw new Error(`Unknown desktop backend "${input}". Expected "webkit", "chrome", or "cef".`);
  }
  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;
    const t = String(obj.type ?? "webkit");
    if (t !== "webkit" && t !== "chrome" && t !== "cef") {
      throw new Error(`Unknown desktop backend type "${t}". Expected "webkit", "chrome", or "cef".`);
    }
    return {
      type: t,
      path: typeof obj.path === "string" ? obj.path : undefined,
      url: typeof obj.url === "string" || obj.url === false ? obj.url : undefined,
      args: Array.isArray(obj.args) ? obj.args.map(String) : undefined,
    };
  }
  return { type: process.platform === "darwin" ? "webkit" : "chrome" };
}

function findCdpExecutable(spec: { type: "chrome" | "cef"; path?: string }): string {
  const fs = require("node:fs");
  const candidates: string[] = [];
  if (spec.path) candidates.push(spec.path);
  if (spec.type === "cef") {
    if (process.env.BUN_CEF_PATH) candidates.push(process.env.BUN_CEF_PATH);
    if (process.env.CEF_PATH) candidates.push(process.env.CEF_PATH);
    if (process.platform === "darwin") {
      candidates.push(
        "/Applications/cefsimple.app/Contents/MacOS/cefsimple",
        "/Applications/CEF.app/Contents/MacOS/CEF",
      );
    } else if (process.platform === "linux") {
      candidates.push("/usr/local/bin/cefsimple", "/usr/bin/cefsimple");
    } else if (process.platform === "win32") {
      candidates.push("C:\\Program Files\\CEF\\cefsimple.exe");
    }
    for (const c of candidates) {
      if (c && fs.existsSync(c)) return c;
    }
    throw new Error(
      'CEF backend requested, but no CEF executable was found. Pass backend: { type: "cef", path: "/path/to/cef-app" } or set BUN_CEF_PATH (or use backend: "chrome" for Chromium/Chrome/Edge).',
    );
  }

  if (process.env.BUN_CHROME_PATH) candidates.push(process.env.BUN_CHROME_PATH);
  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    );
  } else if (process.platform === "win32") {
    const pf = process.env["ProgramFiles"] || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    candidates.push(
      `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
    );
  } else {
    for (const bin of ["google-chrome-stable", "google-chrome", "chromium-browser", "chromium", "microsoft-edge"]) {
      const found = Bun.which(bin);
      if (found) candidates.push(found);
    }
  }
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  throw new Error(
    'Chrome/Chromium backend requested, but no browser executable was found. Pass backend: { type: "chrome", path: "/path/to/chrome" } or set BUN_CHROME_PATH.',
  );
}

const CDP_BRIDGE_JS = `(() => {
  if (window.__bunIpcResolve) return;
  let nextReqId = 1;
  const pending = new Map();
  const listeners = new Map();
  window.__bunIpcResolve = (reqId, ok, jsonStr) => {
    const entry = pending.get(reqId);
    if (!entry) return;
    pending.delete(reqId);
    if (ok) {
      try { entry.resolve(jsonStr === undefined ? undefined : JSON.parse(jsonStr)); }
      catch (e) { entry.reject(e); }
    } else {
      entry.reject(new Error(String(jsonStr || "IPC error")));
    }
  };
  window.__bunIpcDispatch = (channel, jsonStr) => {
    const set = listeners.get(channel);
    if (!set) return;
    let args = [];
    try { args = jsonStr ? JSON.parse(jsonStr) : []; } catch {}
    for (const fn of set) fn({ senderId: 0 }, ...args);
  };
  let _binWs = null;
  let _binWsPromise = null;
  const _binPending = new Map();
  const _textEnc = new TextEncoder();
  const _textDec = new TextDecoder();
  function _getBinWs() {
    if (_binWs && _binWs.readyState === 1) return Promise.resolve(_binWs);
    if (_binWsPromise) return _binWsPromise;
    const port = window.__bunDesktopBinWsPort;
    if (!port) return Promise.reject(new Error("Binary IPC WebSocket not configured"));
    _binWsPromise = new Promise((resolve, reject) => {
      const ws = new WebSocket("ws://127.0.0.1:" + port);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => { _binWs = ws; _binWsPromise = null; resolve(ws); };
      ws.onerror = () => { _binWsPromise = null; reject(new Error("Binary IPC WebSocket error")); };
      ws.onclose = () => {
        if (_binWs === ws) _binWs = null;
        _binWsPromise = null;
        for (const [, p] of _binPending) p.reject(new Error("Binary IPC WebSocket closed"));
        _binPending.clear();
      };
      ws.onmessage = (ev) => {
        if (!(ev.data instanceof ArrayBuffer) || ev.data.byteLength < 5) return;
        const view = new DataView(ev.data);
        const reqId = view.getUint32(0, true);
        const ok = view.getUint8(4) !== 0;
        const entry = _binPending.get(reqId);
        if (!entry) return;
        _binPending.delete(reqId);
        const payload = new Uint8Array(ev.data, 5);
        if (ok) entry.resolve(payload);
        else entry.reject(new Error(_textDec.decode(payload) || "IPC binary error"));
      };
    });
    return _binWsPromise;
  }
  window.bunDesktopIpc = {
    async invokeBinary(channel, data) {
      const ws = await _getBinWs();
      const reqId = nextReqId++;
      const chBytes = _textEnc.encode(String(channel));
      let bodyBytes;
      if (data === undefined || data === null) {
        bodyBytes = new Uint8Array(0);
      } else if (ArrayBuffer.isView(data)) {
        bodyBytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      } else if (data instanceof ArrayBuffer) {
        bodyBytes = new Uint8Array(data);
      } else {
        throw new TypeError("invokeBinary data must be a Uint8Array, ArrayBuffer, or ArrayBufferView");
      }
      const frame = new Uint8Array(8 + chBytes.byteLength + bodyBytes.byteLength);
      const dv = new DataView(frame.buffer);
      dv.setUint32(0, reqId, true);
      dv.setUint32(4, chBytes.byteLength, true);
      frame.set(chBytes, 8);
      frame.set(bodyBytes, 8 + chBytes.byteLength);
      return new Promise((resolve, reject) => {
        _binPending.set(reqId, { resolve, reject });
        ws.send(frame);
      });
    },
    invoke(channel, ...args) {
      const reqId = nextReqId++;
      return new Promise((resolve, reject) => {
        pending.set(reqId, { resolve, reject });
        window.__bunDesktopCdp(JSON.stringify({ reqId, isInvoke: true, channel: String(channel), args }));
      });
    },
    send(channel, ...args) {
      window.__bunDesktopCdp(JSON.stringify({ reqId: 0, isInvoke: false, channel: String(channel), args }));
    },
    on(channel, fn) {
      let s = listeners.get(channel);
      if (!s) { s = new Set(); listeners.set(channel, s); }
      s.add(fn);
      return window.bunDesktopIpc;
    },
    once(channel, fn) {
      const wrapped = (ev, ...args) => {
        window.bunDesktopIpc.removeListener(channel, wrapped);
        fn(ev, ...args);
      };
      return window.bunDesktopIpc.on(channel, wrapped);
    },
    off(channel, fn) {
      listeners.get(channel)?.delete(fn);
      return window.bunDesktopIpc;
    },
    removeListener(channel, fn) {
      listeners.get(channel)?.delete(fn);
      return window.bunDesktopIpc;
    },
    removeAllListeners(channel) {
      if (channel === undefined) listeners.clear();
      else listeners.delete(channel);
      return window.bunDesktopIpc;
    },
  };
  if (typeof window.fetch === "function") {
    const origFetch = window.fetch.bind(window);
    window.fetch = function(input, init) {
      if (typeof input === "string" && input.startsWith("app://")) {
        input = "http://bun-app.local/" + input.slice(6);
      } else if (input instanceof Request && input.url.startsWith("app://")) {
        input = new Request("http://bun-app.local/" + input.url.slice(6), input);
      }
      return origFetch(input, init);
    };
  }
  const _cdpContextBridge = {
    exposeInMainWorld(key, api) {
      window[String(key)] = api;
    },
  };
  if (typeof window.require !== "function") {
    window.require = function(id) {
      if (id === "electron") {
        return {
          ipcRenderer: window.bunDesktopIpc,
          contextBridge: _cdpContextBridge,
          webUtils: { getPathForFile(f) { return (f && f.path) || (f && f.name) || ""; } },
        };
      }
      throw new Error("Cannot find module '" + id + "'");
    };
  }
})();`;

class CdpWindowAdapter {
  readonly id: number;
  #spec: { type: "chrome" | "cef"; path?: string; url?: string | false; args?: string[] };
  #opts: Record<string, unknown>;
  #title: string;
  #width: number;
  #height: number;
  #maximized = false;
  #proc: ReturnType<typeof Bun.spawn> | null = null;
  #userDataDir: string | null = null;
  #ws: WebSocket | null = null;
  #binServer: ReturnType<typeof Bun.serve> | null = null;
  #sessionId: string | null = null;
  #nextMsgId = 1;
  #pendingRpc = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  #readyPromise: Promise<void> | null = null;
  #loadWaiter: (() => void) | null = null;
  #closed = false;

  constructor(
    spec: { type: "chrome" | "cef"; path?: string; url?: string | false; args?: string[] },
    opts: Record<string, unknown>,
  ) {
    this.id = nextCdpWinId++;
    this.#spec = spec;
    this.#opts = opts;
    this.#title = typeof opts.title === "string" ? opts.title : "Bun Desktop";
    this.#width = typeof opts.width === "number" ? opts.width : 800;
    this.#height = typeof opts.height === "number" ? opts.height : 600;
    // Validate binary eagerly so unsupported/missing CEF/Chrome fails synchronously in constructor.
    if (typeof spec.url !== "string") {
      findCdpExecutable(spec);
    }
  }

  async #ensureConnected(): Promise<void> {
    if (this.#readyPromise) return this.#readyPromise;
    this.#readyPromise = (async () => {
      let wsUrl = typeof this.#spec.url === "string" ? this.#spec.url : "";
      if (!wsUrl) {
        const fs = require("node:fs");
        const os = require("node:os");
        const path = require("node:path");
        const exe = findCdpExecutable(this.#spec);
        this.#userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bun-desktop-cdp-"));
        const show = this.#opts.show !== false;
        const args = [
          "--remote-debugging-port=0",
          `--user-data-dir=${this.#userDataDir}`,
          "--no-first-run",
          "--no-default-browser-check",
          `--window-size=${this.#width},${this.#height}`,
          ...(show ? ["--app=about:blank"] : ["--headless=new"]),
          ...(this.#spec.args ?? []),
        ];
        this.#proc = Bun.spawn({ cmd: [exe, ...args], stdout: "ignore", stderr: "ignore" });
        (this.#proc as any).unref?.();
        const portFile = path.join(this.#userDataDir, "DevToolsActivePort");
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          if (fs.existsSync(portFile)) {
            const lines = fs.readFileSync(portFile, "utf8").trim().split(/\r?\n/);
            if (lines.length >= 2 && lines[0] && lines[1]) {
              wsUrl = `ws://127.0.0.1:${lines[0].trim()}${lines[1].trim()}`;
              break;
            }
          }
          await Bun.sleep(10);
        }
        if (!wsUrl) throw new Error(`${this.#spec.type} exited or timed out before writing DevToolsActivePort`);
      }

      const ws = new WebSocket(wsUrl);
      this.#ws = ws;
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("Failed to connect to CDP WebSocket"));
      });

      ws.onmessage = ev => {
        const msg = JSON.parse(String(ev.data));
        if (typeof msg.id === "number") {
          const p = this.#pendingRpc.get(msg.id);
          if (p) {
            this.#pendingRpc.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error.message || "CDP error"));
            else p.resolve(msg.result);
          }
          return;
        }
        if (msg.method === "Page.loadEventFired" && this.#loadWaiter) {
          const w = this.#loadWaiter;
          this.#loadWaiter = null;
          w();
        } else if (msg.method === "Runtime.bindingCalled" && msg.params?.name === "__bunDesktopCdp") {
          this.#handleCdpIpc(msg.params.payload);
        } else if (msg.method === "Fetch.requestPaused") {
          void this.#handleCdpFetch(msg.params);
        }
      };

      const targets = await this.#cdp("Target.getTargets", {});
      let pageTarget = (targets?.targetInfos ?? []).find((t: any) => t.type === "page");
      if (!pageTarget) {
        const created = await this.#cdp("Target.createTarget", { url: "about:blank" });
        pageTarget = { targetId: created.targetId };
      }
      const attached = await this.#cdp("Target.attachToTarget", { targetId: pageTarget.targetId, flatten: true });
      this.#sessionId = attached.sessionId;

      await this.#cdp("Page.enable", {}, true);
      await this.#cdp("Runtime.enable", {}, true);
      await this.#cdp("Runtime.addBinding", { name: "__bunDesktopCdp" }, true);
      if (!this.#binServer) {
        const winId = this.id;
        this.#binServer = Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          fetch(req, server) {
            if (server.upgrade(req)) return;
            return new Response("Not found", { status: 404 });
          },
          websocket: {
            message: (ws, message) => {
              const raw =
                message instanceof Uint8Array
                  ? message
                  : message instanceof ArrayBuffer
                    ? new Uint8Array(message)
                    : null;
              if (!raw || raw.byteLength < 8) return;
              const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
              const reqId = dv.getUint32(0, true);
              const chLen = dv.getUint32(4, true);
              if (8 + chLen > raw.byteLength) return;
              const channel = new TextDecoder().decode(raw.subarray(8, 8 + chLen));
              const data = raw.subarray(8 + chLen);
              const sendReply = (ok: boolean, payload: Uint8Array) => {
                const out = new Uint8Array(5 + payload.byteLength);
                const outDv = new DataView(out.buffer);
                outDv.setUint32(0, reqId, true);
                outDv.setUint8(4, ok ? 1 : 0);
                out.set(payload, 5);
                try {
                  ws.sendBinary(out);
                } catch {}
              };
              const handler = ipcMain._getBinaryHandler(channel);
              if (!handler) {
                sendReply(false, new TextEncoder().encode(`No binary handler registered for '${channel}'`));
                return;
              }
              const win = BrowserWindow.getAllWindows().find(w => w.id === winId);
              const event = { senderId: winId, sender: win?.webContents };
              Promise.resolve()
                .then(() => handler(event, data))
                .then(
                  res => {
                    if (res === undefined || res === null) {
                      sendReply(true, new Uint8Array(0));
                    } else if (ArrayBuffer.isView(res)) {
                      sendReply(true, new Uint8Array(res.buffer, res.byteOffset, res.byteLength));
                    } else if (res instanceof ArrayBuffer) {
                      sendReply(true, new Uint8Array(res));
                    } else {
                      sendReply(
                        false,
                        new TextEncoder().encode(
                          `Binary IPC handler for '${channel}' must return Uint8Array, ArrayBuffer, or ArrayBufferView`,
                        ),
                      );
                    }
                  },
                  err => {
                    const msg = err instanceof Error ? err.message : String(err);
                    sendReply(false, new TextEncoder().encode(msg));
                  },
                );
            },
          },
        });
      }
      await this.#cdp(
        "Page.addScriptToEvaluateOnNewDocument",
        { source: `window.__bunDesktopBinWsPort = ${this.#binServer.port};\n${CDP_BRIDGE_JS}` },
        true,
      );
      if (typeof this.#opts.preload === "string" && this.#opts.preload) {
        const preloadSrc = await Bun.file(this.#opts.preload)
          .text()
          .catch(() => "");
        if (preloadSrc) {
          await this.#cdp("Page.addScriptToEvaluateOnNewDocument", { source: preloadSrc }, true);
        }
      }
      await this.#cdp(
        "Fetch.enable",
        { patterns: [{ urlPattern: "http://bun-app.local/*", requestStage: "Request" }] },
        true,
      );
    })();
    return this.#readyPromise;
  }

  #cdp(method: string, params: Record<string, unknown>, useSession = false): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.#ws || this.#closed) return reject(new Error("CDP session closed"));
      const id = this.#nextMsgId++;
      this.#pendingRpc.set(id, { resolve, reject });
      const payload: Record<string, unknown> = { id, method, params };
      if (useSession && this.#sessionId) payload.sessionId = this.#sessionId;
      this.#ws.send(JSON.stringify(payload));
    });
  }

  #handleCdpIpc(raw: string) {
    let msg: { reqId?: number; isInvoke?: boolean; channel?: string; args?: unknown[] };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const reqId = Number(msg.reqId ?? 0);
    const channel = String(msg.channel ?? "");
    const args = Array.isArray(msg.args) ? msg.args : [];
    const win = BrowserWindow.getAllWindows().find(w => w.id === this.id);
    if (!isIpcAllowed(this.id, channel, win?.webContents.getURL())) {
      if (msg.isInvoke) {
        void this.#cdp(
          "Runtime.evaluate",
          {
            expression: `window.__bunIpcResolve(${reqId},false,${JSON.stringify(`IPC channel '${channel}' denied by window capabilities`)})`,
          },
          true,
        ).catch(() => {});
      }
      return;
    }
    const event = {
      senderId: this.id,
      sender: win?.webContents,
      senderFrame: { url: win?.webContents.getURL() ?? "about:blank" },
    };
    if (msg.isInvoke) {
      const handler = ipcMain._getHandler(channel);
      if (!handler) {
        void this.#cdp(
          "Runtime.evaluate",
          {
            expression: `window.__bunIpcResolve(${reqId},false,${JSON.stringify(`No handler registered for '${channel}'`)})`,
          },
          true,
        ).catch(() => {});
        return;
      }
      Promise.resolve()
        .then(() => handler(event, ...args))
        .then(
          res => {
            const json = res === undefined ? "null" : JSON.stringify(res);
            void this.#cdp(
              "Runtime.evaluate",
              {
                expression: `window.__bunIpcResolve(${reqId},true,${JSON.stringify(json ?? "null")})`,
              },
              true,
            ).catch(() => {});
          },
          err => {
            const errMsg = err instanceof Error ? err.message : String(err);
            void this.#cdp(
              "Runtime.evaluate",
              {
                expression: `window.__bunIpcResolve(${reqId},false,${JSON.stringify(errMsg)})`,
              },
              true,
            ).catch(() => {});
          },
        );
      return;
    }
    ipcMain.emit(channel, event, ...args);
  }

  async #handleCdpFetch(params: any) {
    const requestId = params.requestId;
    let url = String(params.request?.url ?? "");
    if (url.startsWith("http://bun-app.local/")) {
      url = "app://" + url.slice("http://bun-app.local/".length);
    }
    const method = String(params.request?.method ?? "GET");
    const rawHeaders = params.request?.headers ?? {};
    const headers = new Headers();
    for (const [k, v] of Object.entries(rawHeaders)) headers.set(k, String(v));
    const colon = url.indexOf(":");
    const scheme = colon > 0 ? url.slice(0, colon).toLowerCase() : "";
    if (!isProtocolSchemeAllowed(this.id, scheme)) {
      await this.#cdp("Fetch.fulfillRequest", { requestId, responseCode: 403, body: "" }, true).catch(() => {});
      return;
    }
    const handler = protocolHandlers.get(scheme) ?? (scheme === "app" ? defaultBundleHandler : undefined);
    if (!handler) {
      await this.#cdp("Fetch.fulfillRequest", { requestId, responseCode: 404, body: "" }, true).catch(() => {});
      return;
    }
    try {
      const req = new Request(url, { method, headers });
      const resp = await (handler === defaultBundleHandler ? defaultBundleHandler(req, this.id) : handler(req));
      const buf = new Uint8Array(await resp.arrayBuffer());
      const responseHeaders: { name: string; value: string }[] = [];
      resp.headers.forEach((value, name) => responseHeaders.push({ name, value }));
      await this.#cdp(
        "Fetch.fulfillRequest",
        {
          requestId,
          responseCode: resp.status || 200,
          responseHeaders,
          body: Buffer.from(buf).toString("base64"),
        },
        true,
      );
    } catch {
      await this.#cdp("Fetch.fulfillRequest", { requestId, responseCode: 500, body: "" }, true).catch(() => {});
    }
  }

  async loadURL(url: string) {
    await this.#ensureConnected();
    const waitLoad = new Promise<void>(resolve => {
      this.#loadWaiter = resolve;
    });
    const navUrl = url.startsWith("app://") ? "http://bun-app.local/" + url.slice(6) : url;
    await this.#cdp("Page.navigate", { url: navUrl }, true);
    await waitLoad;
  }

  async loadFile(filePath: string) {
    const path = require("node:path");
    await this.loadURL(`file://${path.resolve(filePath)}`);
  }

  show() {}
  hide() {}
  setTitle(title: string) {
    this.#title = title;
  }
  getTitle() {
    return this.#title;
  }
  setSize(w: number, h: number) {
    this.#width = w;
    this.#height = h;
  }
  getSize() {
    return [this.#width, this.#height];
  }
  maximize() {
    this.#maximized = true;
  }
  unmaximize() {
    this.#maximized = false;
  }
  isMaximized() {
    return this.#maximized;
  }
  minimize() {}
  isMinimized() {
    return false;
  }
  restore() {}
  focus() {}
  center() {}
  setProgressBar(_p: number) {}
  async evaluateJavaScript(code: string): Promise<unknown> {
    if (!this.#ws || !this.#sessionId || this.#closed) return undefined;
    const res = await this.#cdp("Runtime.evaluate", { expression: String(code), awaitPromise: true, returnByValue: true }, true);
    return res?.result?.value;
  }
  sendToRenderer(channel: string, argsJson: string) {
    if (!this.#ws || !this.#sessionId || this.#closed) return;
    void this.#cdp(
      "Runtime.evaluate",
      {
        expression: `window.__bunIpcDispatch(${JSON.stringify(channel)},${JSON.stringify(argsJson)})`,
      },
      true,
    ).catch(() => {});
  }
  close() {
    this.#closed = true;
    const err = new Error("Window closed");
    for (const [, p] of this.#pendingRpc) p.reject(err);
    this.#pendingRpc.clear();
    if (this.#loadWaiter) {
      const w = this.#loadWaiter;
      this.#loadWaiter = null;
      w();
    }
    try {
      this.#proc?.kill(9);
      (this.#proc as any)?.unref?.();
    } catch {}
    this.#proc = null;
    const ws = this.#ws;
    this.#ws = null;
    if (ws) {
      ws.onmessage = null;
      ws.onopen = null;
      ws.onerror = null;
      try {
        (ws as { terminate?(): void }).terminate?.();
        ws.close();
      } catch {}
    }
    try {
      this.#binServer?.stop(true);
    } catch {}
    this.#binServer = null;
    if (this.#userDataDir) {
      try {
        require("node:fs").rmSync(this.#userDataDir, { recursive: true, force: true });
      } catch {}
      this.#userDataDir = null;
    }
  }
}

function buildPreloadWrapper(userPreloadSrc: string, additionalArgs: unknown[]): string {
  const argvJson = JSON.stringify([
    "bun-desktop",
    ...(Array.isArray(additionalArgs) ? additionalArgs.map(a => String(a)) : []),
  ]);
  const platformJson = JSON.stringify(process.platform);
  const archJson = JSON.stringify(process.arch);
  const versionsJson = JSON.stringify({
    node: process.versions?.node ?? "22.0.0",
    bun: typeof Bun !== "undefined" ? Bun.version : "1.4.5",
    chrome: "130.0.0.0",
    electron: "35.0.0",
  });
  return `(() => {
  const _el = typeof window.require === "function" ? window.require("electron") : {
    ipcRenderer: window.bunDesktopIpc,
    contextBridge: { exposeInMainWorld(k, v) { window[String(k)] = v; } },
    webUtils: { getPathForFile(f) { return (f && f.path) || (f && f.name) || ""; } },
  };
  const _ports = new Map();
  if (_el && _el.ipcRenderer && !_el.ipcRenderer.__bunPortHooked) {
    _el.ipcRenderer.__bunPortHooked = true;
    _el.ipcRenderer.on("__bun_port_open__", (_ev, channel, message, portIds) => {
      const transferred = [];
      if (Array.isArray(portIds)) {
        for (const id of portIds) {
          const mc = new MessageChannel();
          mc.port1.onmessage = ev => _el.ipcRenderer.send("__bun_port_data__", id, ev.data);
          mc.port1.start();
          _ports.set(id, mc.port1);
          transferred.push(mc.port2);
        }
      }
      if (typeof window.__bunIpcDispatchWithPorts === "function") {
        window.__bunIpcDispatchWithPorts(channel, message, transferred);
      } else {
        window.__bunDispatchPortMsg?.(channel, message, transferred);
      }
    });
    _el.ipcRenderer.on("__bun_port_data__", (_ev, id, data) => {
      const p = _ports.get(id);
      if (p) p.postMessage(data);
    });
    _el.ipcRenderer.on("__bun_port_close__", (_ev, id) => {
      const p = _ports.get(id);
      if (p) { p.close(); _ports.delete(id); }
    });
    const _origOn = _el.ipcRenderer.on.bind(_el.ipcRenderer);
    const _portListeners = new Map();
    window.__bunDispatchPortMsg = (channel, message, ports) => {
      const set = _portListeners.get(channel);
      if (!set) return;
      for (const fn of set) fn({ senderId: 0, ports }, message);
    };
    _el.ipcRenderer.on = function(ch, fn) {
      let s = _portListeners.get(ch);
      if (!s) { s = new Set(); _portListeners.set(ch, s); }
      s.add(fn);
      return _origOn(ch, fn);
    };
  }
  const __bunPreIpc = _el.ipcRenderer;
  const __bunPreContextBridge = _el.contextBridge || { exposeInMainWorld(k, v) { window[String(k)] = v; } };
  const __bunPreWebUtils = _el.webUtils || { getPathForFile(f) { return (f && f.path) || (f && f.name) || ""; } };
  const __bunPreElectron = { ipcRenderer: __bunPreIpc, contextBridge: __bunPreContextBridge, webUtils: __bunPreWebUtils };
  const __bunPreProcess = {
    platform: ${platformJson},
    arch: ${archJson},
    versions: ${versionsJson},
    argv: ${argvJson},
    env: {},
  };
  const __bunPreRequire = id => {
    if (id === "electron") return __bunPreElectron;
    if (typeof window.require === "function") return window.require(id);
    throw new Error("Cannot find module '" + id + "'");
  };
  const __bunPreModule = { exports: {} };
  const __bunPreExports = __bunPreModule.exports;
  if (typeof window.fetch === "function" && !window.__bunFetchWebRequestHooked) {
    window.__bunFetchWebRequestHooked = true;
    let _hookActive = true;
    const _origFetch = window.fetch.bind(window);
    window.fetch = async function(input, init) {
      const urlStr = typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.href
            : String(input ?? "");
      if (_hookActive && (urlStr.startsWith("http://127.0.0.1") || urlStr.startsWith("http://localhost"))) {
        try {
          const baseHeaders = new Headers(input instanceof Request ? input.headers : undefined);
          if (init && init.headers) {
            new Headers(init.headers).forEach((v, k) => baseHeaders.set(k, v));
          }
          const hdrObj = {};
          baseHeaders.forEach((v, k) => { hdrObj[k] = v; });
          const method = (init && init.method) || (input instanceof Request ? input.method : "GET");
          const out = await _el.ipcRenderer.invoke("__bun_web_request_headers__", urlStr, method, hdrObj);
          if (out && out.none) {
            _hookActive = false;
          } else if (out && out.headers) {
            const nextHeaders = new Headers(baseHeaders);
            for (const [k, v] of Object.entries(out.headers)) {
              if (typeof v === "string") nextHeaders.set(k, v);
            }
            if (input instanceof Request) {
              input = new Request(input, init ? { ...init, headers: nextHeaders } : { headers: nextHeaders });
              return _origFetch(input);
            }
            init = { ...(init || {}), headers: nextHeaders };
          }
        } catch {}
      }
      return _origFetch(input, init);
    };
  }
  (function(require, module, exports, process) {
${userPreloadSrc}
  })(__bunPreRequire, __bunPreModule, __bunPreExports, __bunPreProcess);
})();`;
}

class BrowserWindow extends EventEmitter {
  static #windows = new Set<BrowserWindow>();
  static #windowsById = new Map<number, BrowserWindow>();
  static #focused: BrowserWindow | null = null;
  #native: InstanceType<typeof DesktopWindowNative> | CdpWindowAdapter;
  #visible: boolean;
  #x: number;
  #y: number;
  #documentEdited = false;
  #representedFilename = "";
  #fullScreen = false;
  #capabilities: WindowCapabilityState;
  #webPreferences: WebPreferences;
  readonly webContents: WebContents;

  constructor(
    options?: Record<string, unknown> & { capabilities?: WindowCapabilities; webPreferences?: WebPreferences },
  ) {
    super();
    const webPrefs = (options?.webPreferences as (WebPreferences & { additionalArguments?: unknown[] }) | undefined) ?? undefined;
    const rawCaps = (options?.capabilities as WindowCapabilities | undefined) ?? undefined;
    const capState = compileWindowCapabilities(rawCaps, webPrefs);
    const preloadPath =
      typeof webPrefs?.preload === "string"
        ? webPrefs.preload
        : typeof options?.preload === "string"
          ? options.preload
          : undefined;
    let preloadCode: string | undefined;
    if (preloadPath) {
      try {
        const rawPreload = require("node:fs").readFileSync(preloadPath, "utf8");
        preloadCode = buildPreloadWrapper(rawPreload, webPrefs?.additionalArguments ?? []);
      } catch {}
    }
    const normalizedOpts =
      options || preloadPath || preloadCode
        ? {
            ...(options ?? {}),
            ...(preloadPath ? { preload: preloadPath } : {}),
            ...(preloadCode ? { preloadCode } : {}),
          }
        : undefined;
    const backendSpec = resolveBackendSpec(options?.backend);
    if (backendSpec.type === "chrome" || backendSpec.type === "cef") {
      this.#native = new CdpWindowAdapter(
        backendSpec as { type: "chrome" | "cef"; path?: string; url?: string | false; args?: string[] },
        normalizedOpts ?? {},
      );
    } else {
      this.#native = new DesktopWindowNative(normalizedOpts);
    }
    this.#capabilities = capState;
    this.#webPreferences = {
      preload: preloadPath,
      sandbox: capState.sandbox,
      nodeIntegration: capState.nodeIntegration,
      contextIsolation: capState.contextIsolation,
    };
    windowCapabilities.set(this.#native.id, capState);
    this.#visible = options?.show !== false;
    this.#x = typeof options?.x === "number" ? options.x : 0;
    this.#y = typeof options?.y === "number" ? options.y : 0;
    this.webContents = new WebContents(this.#native);
    BrowserWindow.#windows.add(this);
    BrowserWindow.#windowsById.set(this.#native.id, this);
    if (this.#visible) {
      BrowserWindow.#focused = this;
    }
    app.emit("browser-window-created", {}, this);
  }

  static getAllWindows(): BrowserWindow[] {
    return Array.from(BrowserWindow.#windows);
  }

  static getFocusedWindow(): BrowserWindow | null {
    if (BrowserWindow.#focused && BrowserWindow.#windows.has(BrowserWindow.#focused)) {
      return BrowserWindow.#focused;
    }
    return null;
  }

  static fromId(id: number): BrowserWindow | null {
    return BrowserWindow.#windowsById.get(id) ?? null;
  }

  static fromWebContents(wc: WebContents | { id?: number } | null | undefined): BrowserWindow | null {
    if (!wc || typeof wc.id !== "number") return null;
    return BrowserWindow.#windowsById.get(wc.id) ?? null;
  }

  get id(): number {
    return this.#native.id;
  }

  get webPreferences(): Readonly<WebPreferences> {
    return this.#webPreferences;
  }

  get capabilities(): Readonly<WindowCapabilityState> {
    return this.#capabilities;
  }

  loadURL(url: string, _options?: unknown) {
    if (
      this.#capabilities.navigationAllow !== null &&
      !this.#capabilities.navigationAllow.some(p => matchesUrlPattern(url, p))
    ) {
      return Promise.reject(new Error(`Navigation to '${url}' denied by window capabilities`));
    }
    this.webContents._setURL(url);
    this.webContents._setLoading(true);
    return Promise.resolve(this.#native.loadURL(url)).then(res => {
      this.webContents._setLoading(false);
      this.webContents.emit("did-navigate", {}, url, 200, "");
      this.webContents.emit("did-finish-load");
      this.emit("ready-to-show");
      return res;
    });
  }

  loadFile(filePath: string, _options?: unknown) {
    const pathMod = require("node:path");
    const fileUrl = `file://${pathMod.resolve(filePath)}`;
    if (
      this.#capabilities.navigationAllow !== null &&
      !this.#capabilities.navigationAllow.some(p => matchesUrlPattern(fileUrl, p))
    ) {
      return Promise.reject(new Error(`Navigation to '${fileUrl}' denied by window capabilities`));
    }
    this.webContents._setURL(`file://${filePath}`);
    this.webContents._setLoading(true);
    return Promise.resolve(this.#native.loadFile(filePath)).then(res => {
      this.webContents._setLoading(false);
      this.webContents.emit("did-navigate", {}, fileUrl, 200, "");
      this.webContents.emit("did-finish-load");
      this.emit("ready-to-show");
      return res;
    });
  }

  show() {
    this.#visible = true;
    BrowserWindow.#focused = this;
    this.#native.show();
    this.emit("show");
  }

  hide() {
    this.#visible = false;
    if (BrowserWindow.#focused === this) BrowserWindow.#focused = null;
    this.#native.hide();
    this.emit("hide");
  }

  isVisible(): boolean {
    return this.#visible;
  }

  close() {
    this.emit("close", { preventDefault() {} });
    this.#visible = false;
    if (BrowserWindow.#focused === this) BrowserWindow.#focused = null;
    this.webContents._setDestroyed(true);
    this.#native.close();
    windowCapabilities.delete(this.#native.id);
    BrowserWindow.#windows.delete(this);
    BrowserWindow.#windowsById.delete(this.#native.id);
    this.emit("closed");
    if (BrowserWindow.#windows.size === 0) {
      app.emit("window-all-closed");
    }
  }

  destroy() {
    this.close();
  }

  setTitle(title: string) {
    this.#native.setTitle(title);
  }

  getTitle(): string {
    return this.#native.getTitle();
  }

  setSize(width: number, height: number) {
    this.#native.setSize(width, height);
    this.emit("resize");
  }

  getSize(): [number, number] {
    const [w, h] = this.#native.getSize();
    return [w ?? 800, h ?? 600];
  }

  setPosition(x: number, y: number) {
    this.#x = x;
    this.#y = y;
    this.emit("move");
  }

  getPosition(): [number, number] {
    return [this.#x, this.#y];
  }

  setBounds(bounds: { x?: number; y?: number; width?: number; height?: number }) {
    if (typeof bounds.x === "number" && typeof bounds.y === "number") {
      this.setPosition(bounds.x, bounds.y);
    }
    if (typeof bounds.width === "number" && typeof bounds.height === "number") {
      this.setSize(bounds.width, bounds.height);
    }
  }

  getBounds(): { x: number; y: number; width: number; height: number } {
    const [width, height] = this.getSize();
    return { x: this.#x, y: this.#y, width, height };
  }

  setMenu(menu: { items?: unknown[] } | null) {
    Menu.setApplicationMenu(menu);
  }
  maximize() {
    this.#native.maximize();
    this.emit("maximize");
  }
  minimize() {
    this.#native.minimize();
    this.emit("minimize");
  }
  isMinimized(): boolean {
    return typeof this.#native.isMinimized === "function" ? this.#native.isMinimized() : false;
  }
  restore() {
    if (typeof this.#native.restore === "function") this.#native.restore();
    this.emit("restore");
  }
  unmaximize() {
    this.#native.unmaximize();
    this.emit("unmaximize");
  }
  isMaximized(): boolean {
    return this.#native.isMaximized();
  }
  setDocumentEdited(edited: boolean) {
    this.#documentEdited = Boolean(edited);
  }
  isDocumentEdited(): boolean {
    return this.#documentEdited;
  }
  setRepresentedFilename(filename: string) {
    this.#representedFilename = String(filename ?? "");
  }
  getRepresentedFilename(): string {
    return this.#representedFilename;
  }
  setMinimumSize(_w: number, _h: number) {}
  setAutoHideMenuBar(_v: boolean) {}
  setMenuBarVisibility(_v: boolean) {}
  isFullScreen(): boolean {
    return this.#fullScreen;
  }
  setFullScreen(flag: boolean) {
    this.#fullScreen = Boolean(flag);
    this.emit(this.#fullScreen ? "enter-full-screen" : "leave-full-screen");
  }
  focus() {
    this.#visible = true;
    BrowserWindow.#focused = this;
    this.#native.focus();
    this.emit("focus");
  }
  isFocused(): boolean {
    return BrowserWindow.#focused === this;
  }
  center() {
    this.#native.center();
  }
  setProgressBar(progress: number) {
    this.#native.setProgressBar(Number(progress));
  }
  isDestroyed(): boolean {
    return !BrowserWindow.#windows.has(this);
  }
}

class App extends EventEmitter {
  #customPaths = new Map<string, string>();

  isReady(): boolean {
    return nativeApp.isReady();
  }

  whenReady(): Promise<void> {
    if (this.isReady()) return Promise.resolve();
    return new Promise(resolve => this.once("ready", resolve));
  }

  quit() {
    this.emit("before-quit");
    for (const win of BrowserWindow.getAllWindows()) {
      win.close();
    }
    nativeApp.quit();
    this.emit("will-quit");
  }

  exit(exitCode = 0) {
    nativeApp.exit(exitCode);
  }

  getName(): string {
    return nativeApp.getName();
  }

  setName(name: string) {
    nativeApp.setName(name);
  }

  get name(): string {
    return this.getName();
  }

  set name(v: string) {
    this.setName(String(v));
  }

  getVersion(): string {
    return nativeApp.getVersion();
  }

  getPath(name: string): string {
    const key = String(name);
    const custom = this.#customPaths.get(key);
    if (custom !== undefined) return custom;
    if (key === "sessionData") {
      return require("node:path").join(this.getPath("userData"), "SessionData");
    }
    return nativeApp.getPath(key);
  }

  setPath(name: string, pathVal: string) {
    this.#customPaths.set(String(name), String(pathVal));
  }

  getAppPath(): string {
    return process.cwd();
  }

  get isPackaged(): boolean {
    return typeof Bun !== "undefined" && Array.isArray(Bun.embeddedFiles) && Bun.embeddedFiles.length > 0;
  }

  requestSingleInstanceLock(): boolean {
    return true;
  }

  releaseSingleInstanceLock() {}

  setAboutPanelOptions(_opts: unknown) {}
  setAsDefaultProtocolClient(_scheme: string): boolean {
    return true;
  }
  setAppUserModelId(_id: string) {}

  readonly commandLine = {
    appendSwitch(_sw: string, _value?: string) {},
    hasSwitch(_sw: string): boolean {
      return false;
    },
    getSwitchValue(_sw: string): string {
      return "";
    },
  };

  readonly dock = {
    setBadge(_text: string) {},
    hide() {},
    show() {},
  };
}

const app = new App();

class IpcMain extends EventEmitter {
  #handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  #binaryHandlers = new Map<string, (event: unknown, data: Uint8Array) => unknown>();

  _getHandler(channel: string) {
    return this.#handlers.get(channel);
  }

  _getBinaryHandler(channel: string) {
    return this.#binaryHandlers.get(channel);
  }

  handleBinary(channel: string, listener: (event: unknown, data: Uint8Array) => unknown) {
    this.#binaryHandlers.set(channel, listener);
  }

  removeBinaryHandler(channel: string) {
    this.#binaryHandlers.delete(channel);
  }

  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) {
    this.#handlers.set(channel, listener);
    nativeIpcMain.handle(channel, listener);
  }

  handleOnce(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) {
    const wrapped = async (event: unknown, ...args: unknown[]) => {
      this.removeHandler(channel);
      return listener(event, ...args);
    };
    this.handle(channel, wrapped);
  }

  removeHandler(channel: string) {
    this.#handlers.delete(channel);
    nativeIpcMain.removeHandler(channel);
  }

  override on(channel: string | symbol, listener: (...args: any[]) => void) {
    if (typeof channel === "string") {
      nativeIpcMain.on(channel, listener);
    }
    return super.on(channel, listener);
  }

  override removeAllListeners(channel?: string | symbol) {
    nativeIpcMain.removeAllListeners(typeof channel === "string" ? channel : null);
    return super.removeAllListeners(channel);
  }

  _dispatchFromRenderer(windowId: number, reqId: number, isInvoke: boolean, channel: string, argsJson: string) {
    let args: unknown[];
    if (!argsJson || argsJson === "[]") {
      args = [];
    } else {
      try {
        const parsed = JSON.parse(argsJson);
        args = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        args = [];
      }
    }
    const win = BrowserWindow.fromId(windowId);
    const isInternalTransport =
      channel === "__bun_port_data__" ||
      channel === "__bun_port_close__" ||
      (isInvoke && channel === "__bun_web_request_headers__");
    if (!isInternalTransport && !isIpcAllowed(windowId, channel, win?.webContents.getURL())) {
      if (isInvoke) {
        nativeIpcMain.sendIpcReply(windowId, reqId, false, `IPC channel '${channel}' denied by window capabilities`);
      }
      return;
    }
    const event = {
      senderId: windowId,
      sender: win?.webContents,
      senderFrame: { url: win?.webContents.getURL() ?? "about:blank" },
    };

    if (channel === "__bun_port_data__") {
      const portId = Number(args[0] ?? 0);
      const port = activeTransferredPorts.get(portId);
      const target = port?._peer;
      if (target && !target._closed) {
        target.emit("message", { data: args[1] });
      }
      return;
    }
    if (channel === "__bun_port_close__") {
      const portId = Number(args[0] ?? 0);
      const port = activeTransferredPorts.get(portId);
      if (port) {
        activeTransferredPorts.delete(portId);
        port.close();
      }
      return;
    }
    if (isInvoke && channel === "__bun_web_request_headers__") {
      if (beforeSendHeadersListeners.length === 0) {
        nativeIpcMain.sendIpcReply(windowId, reqId, true, JSON.stringify({ none: true }));
        return;
      }
      const reqUrl = String(args[0] ?? "");
      const reqMethod = String(args[1] ?? "GET");
      const reqHdrs = (args[2] && typeof args[2] === "object" ? args[2] : {}) as Record<string, string>;
      void runBeforeSendHeaders(win?.webContents.getURL() ?? "about:blank", reqUrl, reqMethod, reqHdrs).then(
        headers => nativeIpcMain.sendIpcReply(windowId, reqId, true, JSON.stringify({ headers })),
        err => nativeIpcMain.sendIpcReply(windowId, reqId, false, err instanceof Error ? err.message : String(err)),
      );
      return;
    }
    if (isInvoke && channel.startsWith("__bun_bin__:")) {
      const realCh = channel.slice("__bun_bin__:".length);
      const rawBytes = args[0] ? new Uint8Array(Buffer.from(String(args[0]), "base64")) : new Uint8Array(0);
      const binHandler = this.#binaryHandlers.get(realCh);
      if (!binHandler) {
        nativeIpcMain.sendIpcReply(windowId, reqId, false, `No binary handler registered for '${realCh}'`);
        return;
      }
      Promise.resolve()
        .then(() => binHandler(event, rawBytes))
        .then(
          val => {
            const outBytes =
              val instanceof Uint8Array
                ? val
                : val instanceof ArrayBuffer
                  ? new Uint8Array(val)
                  : ArrayBuffer.isView(val)
                    ? new Uint8Array(val.buffer, val.byteOffset, val.byteLength)
                    : typeof val === "string"
                      ? new TextEncoder().encode(val)
                      : new Uint8Array(0);
            nativeIpcMain.sendIpcReply(windowId, reqId, true, JSON.stringify(Buffer.from(outBytes).toString("base64")));
          },
          err => nativeIpcMain.sendIpcReply(windowId, reqId, false, err instanceof Error ? err.message : String(err)),
        );
      return;
    }
    if (isInvoke) {
      const handler = this.#handlers.get(channel);
      if (!handler) {
        nativeIpcMain.sendIpcReply(windowId, reqId, false, `No handler registered for '${channel}'`);
        return;
      }
      try {
        const res = handler(event, ...args);
        if (res && typeof (res as PromiseLike<unknown>).then === "function") {
          (res as Promise<unknown>).then(
            val => {
              const json = val === undefined ? "null" : JSON.stringify(val);
              nativeIpcMain.sendIpcReply(windowId, reqId, true, json ?? "null");
            },
            err => {
              const msg = err instanceof Error ? err.message : String(err);
              nativeIpcMain.sendIpcReply(windowId, reqId, false, msg);
            },
          );
        } else {
          const json = res === undefined ? "null" : JSON.stringify(res);
          nativeIpcMain.sendIpcReply(windowId, reqId, true, json ?? "null");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        nativeIpcMain.sendIpcReply(windowId, reqId, false, msg);
      }
      return;
    }

    this.emit(channel, event, ...args);
  }

  _dispatchBinaryFromRenderer(windowId: number, reqId: number, channel: string, data: Uint8Array) {
    const win = BrowserWindow.fromId(windowId);
    if (!isIpcAllowed(windowId, channel, win?.webContents.getURL())) {
      nativeIpcMain.sendIpcBinaryReply(
        windowId,
        reqId,
        403,
        `Binary IPC channel '${channel}' denied by window capabilities`,
      );
      return;
    }
    const event = {
      senderId: windowId,
      sender: win?.webContents,
      senderFrame: { url: win?.webContents.getURL() ?? "about:blank" },
    };
    const handler = this.#binaryHandlers.get(channel);
    if (!handler) {
      nativeIpcMain.sendIpcBinaryReply(windowId, reqId, 404, `No binary handler registered for '${channel}'`);
      return;
    }
    const sendResult = (val: unknown) => {
      if (val === undefined || val === null) {
        nativeIpcMain.sendIpcBinaryReply(windowId, reqId, 200, new Uint8Array(0));
      } else if (ArrayBuffer.isView(val)) {
        nativeIpcMain.sendIpcBinaryReply(
          windowId,
          reqId,
          200,
          new Uint8Array(val.buffer, val.byteOffset, val.byteLength),
        );
      } else if (val instanceof ArrayBuffer) {
        nativeIpcMain.sendIpcBinaryReply(windowId, reqId, 200, new Uint8Array(val));
      } else if (typeof val === "string") {
        nativeIpcMain.sendIpcBinaryReply(windowId, reqId, 200, val);
      } else {
        nativeIpcMain.sendIpcBinaryReply(
          windowId,
          reqId,
          500,
          `Binary IPC handler for '${channel}' must return Uint8Array, ArrayBuffer, or ArrayBufferView`,
        );
      }
    };
    try {
      const res = handler(event, data);
      if (res && typeof (res as PromiseLike<unknown>).then === "function") {
        (res as Promise<unknown>).then(
          val => sendResult(val),
          err => {
            const msg = err instanceof Error ? err.message : String(err);
            nativeIpcMain.sendIpcBinaryReply(windowId, reqId, 500, msg);
          },
        );
      } else {
        sendResult(res);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      nativeIpcMain.sendIpcBinaryReply(windowId, reqId, 500, msg);
    }
  }
}

const ipcMain = new IpcMain();
nativeIpcMain.setDispatcher((windowId: number, reqId: number, isInvoke: boolean, channel: string, argsJson: string) => {
  ipcMain._dispatchFromRenderer(windowId, reqId, isInvoke, channel, argsJson);
});
nativeIpcMain.setBinaryDispatcher((windowId: number, reqId: number, channel: string, data: Uint8Array) => {
  ipcMain._dispatchBinaryFromRenderer(windowId, reqId, channel, data);
});

const protocolHandlers = new Map<string, (request: Request) => Response | Promise<Response>>();

const protocol = {
  registerSchemesAsPrivileged(customSchemes: Array<{ scheme?: string } | string>) {
    if (!Array.isArray(customSchemes)) return;
    for (const entry of customSchemes) {
      const s = typeof entry === "string" ? entry : entry?.scheme;
      if (typeof s === "string" && s) {
        nativeProtocol.registerScheme(s.toLowerCase());
      }
    }
  },
  handle(scheme: string, handler: (request: Request) => Response | Promise<Response>) {
    protocolHandlers.set(scheme.toLowerCase(), handler);
    nativeProtocol.handle(scheme, handler);
  },
  unhandle(scheme: string) {
    protocolHandlers.delete(scheme.toLowerCase());
    nativeProtocol.unhandle(scheme);
  },
  isProtocolHandled(scheme: string): boolean {
    return nativeProtocol.isHandled(scheme);
  },
};

const bundleAssets = new Map<string, { data: Uint8Array; contentType: string }>();

async function defaultBundleHandler(req: Request, windowId?: number): Promise<Response> {
  const url = new URL(req.url);
  if (url.hostname !== "bundle") {
    return new Response("Not Found", { status: 404 });
  }
  const pathMod = require("node:path");
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  const rel = decodedPath.replace(/^\/+/, "") || "index.html";
  const cwd = process.cwd();
  const fsPath = pathMod.resolve(cwd, rel);
  if (!isPathInside(cwd, fsPath)) {
    return new Response("Forbidden", { status: 403 });
  }
  if (windowId !== undefined) {
    const cap = windowCapabilities.get(windowId);
    if (cap?.protocolRoots !== null && cap?.protocolRoots !== undefined) {
      if (!cap.protocolRoots.some(root => isPathInside(root, fsPath))) {
        return new Response("Forbidden", { status: 403 });
      }
    }
  }
  const cached = bundleAssets.get(rel);
  if (cached) {
    return new Response(cached.data, { headers: { "content-type": cached.contentType } });
  }
  if (Array.isArray(Bun.embeddedFiles)) {
    const dot = rel.lastIndexOf(".");
    const stem = dot >= 0 ? rel.slice(0, dot) : rel;
    const ext = dot >= 0 ? rel.slice(dot) : "";
    for (const embedded of Bun.embeddedFiles) {
      const name = String((embedded as File).name || "").replace(/^\.?\//, "");
      if (
        name === rel ||
        name.endsWith("/" + rel) ||
        (stem && ext && name.startsWith(stem + "-") && name.endsWith(ext))
      ) {
        return new Response(embedded);
      }
    }
  }
  const vfsPrefix = process.platform === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/";
  const vfsFile = Bun.file(vfsPrefix + rel);
  if (await vfsFile.exists()) {
    return new Response(vfsFile);
  }
  if (!IS_COMPILED_AHEAD_OF_TIME && /\.(html|tsx|ts|jsx)$/i.test(fsPath)) {
    const built = await Bun.build({
      entrypoints: [fsPath],
      target: "browser",
      minify: false,
    });
    if (built.success && built.outputs.length > 0) {
      let entryResp: Response | undefined;
      for (const out of built.outputs) {
        const bytes = new Uint8Array(await out.arrayBuffer());
        const outPath = String(out.path || "").replace(/^\.\//, "");
        const ct =
          out.type ||
          (outPath.endsWith(".html")
            ? "text/html; charset=utf-8"
            : outPath.endsWith(".css")
              ? "text/css; charset=utf-8"
              : "application/javascript; charset=utf-8");
        if (outPath) {
          bundleAssets.set(outPath, { data: bytes, contentType: ct });
        }
        if (outPath === rel || (rel.endsWith(".html") && outPath.endsWith(".html"))) {
          entryResp = new Response(bytes, { headers: { "content-type": ct } });
        }
      }
      if (entryResp) return entryResp;
      const first = built.outputs[0];
      return new Response(new Uint8Array(await first.arrayBuffer()), {
        headers: { "content-type": first.type || "application/javascript; charset=utf-8" },
      });
    }
    return new Response(built.logs.map(l => l.message).join("\n") || "Build failed", {
      status: 500,
    });
  }
  const file = Bun.file(fsPath);
  if (!(await file.exists())) {
    return new Response("Not Found", { status: 404 });
  }
  return new Response(file);
}

nativeProtocol.setDispatcher(
  (
    windowId: number,
    taskId: number,
    url: string,
    method: string,
    rangeHeader: string,
    rawHeadersJson?: string,
    rawBody?: Uint8Array,
  ) => {
    const colon = url.indexOf(":");
    const scheme = colon > 0 ? url.slice(0, colon).toLowerCase() : "";
    if (!isProtocolSchemeAllowed(windowId, scheme)) {
      nativeProtocol.sendResponseError(windowId, taskId, 403);
      return;
    }
    const handler = protocolHandlers.get(scheme) ?? (scheme === "app" ? defaultBundleHandler : undefined);
    if (!handler) {
      nativeProtocol.sendResponseError(windowId, taskId, 404);
      return;
    }

    const reqHeaders = new Headers();
    if (rawHeadersJson && rawHeadersJson !== "{}") {
      try {
        const parsed = JSON.parse(rawHeadersJson) as Record<string, string>;
        if (parsed && typeof parsed === "object") {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string") reqHeaders.set(k, v);
          }
        }
      } catch {}
    }
    if (rangeHeader && !reqHeaders.has("range")) reqHeaders.set("range", rangeHeader);
    const reqMethod = (method || "GET").toUpperCase();
    const canHaveBody = reqMethod !== "GET" && reqMethod !== "HEAD" && rawBody && rawBody.byteLength > 0;
    const req = new Request(url, {
      method: reqMethod,
      headers: reqHeaders,
      ...(canHaveBody ? { body: rawBody as BodyInit } : {}),
    });

  Promise.resolve()
    .then(() => (handler === defaultBundleHandler ? defaultBundleHandler(req, windowId) : handler(req)))
    .then(async resp => {
      if (!(resp instanceof Response)) {
        nativeProtocol.sendResponseError(windowId, taskId, 500);
        return;
      }
      const headersObj: Record<string, string> = {};
      resp.headers.forEach((v, k) => {
        headersObj[k] = v;
      });
      const headersJson = JSON.stringify(headersObj);
      if (nativeProtocol.sendResponse(windowId, taskId, resp, rangeHeader, headersJson)) {
        return;
      }
      const buf = new Uint8Array(await resp.arrayBuffer());
      nativeProtocol.sendResponseBytes(windowId, taskId, resp.status || 200, headersJson, buf);
    })
    .catch(() => {
      nativeProtocol.sendResponseError(windowId, taskId, 500);
    });
});

let currentAppMenu: { items: unknown[]; popup(): void } | null = null;

function wrapMenuSubmenus(items: unknown[]): unknown[] {
  for (const item of items) {
    if (item && typeof item === "object" && Array.isArray((item as { submenu?: unknown }).submenu)) {
      const sub = (item as { submenu: unknown[] & Record<string, unknown> }).submenu;
      wrapMenuSubmenus(sub);
      if (!sub.items) sub.items = sub;
      if (typeof sub.on !== "function") {
        const ee = new EventEmitter();
        sub.on = ee.on.bind(ee);
        sub.once = ee.once.bind(ee);
        sub.off = ee.off.bind(ee);
        sub.removeListener = ee.removeListener.bind(ee);
        sub.emit = ee.emit.bind(ee);
      }
    }
  }
  return items;
}

function findMenuItemById(items: unknown[], id: string): unknown {
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const obj = item as { id?: string; submenu?: unknown };
    if (obj.id === id) return obj;
    const sub = Array.isArray(obj.submenu)
      ? obj.submenu
      : Array.isArray((obj.submenu as { items?: unknown[] } | undefined)?.items)
        ? (obj.submenu as { items: unknown[] }).items
        : null;
    if (sub) {
      const found = findMenuItemById(sub, id);
      if (found) return found;
    }
  }
  return null;
}

const Menu = {
  buildFromTemplate(template: unknown[]) {
    const items = Array.isArray(template) ? wrapMenuSubmenus(template) : [];
    const ee = new EventEmitter();
    return {
      items,
      popup() {},
      on: ee.on.bind(ee),
      once: ee.once.bind(ee),
      off: ee.off.bind(ee),
      emit: ee.emit.bind(ee),
      getMenuItemById(id: string) {
        return findMenuItemById(items, String(id));
      },
    };
  },
  setApplicationMenu(menu: { items?: unknown[]; popup(): void } | null) {
    currentAppMenu = menu ? { items: menu.items ?? [], popup: menu.popup ?? (() => {}) } : null;
    nativeApp.setMenu(currentAppMenu ? JSON.stringify(currentAppMenu.items) : "null");
  },
  getApplicationMenu() {
    return currentAppMenu;
  },
};

async function runNativeDialog(kind: number, winOrOpts?: unknown, maybeOpts?: unknown) {
  const hasWin = winOrOpts instanceof BrowserWindow;
  const winId = hasWin ? winOrOpts.id : 0;
  const opts = (hasWin ? maybeOpts : winOrOpts) ?? {};
  const raw = await nativeApp.showDialog(winId, kind, JSON.stringify(opts));
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

const dialog = {
  async showOpenDialog(winOrOpts?: unknown, maybeOpts?: unknown) {
    return runNativeDialog(0, winOrOpts, maybeOpts);
  },
  async showSaveDialog(winOrOpts?: unknown, maybeOpts?: unknown) {
    return runNativeDialog(1, winOrOpts, maybeOpts);
  },
  async showMessageBox(winOrOpts?: unknown, maybeOpts?: unknown) {
    return runNativeDialog(2, winOrOpts, maybeOpts);
  },
  showErrorBox(title: string, content: string) {
    console.error(`[${title}] ${content}`);
    void nativeApp.showDialog(0, 3, JSON.stringify({ title, content }));
  },
};

const shell = {
  async openExternal(url: string) {
    const focused = BrowserWindow.getFocusedWindow();
    const focusedCap = focused ? windowCapabilities.get(focused.id) : undefined;
    if (focusedCap?.shellOpenExternal !== null && focusedCap?.shellOpenExternal !== undefined) {
      const urlStr = String(url);
      if (!focusedCap.shellOpenExternal.some(p => matchesUrlPattern(urlStr, p))) {
        throw new Error(`shell.openExternal('${urlStr}') denied by window capabilities`);
      }
    }
    if (!nativeApp.openExternal(String(url)) && process.platform === "darwin") {
      Bun.spawn(["open", url], { stdout: "ignore", stderr: "ignore" });
    }
  },
  showItemInFolder(fullPath: string) {
    if (!nativeApp.showItemInFolder(String(fullPath)) && process.platform === "darwin") {
      Bun.spawn(["open", "-R", fullPath], { stdout: "ignore", stderr: "ignore" });
    }
  },
  async openPath(fullPath: string): Promise<string> {
    const target = String(fullPath);
    if (process.platform === "darwin") {
      const proc = Bun.spawn(["open", target], { stdout: "ignore", stderr: "pipe" });
      const code = await proc.exited;
      return code === 0 ? "" : `Failed to open '${target}' (exit ${code})`;
    }
    if (process.platform === "linux") {
      const proc = Bun.spawn(["xdg-open", target], { stdout: "ignore", stderr: "pipe" });
      const code = await proc.exited;
      return code === 0 ? "" : `Failed to open '${target}' (exit ${code})`;
    }
    return nativeApp.openExternal(target) ? "" : `Failed to open '${target}'`;
  },
  async trashItem(fullPath: string) {
    if (!nativeApp.trashItem(String(fullPath))) {
      throw new Error(`Failed to move item to trash: ${fullPath}`);
    }
  },
  beep() {
    process.stdout.write("\x07");
  },
};

const nativeTheme = new (class extends EventEmitter {
  #themeSource: "system" | "light" | "dark" = "system";
  shouldUseHighContrastColors = false;
  shouldUseInvertedColorScheme = false;
  get themeSource(): "system" | "light" | "dark" {
    return this.#themeSource;
  }
  set themeSource(value: "system" | "light" | "dark") {
    if (value === "system" || value === "light" || value === "dark") {
      const prev = this.#themeSource;
      this.#themeSource = value;
      if (prev !== value) {
        this.emit("updated");
      }
    }
  }
  get shouldUseDarkColors(): boolean {
    if (this.#themeSource === "dark") return true;
    if (this.#themeSource === "light") return false;
    return nativeApp.isDarkMode();
  }
})();

const screen = new (class extends EventEmitter {
  getPrimaryDisplay() {
    const [x = 0, y = 0, width = 1440, height = 900, wx = 0, wy = 0, ww = 1440, wh = 875, scaleFactor = 1] =
      nativeApp.getPrimaryDisplay();
    return {
      id: 1,
      bounds: { x, y, width, height },
      workArea: { x: wx, y: wy, width: ww, height: wh },
      scaleFactor,
    };
  }
  getAllDisplays() {
    return [this.getPrimaryDisplay()];
  }
  getDisplayNearestPoint(_point: { x: number; y: number }) {
    return this.getPrimaryDisplay();
  }
  getDisplayMatching(_rect: { x?: number; y?: number; width?: number; height?: number }) {
    return this.getPrimaryDisplay();
  }
})();

const clipboard = {
  writeText(text: string): boolean {
    return nativeApp.clipboardWriteText(String(text));
  },
  readText(): string {
    return nativeApp.clipboardReadText();
  },
  clear() {
    nativeApp.clipboardWriteText("");
  },
  has(_format?: string): boolean {
    return nativeApp.clipboardReadText().length > 0;
  },
};

function pngSizeFromBytes(bytes: Uint8Array): { width: number; height: number } {
  // PNG signature + IHDR chunk starts at byte 16 (width: u32 BE, height: u32 BE)
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
  }
  return { width: 0, height: 0 };
}

const nativeImage = {
  createFromPath(imgPath: string) {
    const [width = 0, height = 0] = nativeApp.imageSizeFromPath(String(imgPath));
    return {
      isEmpty: () => width <= 0 || height <= 0,
      getSize: () => ({ width, height }),
    };
  },
  createFromBuffer(buffer: Uint8Array) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const { width, height } = pngSizeFromBytes(bytes);
    return {
      isEmpty: () => bytes.byteLength === 0,
      getSize: () => ({ width, height }),
    };
  },
  createFromDataURL(dataURL: string) {
    const comma = String(dataURL).indexOf(",");
    if (comma < 0) return nativeImage.createEmpty();
    const meta = String(dataURL).slice(0, comma);
    const body = String(dataURL).slice(comma + 1);
    const bytes = meta.includes(";base64") ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body));
    return nativeImage.createFromBuffer(bytes);
  },
  createEmpty() {
    return {
      isEmpty: () => true,
      getSize: () => ({ width: 0, height: 0 }),
    };
  },
};

class Notification extends EventEmitter {
  #title: string;
  #body: string;
  constructor(opts?: { title?: string; body?: string }) {
    super();
    this.#title = String(opts?.title ?? "");
    this.#body = String(opts?.body ?? "");
  }
  show() {
    if (nativeApp.showNotification(this.#title, this.#body)) {
      this.emit("show");
      return;
    }
    if (process.platform === "darwin") {
      const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      Bun.spawn(["osascript", "-e", `display notification "${esc(this.#body)}" with title "${esc(this.#title)}"`], {
        stdout: "ignore",
        stderr: "ignore",
      });
      this.emit("show");
    }
  }
}

const powerSaveBlocker = {
  start(type: string): number {
    const kind = type === "prevent-display-sleep" ? 1 : 0;
    return nativeApp.powerSaveStart(kind);
  },
  stop(id: number): boolean {
    return nativeApp.powerSaveStop(Number(id));
  },
  isStarted(id: number): boolean {
    return nativeApp.powerSaveIsStarted(Number(id));
  },
};

const beforeSendHeadersListeners: Array<{
  urls: string[] | null;
  fn: (
    details: { url: string; method: string; requestHeaders: Record<string, string>; frame: { parent: null; url: string } },
    callback: (res: { cancel?: boolean; requestHeaders?: Record<string, string> }) => void,
  ) => void;
}> = [];

function matchesWebRequestPattern(urlStr: string, pattern: string): boolean {
  if (pattern === "<all_urls>" || pattern === "*") return true;
  const schemeEnd = pattern.indexOf("://");
  if (schemeEnd === -1) return matchesUrlPattern(urlStr, pattern);
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return matchesUrlPattern(urlStr, pattern);
  }
  const patScheme = pattern.slice(0, schemeEnd).toLowerCase();
  const actualScheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (patScheme === "*") {
    if (actualScheme !== "http" && actualScheme !== "https" && actualScheme !== "ws" && actualScheme !== "wss") {
      return false;
    }
  } else if (patScheme !== actualScheme) {
    return false;
  }
  const rest = pattern.slice(schemeEnd + 3);
  const slashIdx = rest.indexOf("/");
  const patHostPort = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
  const patPath = slashIdx === -1 ? "/*" : rest.slice(slashIdx);
  if (patHostPort !== "*") {
    const colonIdx = patHostPort.lastIndexOf(":");
    const patHost = colonIdx !== -1 ? patHostPort.slice(0, colonIdx) : patHostPort;
    const patPort = colonIdx !== -1 ? patHostPort.slice(colonIdx + 1) : "";
    if (patPort && patPort !== "*" && patPort !== parsed.port) return false;
    if (!matchesUrlPattern(parsed.hostname.toLowerCase(), patHost.toLowerCase())) return false;
  }
  return matchesUrlPattern(parsed.pathname + parsed.search, patPath);
}

async function runBeforeSendHeaders(
  winUrl: string,
  url: string,
  method: string,
  requestHeaders: Record<string, string>,
): Promise<Record<string, string>> {
  let headers = { ...requestHeaders };
  for (const entry of beforeSendHeadersListeners) {
    if (entry.urls && !entry.urls.some(pat => matchesWebRequestPattern(url, pat))) continue;
    await new Promise<void>(resolve => {
      try {
        entry.fn(
          { url, method, requestHeaders: headers, frame: { parent: null, url: winUrl } },
          res => {
            if (res?.requestHeaders) headers = res.requestHeaders;
            resolve();
          },
        );
      } catch {
        resolve();
      }
    });
  }
  return headers;
}

const session = {
  defaultSession: {
    protocol,
    webRequest: {
      onHeadersReceived() {},
      onBeforeSendHeaders(filterOrFn: unknown, maybeFn?: unknown) {
        const hasFilter = typeof maybeFn === "function";
        const fn = hasFilter ? maybeFn : filterOrFn;
        if (typeof fn !== "function") return;
        const urls =
          hasFilter && filterOrFn && typeof filterOrFn === "object" && Array.isArray((filterOrFn as { urls?: unknown[] }).urls)
            ? (filterOrFn as { urls: string[] }).urls
            : null;
        beforeSendHeadersListeners.push({
          urls,
          fn: fn as (typeof beforeSendHeadersListeners)[number]["fn"],
        });
      },
    },
    setPermissionRequestHandler(_handler: unknown) {},
    setPermissionCheckHandler(_handler: unknown) {},
    setSpellCheckerEnabled(_enabled: boolean) {},
    setSpellCheckerLanguages(_langs: string[]) {},
    getSpellCheckerLanguages(): string[] {
      return [];
    },
    availableSpellCheckerLanguages: [] as string[],
  },
};

const systemPreferences = {
  getMediaAccessStatus(_mediaType: string): string {
    return "granted";
  },
  async askForMediaAccess(_mediaType: string): Promise<boolean> {
    return true;
  },
};

const contextBridge = {
  exposeInMainWorld(key: string, api: unknown) {
    const g = globalThis as Record<string, unknown>;
    g[key] = api;
    if (typeof (g as { window?: Record<string, unknown> }).window === "object" && g.window) {
      (g.window as Record<string, unknown>)[key] = api;
    }
  },
};

const net = {
  fetch: globalThis.fetch.bind(globalThis),
  isOnline: () => true,
};

const crashReporter = {
  start(_opts?: unknown) {},
  getLastCrashReport: () => null,
  getUploadedReports: () => [],
};

const netLog = {
  currentlyLogging: false,
  async startLogging(_path: string, _opts?: unknown) {},
  async stopLogging() {
    return "";
  },
};

const contentTracing = {
  async startRecording(_opts?: unknown) {},
  async stopRecording(path?: string) {
    return path ?? "";
  },
};

const autoUpdater = new (class extends EventEmitter {
  setFeedURL(_opts?: unknown) {}
  checkForUpdates() {}
  quitAndInstall() {}
})();

class ImageView {
  setImage(_img?: unknown) {}
}

const webContents = {
  getAllWebContents: WebContents.getAllWebContents,
  fromId: WebContents.fromId,
};

export default {
  app,
  BrowserWindow,
  ipcMain,
  MessageChannelMain,
  protocol,
  Menu,
  dialog,
  shell,
  nativeTheme,
  screen,
  clipboard,
  nativeImage,
  Notification,
  powerSaveBlocker,
  session,
  systemPreferences,
  net,
  crashReporter,
  netLog,
  contentTracing,
  autoUpdater,
  ImageView,
  webContents,
  contextBridge,
};
