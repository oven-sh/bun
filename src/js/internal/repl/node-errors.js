// Error-code shims for Node.js sources ported into Bun (node:repl stack).
// Most codes route to Bun's native $ERR_* constructors; the REPL-specific
// ones that Bun's ErrorCode registry lacks are defined here.

function ERR_INVALID_ARG_TYPE(...args) {
  return $ERR_INVALID_ARG_TYPE(...args);
}
function ERR_INVALID_ARG_VALUE(...args) {
  return $ERR_INVALID_ARG_VALUE(...args);
}
function ERR_MISSING_ARGS(...args) {
  return $ERR_MISSING_ARGS(...args);
}
function ERR_USE_AFTER_CLOSE(...args) {
  return $ERR_USE_AFTER_CLOSE(...args);
}
function ERR_INVALID_CURSOR_POS(...args) {
  return $ERR_INVALID_CURSOR_POS(...args);
}
function ERR_SCRIPT_EXECUTION_INTERRUPTED(...args) {
  return $ERR_SCRIPT_EXECUTION_INTERRUPTED(...args);
}
function ERR_INVALID_STATE(...args) {
  return $ERR_INVALID_STATE(...args);
}

class ERR_CANNOT_WATCH_SIGINT extends Error {
  code = "ERR_CANNOT_WATCH_SIGINT";
  constructor() {
    super("Cannot watch for interruptions when running asynchronously");
    this.name = "Error [ERR_CANNOT_WATCH_SIGINT]";
    Error.captureStackTrace?.(this, ERR_CANNOT_WATCH_SIGINT);
  }
}

class ERR_INSPECTOR_NOT_AVAILABLE extends Error {
  code = "ERR_INSPECTOR_NOT_AVAILABLE";
  constructor() {
    super("Inspector is not available");
    this.name = "Error [ERR_INSPECTOR_NOT_AVAILABLE]";
    Error.captureStackTrace?.(this, ERR_INSPECTOR_NOT_AVAILABLE);
  }
}

class ERR_INVALID_REPL_EVAL_CONFIG extends TypeError {
  code = "ERR_INVALID_REPL_EVAL_CONFIG";
  constructor() {
    super('Cannot specify both "breakEvalOnSigint" and "eval" for REPL');
    this.name = "TypeError [ERR_INVALID_REPL_EVAL_CONFIG]";
    Error.captureStackTrace?.(this, ERR_INVALID_REPL_EVAL_CONFIG);
  }
}

class ERR_INVALID_REPL_INPUT extends TypeError {
  code = "ERR_INVALID_REPL_INPUT";
  constructor(message) {
    super(message);
    this.name = "TypeError [ERR_INVALID_REPL_INPUT]";
    Error.captureStackTrace?.(this, ERR_INVALID_REPL_INPUT);
  }
}

class AbortError extends Error {
  code = "ABORT_ERR";
  name = "AbortError";
  constructor(message = "The operation was aborted", options = undefined) {
    super(message, options);
  }
}

// `instanceof ERR_X` must work on errors produced by the Bun-native $ERR_*
// constructors; builtin function declarations have no .prototype, so route
// instanceof through Symbol.hasInstance keyed on the error code.
for (const fn of [
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_MISSING_ARGS,
  ERR_USE_AFTER_CLOSE,
  ERR_INVALID_CURSOR_POS,
  ERR_SCRIPT_EXECUTION_INTERRUPTED,
  ERR_INVALID_STATE,
]) {
  Object.defineProperty(fn, Symbol.hasInstance, {
    __proto__: null,
    value: e => typeof e === "object" && e !== null && e.code === fn.name,
  });
}

// API-shape stub of Node's internal/errors.overrideStackTrace. In Node this
// WeakMap registers a one-shot prepareStackTrace formatter that fires when
// the error's stack is lazily materialized. Under JSC the stack is already a
// string by the time the REPL's _handleError registers the override, so the
// formatter never fires; REPL frame trimming is done in decorateErrorStack
// instead. The earlier implementation installed a global
// Error.prepareStackTrace hook that chained to Bun's native default formatter,
// which throws for non-Error targets — breaking Error.captureStackTrace(obj)
// process-wide after the first REPL error. Keep the registry inert: track
// entries for get/delete parity but never touch Error.prepareStackTrace.
const overrideStackTraceMap = new WeakMap();

const overrideStackTrace = {
  set(error, fn) {
    return overrideStackTraceMap.set(error, fn);
  },
  get(error) {
    return overrideStackTraceMap.get(error);
  },
  delete(error) {
    return overrideStackTraceMap.delete(error);
  },
};

function isErrorStackTraceLimitWritable() {
  const desc = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit");
  if (desc === undefined) return Object.isExtensible(Error);
  return Object.prototype.hasOwnProperty.$call(desc, "writable") ? desc.writable : desc.set !== undefined;
}

function ErrorPrepareStackTrace(error, stackFrames) {
  let out = `${error.name ?? "Error"}${error.message ? ": " + error.message : ""}`;
  for (const frame of stackFrames ?? []) {
    out += `\n    at ${frame.toString()}`;
  }
  return out;
}

export default {
  ErrorPrepareStackTrace,
  overrideStackTrace,
  isErrorStackTraceLimitWritable,
  AbortError,
  codes: {
    ERR_INVALID_ARG_TYPE,
    ERR_INVALID_ARG_VALUE,
    ERR_MISSING_ARGS,
    ERR_USE_AFTER_CLOSE,
    ERR_INVALID_CURSOR_POS,
    ERR_SCRIPT_EXECUTION_INTERRUPTED,
    ERR_INVALID_STATE,
    ERR_CANNOT_WATCH_SIGINT,
    ERR_INSPECTOR_NOT_AVAILABLE,
    ERR_INVALID_REPL_EVAL_CONFIG,
    ERR_INVALID_REPL_INPUT,
  },
};
