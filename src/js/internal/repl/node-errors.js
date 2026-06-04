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

// Stack-trace override support (Node's internal/errors.overrideStackTrace).
// When an error is registered here, the next stack capture for it is routed
// through the registered formatter. Implemented via Error.prepareStackTrace,
// installed lazily on first use and chaining to any pre-existing hook.
const overrideStackTraceMap = new WeakMap();
let prepareInstalled = false;

function installPrepare() {
  if (prepareInstalled) return;
  prepareInstalled = true;
  const prev = Error.prepareStackTrace;
  Error.prepareStackTrace = function (error, stackFrames) {
    const frames = stackFrames ?? [];
    const override = overrideStackTraceMap.get(error);
    if (override !== undefined) {
      overrideStackTraceMap.delete(error);
      return override(error, frames);
    }
    if (typeof prev === "function") return prev(error, frames);
    // Default V8-style formatting.
    let out = `${error.name ?? "Error"}${error.message ? ": " + error.message : ""}`;
    for (const frame of stackFrames) {
      out += `\n    at ${frame.toString()}`;
    }
    return out;
  };
}

const overrideStackTrace = {
  set(error, fn) {
    installPrepare();
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
