// Error-code shims for Node.js sources ported into Bun (node:repl stack).
// All codes route to Bun's native $ERR_* constructors (registered in
// ErrorCode.ts), which give the Node-compatible `err.name` (bare "TypeError",
// with `[CODE]` only in toString()). `instanceof ERR_X` is keyed on `.code`.

function ERR_INVALID_ARG_TYPE(...args: [name: string, expected: string | string[], actual: unknown]) {
  return $ERR_INVALID_ARG_TYPE(...args);
}
function ERR_INVALID_ARG_VALUE(...args: [name: string, value: unknown, reason?: string]) {
  return $ERR_INVALID_ARG_VALUE(...args);
}
function ERR_MISSING_ARGS(...args: [string, ...string[]]) {
  return $ERR_MISSING_ARGS(...args);
}
function ERR_USE_AFTER_CLOSE(...args: [name: string]) {
  return $ERR_USE_AFTER_CLOSE(...args);
}
function ERR_INVALID_CURSOR_POS(...args: []) {
  return $ERR_INVALID_CURSOR_POS(...args);
}
function ERR_SCRIPT_EXECUTION_INTERRUPTED() {
  return $ERR_SCRIPT_EXECUTION_INTERRUPTED();
}
function ERR_INVALID_STATE(...args: [message: string]) {
  return $ERR_INVALID_STATE(...args);
}
// Bun's native $ERR_* gives Node-compatible `.name` and `.toString()`, but
// JSC materializes `.stack` from `.name + ": " + msg` at construction, so the
// `[CODE]` (which Node's prepareStackTrace injects) is missing there. The
// vendored REPL tests match on the stack text, so re-head it to `.toString()`.
function decorateNodeErrorStack<E extends Error>(e: E) {
  if (typeof e?.stack === "string") {
    const nl = e.stack.indexOf("\n");
    e.stack = e.toString() + (nl === -1 ? "" : e.stack.slice(nl));
  }
  return e;
}
function ERR_CANNOT_WATCH_SIGINT() {
  return decorateNodeErrorStack($ERR_CANNOT_WATCH_SIGINT("Cannot watch for interruptions when running asynchronously"));
}
function ERR_INSPECTOR_NOT_AVAILABLE() {
  return decorateNodeErrorStack($ERR_INSPECTOR_NOT_AVAILABLE("Inspector is not available"));
}
function ERR_INVALID_REPL_EVAL_CONFIG() {
  return decorateNodeErrorStack(
    $ERR_INVALID_REPL_EVAL_CONFIG('Cannot specify both "breakEvalOnSigint" and "eval" for REPL'),
  );
}
function ERR_INVALID_REPL_INPUT(message: string) {
  return decorateNodeErrorStack($ERR_INVALID_REPL_INPUT(message));
}
function AbortError(message = "The operation was aborted", options: ErrorOptions | undefined = undefined) {
  return $makeAbortError(message, options);
}

// Builtin function declarations have no .prototype, so route `instanceof`
// through Symbol.hasInstance keyed on the error code.
for (const fn of [
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
]) {
  Object.defineProperty(fn, Symbol.hasInstance, {
    __proto__: null,
    value: (e: unknown) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === fn.name,
  });
}

function isErrorStackTraceLimitWritable() {
  const desc = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit");
  if (desc === undefined) return Object.isExtensible(Error);
  return Object.prototype.hasOwnProperty.$call(desc, "writable") ? desc.writable : desc.set !== undefined;
}

/** The ported sources say `new ERR_X(..)`. A function that answers an object may be called that way. */
type Constructs<F extends (...args: never[]) => unknown> = new (...args: Parameters<F>) => ReturnType<F>;

interface Exports {
  isErrorStackTraceLimitWritable: typeof isErrorStackTraceLimitWritable;
  AbortError: Constructs<typeof AbortError>;
  codes: {
    ERR_INVALID_ARG_TYPE: Constructs<typeof ERR_INVALID_ARG_TYPE>;
    ERR_INVALID_ARG_VALUE: Constructs<typeof ERR_INVALID_ARG_VALUE>;
    ERR_MISSING_ARGS: Constructs<typeof ERR_MISSING_ARGS>;
    ERR_USE_AFTER_CLOSE: Constructs<typeof ERR_USE_AFTER_CLOSE>;
    ERR_INVALID_CURSOR_POS: Constructs<typeof ERR_INVALID_CURSOR_POS>;
    ERR_SCRIPT_EXECUTION_INTERRUPTED: Constructs<typeof ERR_SCRIPT_EXECUTION_INTERRUPTED>;
    ERR_INVALID_STATE: Constructs<typeof ERR_INVALID_STATE>;
    ERR_CANNOT_WATCH_SIGINT: Constructs<typeof ERR_CANNOT_WATCH_SIGINT>;
    ERR_INSPECTOR_NOT_AVAILABLE: Constructs<typeof ERR_INSPECTOR_NOT_AVAILABLE>;
    ERR_INVALID_REPL_EVAL_CONFIG: Constructs<typeof ERR_INVALID_REPL_EVAL_CONFIG>;
    ERR_INVALID_REPL_INPUT: Constructs<typeof ERR_INVALID_REPL_INPUT>;
  };
}

export default {
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
} as unknown as Exports;
