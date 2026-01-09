// Hardcoded module "node:inspector" and "node:inspector/promises"

const { hideFromStack, throwNotImplemented } = require("internal/shared");
const EventEmitter = require("node:events");

type NativeInspectorBinding = {
  open: (url: string, wait: boolean) => void;
  close: () => void;
  url: () => string | undefined;
  waitForDebugger: () => void;

  // Session bindings
  createSession: (unrefEventLoop: boolean, onMessage: (...messages: string[]) => void) => unknown;
  sessionSend: (message: string | string[]) => void;
  sessionDisconnect: () => void;
};

let cachedBinding: NativeInspectorBinding | undefined;

function getBinding(): NativeInspectorBinding {
  if (cachedBinding) return cachedBinding;

  const binding = (globalThis as any).__bunInspector as NativeInspectorBinding | undefined;
  if (
    !binding ||
    typeof binding.open !== "function" ||
    typeof binding.close !== "function" ||
    typeof binding.url !== "function" ||
    typeof binding.waitForDebugger !== "function" ||
    typeof binding.createSession !== "function" ||
    typeof binding.sessionSend !== "function" ||
    typeof binding.sessionDisconnect !== "function"
  ) {
    throwNotImplemented("node:inspector", 2445, "Missing Bun internal binding (__bunInspector)");
  }

  cachedBinding = binding;
  return binding;
}

function callNative(fn: Function, thisArg: any, ...args: any[]) {
  return fn.$call(thisArg, ...args);
}

const DEFAULT_PORT = 9229;
const DEFAULT_HOST = "127.0.0.1";

function isIPv6Literal(host: string): boolean {
  return host.includes(":") && !(host.startsWith("[") && host.endsWith("]"));
}

function formatHostForURL(host: string): string {
  return isIPv6Literal(host) ? `[${host}]` : host;
}

function randomPathname(): string {
  try {
    const crypto = require("node:crypto");
    if (typeof crypto.randomUUID === "function") {
      return "/" + crypto.randomUUID().replaceAll("-", "");
    }
    if (typeof crypto.randomBytes === "function") {
      return "/" + crypto.randomBytes(16).toString("hex");
    }
  } catch {
    // ignore
  }
  return "/" + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}

function parsePort(value: any): number {
  if (value === undefined || value === null) return DEFAULT_PORT;

  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) throw new TypeError("port must be an integer");
    if (value < 0 || value > 65535) throw new RangeError("port must be in the range 0..65535");
    return value;
  }

  if (typeof value === "string") {
    if (value.length === 0) return DEFAULT_PORT;
    if (!/^\d+$/.test(value)) throw new TypeError("port must be a number");
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n)) throw new TypeError("port must be an integer");
    if (n < 0 || n > 65535) throw new RangeError("port must be in the range 0..65535");
    return n;
  }

  if (typeof value === "boolean") return DEFAULT_PORT;

  throw new TypeError("port must be a number");
}

function normalizeOpenArgs(
  port?: any,
  host?: any,
  wait?: any,
): {
  port: number;
  host: string;
  wait: boolean;
} {
  let p = port;
  let h = host;
  let w = wait;

  if (typeof p === "boolean") {
    w = p;
    p = undefined;
    h = undefined;
  } else if (typeof h === "boolean") {
    w = h;
    h = undefined;
  }

  const normalizedPort = parsePort(p);
  const normalizedHost = typeof h === "string" && h.length > 0 ? h : DEFAULT_HOST;

  return { port: normalizedPort, host: normalizedHost, wait: !!w };
}

function open(port?: number, host?: string, wait?: boolean): void {
  const binding = getBinding();
  const args = normalizeOpenArgs(port, host, wait);

  const existing = binding.url();
  if (existing) {
    if (args.wait) binding.waitForDebugger();
    return;
  }

  const urlHost = formatHostForURL(args.host);
  const pathname = randomPathname();

  const wsUrl = `ws://${urlHost}:${args.port}${pathname}`;
  binding.open(wsUrl, args.wait);
}

function close(): void {
  getBinding().close();
}

function url(): string | undefined {
  return getBinding().url();
}

function waitForDebugger(): void {
  const binding = getBinding();
  if (!binding.url()) {
    open(true as any);
    return;
  }
  binding.waitForDebugger();
}

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  callback?: (err: Error | null, result?: any) => void;
};

// ---------------------------------------------------------------------------
// Hybrid fix (part 1): process-wide message id counter.
// Why:
// - Bun's in-process inspector sessions share the same underlying InspectorController,
//   which broadcasts responses to all connected frontends.
// - If each Session starts ids at 1, concurrent sessions collide and cross-talk.
// - Using a module-scope counter makes ids unique within the process.
// ---------------------------------------------------------------------------
let nextInspectorMessageId = 1;

class Session extends EventEmitter {
  #handle: any = null;
  #connected = false;

  #pending = new Map<number, PendingRequest>();

  #onNativeMessage?: (...messages: string[]) => void;

  connect(): void {
    if (this.#connected) return;

    const binding = getBinding();

    this.#onNativeMessage = (...messages: string[]) => {
      for (const msg of messages) {
        if (typeof msg === "string") this.#handleMessage(msg);
      }
    };

    // Node Session should not keep the process alive by default.
    const unrefEventLoop = true;

    const handle = binding.createSession(unrefEventLoop, this.#onNativeMessage);
    if (!handle) throw new Error("Failed to create inspector session");

    this.#handle = handle;
    this.#connected = true;
  }

  connectToMainThread(): void {
    // WorkerThreads compatibility: for now, treat it as connect().
    this.connect();
  }

  disconnect(): void {
    if (!this.#connected) return;

    const binding = getBinding();
    const handle = this.#handle;

    this.#handle = null;
    this.#connected = false;

    try {
      callNative(binding.sessionDisconnect, handle);
    } catch {
      // ignore
    }

    const err = new Error("Inspector session disconnected");
    for (const pending of this.#pending.values()) {
      try {
        pending.callback?.(err);
      } catch {
        // ignore
      }
      try {
        pending.reject(err);
      } catch {
        // ignore
      }
    }
    this.#pending.clear();
  }

  post(method: string, params?: any, callback?: (err: Error | null, result?: any) => void): Promise<any> | void {
    if (typeof params === "function") {
      callback = params;
      params = undefined;
    }

    if (typeof method !== "string" || method.length === 0) {
      throw new TypeError("Inspector Session.post: method must be a non-empty string");
    }

    if (!this.#connected || !this.#handle) {
      throw new Error("Inspector session is not connected");
    }

    const id = nextInspectorMessageId++;
    const message = params !== undefined ? { id, method, params } : { id, method };
    const payload = JSON.stringify(message);

    const binding = getBinding();

    if (typeof callback === "function") {
      this.#pending.set(id, {
        resolve: () => {},
        reject: () => {},
        callback,
      });

      callNative(binding.sessionSend, this.#handle, payload);
      return;
    }

    // Promise style (needed because Bun aliases inspector/promises -> inspector)
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try {
        callNative(binding.sessionSend, this.#handle, payload);
      } catch (err) {
        this.#pending.delete(id);
        reject(err);
      }
    });
  }

  #handleMessage(data: string): void {
    let msg: any;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    // Response
    if (msg && typeof msg.id === "number") {
      const pending = this.#pending.get(msg.id);
      if (!pending) return;
      this.#pending.delete(msg.id);

      if (msg.error) {
        const err = new Error(msg.error.message || "Inspector error");
        (err as any).code = msg.error.code;
        (err as any).data = msg.error.data;

        if (pending.callback) {
          try {
            pending.callback(err);
          } catch {
            // ignore
          }
        } else {
          pending.reject(err);
        }
        return;
      }

      if (pending.callback) {
        try {
          pending.callback(null, msg.result);
        } catch {
          // ignore
        }
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // Notification
    if (msg && typeof msg.method === "string") {
      this.emit("inspectorNotification", msg);
      this.emit(msg.method, msg.params);
    }
  }
}

const console = {
  ...globalThis.console,
  context: {
    console: globalThis.console,
  },
};

export default {
  console,
  open,
  close,
  url,
  waitForDebugger,
  Session,
};

hideFromStack(open, close, url, waitForDebugger, Session.prototype.constructor);
