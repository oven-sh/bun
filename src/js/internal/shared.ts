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
  constructor(errors, message?) {
    super(new (require("internal/primordials").SafeArrayIterator)(errors), message);
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

  constructor(err, syscall, original?) {
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

// process.send() options marking cluster-internal traffic; the flag is a private name so user code cannot set it.
const kInternalSendOptions: any = Object.create(null);
$putByIdDirectPrivate(kInternalSendOptions, "internal", true);
ObjectFreeze(kInternalSendOptions);

// Node invokes fs/dns callbacks via InternalMakeCallback, so a throw becomes uncaughtException
// (not unhandledRejection); Bun runs them from a promise reaction so we reroute the throw.
// https://github.com/nodejs/node/blob/main/src/api/callback.cc
const reportUncaughtException = $newCppFunction("BunProcess.cpp", "jsFunctionReportUncaughtException", 1);

// Wrap a node-style callback so a throw inside it takes the uncaught path. The
// callback keeps its place in the event loop; only the throw is rerouted. The
// arity switch avoids materializing `arguments` for the shapes fs and dns use.
function guardCallback(callback) {
  return function guarded(a?, b?, c?) {
    try {
      switch (arguments.length) {
        case 0:
          return callback();
        case 1:
          return callback(a);
        case 2:
          return callback(a, b);
        case 3:
          return callback(a, b, c);
        default:
          return callback.$apply(undefined, arguments);
      }
    } catch (e) {
      reportUncaughtException(e);
    }
  };
}

const nodeModulesRE = /[\\/]node_modules[\\/]/;
const ErrorCaptureStackTrace = Error.captureStackTrace;
function returnStackFrames(_err: unknown, frames: unknown[]) {
  return frames;
}

// Port of node's IsInsideNodeModules: first real user frame inside node_modules?
// Guarded so a tampered Error.* never escapes to callers like url.parse.
// https://github.com/nodejs/node/blob/main/src/node_util.cc
function isInsideNodeModules(frameLimit: number): boolean {
  let prevLimit: unknown, prevPrepare: unknown;
  let frames: { getFileName(): string | null }[] | undefined;
  try {
    prevLimit = Error.stackTraceLimit;
    prevPrepare = Error.prepareStackTrace;
    Error.stackTraceLimit = frameLimit;
    Error.prepareStackTrace = returnStackFrames;
    const target: { stack?: unknown } = {};
    ErrorCaptureStackTrace(target, isInsideNodeModules);
    frames = target.stack as typeof frames;
  } catch {
  } finally {
    try {
      Error.stackTraceLimit = prevLimit as typeof Error.stackTraceLimit;
      Error.prepareStackTrace = prevPrepare as typeof Error.prepareStackTrace;
    } catch {}
  }
  if (!$isJSArray(frames)) return false;
  try {
    for (const frame of frames) {
      const filename = frame.getFileName();
      if (!filename || filename.startsWith("node:") || filename.startsWith("internal:") || filename === "native") {
        continue;
      }
      return nodeModulesRE.test(filename);
    }
  } catch {}
  return false;
}

// Marks an addEventListener() options object so that dispatch still invokes the
// listener after an unrelated listener called event.stopImmediatePropagation().
// `$kResistStopPropagation` is a private symbol the native EventTarget reads, so
// only these internal modules can reach it.
function resistStopPropagation<T extends object>(options: T): T & AddEventListenerOptions {
  (options as AddEventListenerOptions).$kResistStopPropagation = true;
  return options;
}

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
// Node's hasObserver(), startPerf() and stopPerf(): https://github.com/nodejs/node/blob/v26.3.0/lib/internal/perf/observe.js#L540-L566

// The copy that hasObserver() reads of the observer counts that native code keeps (Performance::observedTypesDidChange).
const observerCounts = [0, 0, 0, 0, 0, 0, 0];

// An entry type's index in observerCounts, which is PerformanceEntry::nodeTypeIndex (PerformanceEntry.h).
const kEntryTypeGc = 0;
const kEntryTypeHttp = 1;
const kEntryTypeHttp2 = 2;
const kEntryTypeNet = 3;
const kEntryTypeDns = 4;
const kEntryTypeQuic = 5;
const kEntryTypeFunction = 6;

function hasObserver(type: number): boolean {
  $assert(typeof type === "number", "hasObserver() takes a kEntryType* constant");
  return observerCounts[type] > 0;
}

type QueueNodeEntry = (entry: PerformanceNodeEntry, type: number) => void;
let queueNodeEntry: QueueNodeEntry | undefined;

/**
 * Hand a finished entry to every registered observer. Used by callers that
 * construct the entry themselves (e.g. perf_hooks timerify) instead of the
 * startPerf/stopPerf pair.
 */
function enqueueNodeEntry(entry: PerformanceNodeEntry, type: number) {
  queueNodeEntry ??= $newCppFunction("Performance.cpp", "jsFunctionQueueNodePerformanceEntry", 2) as QueueNodeEntry;
  queueNodeEntry(entry, type);
}

// Node's PerformanceNodeEntry — the shape used by every JS-side entry type
// ('function', 'net', 'dns', 'http'). Lives here (not in perf_hooks.ts) so
// stopPerf can construct it without a circular require.
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

/** `type` is the kEntryType* constant for the `type` that the context got at startPerf(). */
function stopPerf(target, key, type: number, context?) {
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
  enqueueNodeEntry(
    new PerformanceNodeEntry(ctx.name, ctx.type, startTime, performance.now() - startTime, detail),
    type,
  );
}

const isFrameOfStoppedModuleGraph = $newCppFunction("ModuleGraph.cpp", "jsFunctionIsFrameOfStoppedModuleGraph", 1);
/** Whether the script that is running is a disposed `Bun.ModuleGraph`'s (what it had queued still runs). */
function isStoppedModuleGraphRunning() {
  return isFrameOfStoppedModuleGraph(require("internal/async_context_frame").current());
}

// Node's ERR_INTERNAL_ASSERTION constructor appends this automatically; bun's
// $ERR_INTERNAL_ASSERTION takes the full message, so call sites share it here.
const kInternalAssertionSuffix =
  "\nThis is caused by either a bug in Node.js or incorrect usage of Node.js internals.\n" +
  "Please open an issue with this stack trace at https://github.com/nodejs/node/issues\n";

//

export default {
  isStoppedModuleGraphRunning,
  kInternalAssertionSuffix,
  throwNotImplemented,
  hideFromStack,
  warnNotImplementedOnce,
  ExceptionWithHostPort,
  NodeAggregateError,
  ConnResetException,
  ErrnoException,
  once,
  getLazy,
  guardCallback,
  isInsideNodeModules,
  resistStopPropagation,

  hasObserver,
  startPerf,
  stopPerf,
  enqueueNodeEntry,
  observerCounts,
  kEntryTypeGc,
  kEntryTypeHttp,
  kEntryTypeHttp2,
  kEntryTypeNet,
  kEntryTypeDns,
  kEntryTypeQuic,
  kEntryTypeFunction,
  PerformanceNodeEntry,

  kHandle: Symbol("kHandle"),
  kClusterOwner: Symbol("kClusterOwner"),
  kAutoDestroyed: Symbol("kAutoDestroyed"),
  kWeakHandler: Symbol("kWeak"),
  kCustomPromisifyArgsSymbol: Symbol("customPromisifyArgs"),
  kEmptyObject,
  kInternalSendOptions,
};
