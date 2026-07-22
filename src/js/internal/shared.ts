const { SafeArrayIterator } = require("internal/primordials");

const ObjectFreeze = Object.freeze;

class NotImplementedError extends Error {
  code: string;
  constructor(feature: string, issue?: number, extra?: string) {
    super(
      feature +
        " is not yet implemented in Bun." +
        (issue ? " Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/" + issue : "") +
        (extra ? ". " + extra : ""),
    );
    this.name = "NotImplementedError";
    this.code = "ERR_NOT_IMPLEMENTED";

    // in the definition so that it isn't bundled unless used
    hideFromStack(NotImplementedError);
  }
  get ["constructor"]() {
    return Error;
  }
}

function throwNotImplemented(feature: string, issue?: number, extra?: string): never {
  // in the definition so that it isn't bundled unless used
  hideFromStack(throwNotImplemented);

  throw new NotImplementedError(feature, issue, extra);
}

function hideFromStack(...fns: Function[]) {
  for (const fn of fns) {
    Object.defineProperty(fn, "name", {
      value: "::bunternal::",
    });
  }
}

let warned: Set<string>;
function warnNotImplementedOnce(feature: string, issue?: number) {
  if (!warned) {
    warned = new Set();
  }

  if (warned.has(feature)) {
    return;
  }
  warned.add(feature);
  console.warn(new NotImplementedError(feature, issue));
}

let util: typeof import("node:util");
class ExceptionWithHostPort extends Error {
  errno: number;
  syscall: string;
  port?: number;
  address: string;

  constructor(err: number, syscall: string, address: string, port?: number, additional?: string) {
    // TODO(joyeecheung): We have to use the type-checked
    // getSystemErrorName(err) to guard against invalid arguments from users.
    // This can be replaced with [ code ] = errmap.get(err) when this method
    // is no longer exposed to user land.
    util ??= require("node:util");
    const code = util.getSystemErrorName(err);
    let details = "";
    if (port && port > 0) {
      details = ` ${address}:${port}`;
    } else if (address) {
      details = ` ${address}`;
    }
    if (additional) {
      details += ` - Local (${additional})`;
    }

    super(`${syscall} ${code}${details}`);

    this.errno = err;
    this.code = code;
    this.syscall = syscall;
    this.address = address;
    if (port) {
      this.port = port;
    }
  }
  get ["constructor"]() {
    return Error;
  }
}

class NodeAggregateError extends AggregateError {
  constructor(errors, message) {
    super(new SafeArrayIterator(errors), message);
    this.code = errors[0]?.code;
  }
  get ["constructor"]() {
    return AggregateError;
  }
}

class ConnResetException extends Error {
  constructor(msg) {
    super(msg);
    this.code = "ECONNRESET";
  }
  get ["constructor"]() {
    return Error;
  }
}

class ErrnoException extends Error {
  errno: number;
  syscall: string;

  constructor(err, syscall, original) {
    util ??= require("node:util");
    const code = util.getSystemErrorName(err);
    const message = original ? `${syscall} ${code} ${original}` : `${syscall} ${code}`;

    super(message);

    this.errno = err;
    this.code = code;
    this.syscall = syscall;
  }
  get ["constructor"]() {
    return Error;
  }
}

function once(callback, { preserveReturnValue = false } = kEmptyObject) {
  let called = false;
  let returnValue;
  return function (...args) {
    if (called) return returnValue;
    called = true;
    const fn = callback;
    // Drop the reference so the wrapper cannot keep the callback's
    // closure (and everything it captured) alive once it has run.
    callback = undefined;
    const result = fn.$apply(this, args);
    returnValue = preserveReturnValue ? result : undefined;
    return result;
  };
}

const kEmptyObject = ObjectFreeze(Object.create(null));

function getLazy<T>(initializer: () => T) {
  let value: T;
  let initialized = false;
  return function () {
    if (initialized) return value;
    value = initializer();
    initialized = true;
    return value;
  };
}

// ─── Node-style performance-entry observation ────────────────────────────────
// For entry types the native (WebCore) PerformanceObserver does not implement
// ('net', 'dns', ...). Mirrors lib/internal/perf/observe.js: producers check
// hasObserver() before doing any work, startPerf() stashes a context on the
// producing object, and stopPerf() builds a plain entry and dispatches it to
// the registered observers on a fresh tick.
// https://github.com/nodejs/node/blob/v25.2.1/lib/internal/perf/observe.js

const observerCounts = new Map();
const kObservers = new Set();

/** Entry types routed through this JS-side registry instead of the native observer. */
const kNodeEntryTypes = new Set(["net", "dns", "http", "function"]);

function hasObserver(type) {
  return (observerCounts.get(type) ?? 0) > 0;
}

/**
 * Hand a finished entry to every registered observer. Used by callers that
 * construct the entry themselves (e.g. perf_hooks timerify) instead of the
 * startPerf/stopPerf pair.
 */
function enqueueNodeEntry(entry) {
  for (const observer of kObservers) {
    observer.bufferEntry(entry);
  }
}

// Node's PerformanceNodeEntry — the shape used by every JS-side entry type
// ('function', 'net', 'dns', 'http'). Lives here (not in perf_hooks.ts) so
// stopPerf can construct it without a circular require. The prototype chain
// is linked to PerformanceEntry by perf_hooks.ts at load time using its
// captured global (every construction is gated behind hasObserver(), which
// is only true after perf_hooks has loaded).
class PerformanceNodeEntry {
  name;
  entryType;
  startTime;
  duration;
  detail;

  constructor(name, entryType, startTime, duration, detail) {
    this.name = name;
    this.entryType = entryType;
    this.startTime = startTime;
    this.duration = duration;
    this.detail = detail;
  }

  toJSON() {
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      detail: this.detail,
    };
  }
}

function startPerf(target, key, context) {
  context.startTime = performance.now();
  target[key] = context;
}

function stopPerf(target, key, context) {
  const ctx = target[key];
  if (!ctx) {
    return;
  }
  target[key] = undefined;
  const startTime = ctx.startTime;
  // Node.js merges the detail recorded at startPerf() with the detail
  // passed to stopPerf() (e.g. http entries carry both req and res).
  const detail =
    ctx.detail !== undefined || context?.detail !== undefined ? { ...ctx.detail, ...context?.detail } : undefined;
  enqueueNodeEntry(new PerformanceNodeEntry(ctx.name, ctx.type, startTime, performance.now() - startTime, detail));
}

/**
 * One registered observer of node-only entry types. The PerformanceObserver
 * wrapper in node:perf_hooks owns one of these when it observes such a type.
 */
class NodeEntryObserver {
  callback;
  owner;
  types = new Set();
  buffer = [];
  scheduled = false;

  constructor(callback, owner) {
    this.callback = callback;
    this.owner = owner;
  }

  observe(types) {
    for (const type of this.types) {
      observerCounts.set(type, (observerCounts.get(type) ?? 1) - 1);
    }
    this.types = new Set(types);
    for (const type of this.types) {
      observerCounts.set(type, (observerCounts.get(type) ?? 0) + 1);
    }
    kObservers.add(this);
  }

  disconnect() {
    for (const type of this.types) {
      observerCounts.set(type, (observerCounts.get(type) ?? 1) - 1);
    }
    this.types.clear();
    this.buffer = [];
    kObservers.delete(this);
  }

  bufferEntry(entry) {
    if (!this.types.has(entry.entryType)) {
      return;
    }
    this.buffer.push(entry);
    if (!this.scheduled) {
      this.scheduled = true;
      setImmediate(() => {
        this.scheduled = false;
        const entries = this.buffer;
        if (entries.length === 0) {
          return;
        }
        this.buffer = [];
        this.callback.$call(undefined, makeNodeEntryList(entries), this.owner);
      });
    }
  }
}

function makeNodeEntryList(entries) {
  // Node's PerformanceObserverEntryList hands entries out in chronological
  // (startTime) order and getEntriesByName takes an optional type filter.
  const sorted = entries.slice().sort((a, b) => a.startTime - b.startTime);
  return {
    getEntries() {
      return sorted.slice();
    },
    getEntriesByType(type) {
      return sorted.filter(entry => entry.entryType === type);
    },
    getEntriesByName(name, type) {
      return sorted.filter(entry => entry.name === name && (type === undefined || entry.entryType === type));
    },
  };
}

//

export default {
  NotImplementedError,
  throwNotImplemented,
  hideFromStack,
  warnNotImplementedOnce,
  ExceptionWithHostPort,
  NodeAggregateError,
  ConnResetException,
  ErrnoException,
  once,
  getLazy,

  hasObserver,
  startPerf,
  stopPerf,
  enqueueNodeEntry,
  kNodeEntryTypes,
  NodeEntryObserver,
  PerformanceNodeEntry,

  kHandle: Symbol("kHandle"),
  kClusterOwner: Symbol("kClusterOwner"),
  kAutoDestroyed: Symbol("kAutoDestroyed"),
  kResistStopPropagation: Symbol("kResistStopPropagation"),
  kWeakHandler: Symbol("kWeak"),
  kGetNativeReadableProto: Symbol("kGetNativeReadableProto"),
  kEmptyObject,
};
