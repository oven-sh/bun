// Hardcoded module "node:inspector" and "node:inspector/promises"
//
// PR2 scope:
// - Implement open/close/url/waitForDebugger.
// - Keep Session as NotImplemented (implemented in PR3).

const { hideFromStack, throwNotImplemented } = require("internal/shared");
const EventEmitter = require("node:events");

type NativeInspectorBinding = {
  open: (url: string, wait: boolean) => void;
  close: () => void;
  url: () => string | undefined;
  waitForDebugger: () => void;
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
    typeof binding.waitForDebugger !== "function"
  ) {
    throwNotImplemented("node:inspector", 2445, "Missing Bun internal binding (__bunInspector)");
  }

  cachedBinding = binding;
  return binding;
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
  // Node signature: open([port[, host[, wait]]])
  let p = port;
  let h = host;
  let w = wait;

  // Convenience: open(true) or open(port, true)
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

  // If already open, be idempotent.
  const existing = binding.url();
  if (existing) {
    if (args.wait) binding.waitForDebugger();
    return;
  }

  const urlHost = formatHostForURL(args.host);
  const pathname = randomPathname();

  // port=0 allowed, native side will bind and then update url()
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
    open(undefined as any, undefined as any, true as any);
    return;
  }
  binding.waitForDebugger();
}

class Session extends EventEmitter {
  constructor() {
    super();
    throwNotImplemented("node:inspector", 2445, "Session is implemented in PR3");
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
