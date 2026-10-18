// Pre-user-code bootstrap. Required natively from
// VirtualMachine::reload_entry_point (via Bun__preExecutionBootstrap) when
// argv contains a Node.js `--trace-*` flag, before the entry module — main
// file, worker, or `-e` eval — is evaluated. Must stay cheap: one execArgv
// scan, bail early when nothing applies.

let writeSync: typeof import("node:fs").writeSync;
// The frames as text, with no Error and no `Error.prepareStackTrace`: Node prints its traces from native code.
// A built-in module is `node:internal/<id>` in them, as in Node (and its tests match that form, for example
// /internal\/process\/pre_execution/).
let formatCurrentStackTrace: (frameLimit: number, framesToSkip: number) => string;
let envTracePrintMessage = false;
let envTracePrintJsStack = false;
let inEnvTrace = false;
let sourceLineCache: Map<string, string[] | null> | undefined;

function writeStderr(out: string): void {
  try {
    writeSync(2, out);
  } catch {
    // Tracing output is best-effort (e.g. EPIPE on a closed stderr).
  }
}

function getSourceLine(file: string, line: number): string | null {
  sourceLineCache ??= new Map();
  let lines = sourceLineCache.$get(file);
  if (lines === undefined) {
    try {
      // Raw binding capture, NOT node:fs: evaluating node:fs here (the first
      // user-code env access) would freeze unwrapped natives into its bound
      // exports, so a later dynamic createTracing(...).enable() of fs
      // categories would miss events; it also keeps this read out of
      // fs.sync traces.
      lines = (require("internal/trace_events").rawReadFileSync(file, "utf8") as string).split("\n");
    } catch {
      lines = null;
    }
    sourceLineCache.$set(file, lines);
  }
  return lines === null ? null : (lines[line - 1] ?? null);
}

// NOTE: every regex below is built with `new RegExp(<string>)` instead of a
// regex literal — the builtin-bundler's source slicer (codegen/builtin-parser
// sliceSourceCode) miscounts brackets inside regex-literal character classes
// and silently truncates the module.
const RE_SAFE_KEY = new RegExp("^[A-Za-z0-9_]+$");
const RE_IN_OP = new RegExp("\\bin\\b");
const RE_SPREAD_MEMBER = new RegExp("\\.\\.\\.\\s*[\\w$]+(?:\\s*\\.\\s*[\\w$]+)+");
const RE_FRAME_LOC = new RegExp("([^()\\s]+):(\\d+):(\\d+)\\)?$");

type EnvOpKind = "get" | "set" | "query" | "delete" | "define" | "descriptor" | "enumerate";

// JSC and V8 disagree on the source column a stack frame reports for the
// expression that triggered an env-var operation (JSC anchors member reads at
// the base property, V8 at the accessed property; assignments at the LHS vs
// the `=`; etc). Node's --trace-env-js-stack tests assert V8's columns, so
// recover them from the source text of the user frame. Returns a 1-based
// column, or -1 to keep the JSC column (which already matches for
// defineProperty, Object.hasOwn/hasOwnProperty and Object.keys sites).
function v8Column(kind: EnvOpKind, file: string, line: number, key: string | null): number {
  if (kind === "descriptor" || kind === "define") return -1;
  const text = getSourceLine(file, line);
  if (text === null) return -1;
  switch (kind) {
    case "get": {
      // `obj.KEY` → column of KEY.
      if (key === null || !RE_SAFE_KEY.test(key)) return -1;
      const m = text.match(new RegExp("\\.\\s*" + key + "\\b"));
      if (!m) return -1;
      return m.index! + (m[0].length - key.length) + 1;
    }
    case "set": {
      // `obj.KEY = v` → column of `=`.
      if (key === null || !RE_SAFE_KEY.test(key)) return -1;
      const m = text.match(new RegExp("\\.\\s*" + key + "\\s*=(?![=>])"));
      if (!m) return -1;
      return m.index! + m[0].length;
    }
    case "query": {
      // `KEY in obj` → column of `in`.
      const m = text.match(RE_IN_OP);
      if (!m) return -1;
      return m.index! + 1;
    }
    case "delete": {
      // `delete obj.base.KEY` → column of `base` (the property preceding KEY).
      if (key === null || !RE_SAFE_KEY.test(key)) return -1;
      const m = text.match(new RegExp("\\.\\s*" + key + "\\b"));
      if (!m) return -1;
      const prevDot = text.lastIndexOf(".", m.index! - 1);
      if (prevDot < 0) return -1;
      let i = prevDot + 1;
      while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
      return i + 1;
    }
    case "enumerate": {
      // `{ ...obj.base }` spread → column of the last property of the spread
      // expression. Plain Object.keys(obj) sites already match.
      const m = text.match(RE_SPREAD_MEMBER);
      if (!m) return -1;
      const lastDot = text.lastIndexOf(".", m.index! + m[0].length - 1);
      let i = lastDot + 1;
      while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
      return i + 1;
    }
  }
  return -1;
}

function printEnvTrace(kind: EnvOpKind, key: string | null): void {
  if (inEnvTrace) return;
  inEnvTrace = true;
  try {
    let out = "";
    if (envTracePrintMessage) {
      // Matches node_env_var.cc TraceEnvVar: `[--trace-env] <op> "<key>"`.
      const op = kind === "define" ? "set" : kind === "descriptor" ? "query" : kind;
      out = key === null ? "[--trace-env] enumerate environment variables\n" : `[--trace-env] ${op} "${key}"\n`;
    }
    if (envTracePrintJsStack) {
      // Node prints ten frames, whatever `Error.stackTraceLimit` and `--stack-trace-limit` are:
      // https://github.com/nodejs/node/blob/v26.3.0/src/node_internals.h#L86-L88
      // The 2 frames not printed are printEnvTrace and the proxy trap.
      const stack = formatCurrentStackTrace(10, 2).split("\n");
      // A newline comes before each frame, so stack[0] is empty.
      let corrected = false;
      for (let i = 1; i < stack.length; i++) {
        let frame = stack[i];
        if (!corrected) {
          const m = frame.match(RE_FRAME_LOC);
          if (m && !m[1].startsWith("node:internal/") && !m[1].startsWith("native") && m[1] !== "unknown") {
            corrected = true;
            const col = v8Column(kind, m[1], Number(m[2]), key);
            if (col > 0) {
              const closeParen = frame.endsWith(")") ? ")" : "";
              frame = frame.slice(0, m.index!) + m[1] + ":" + m[2] + ":" + col + closeParen;
            }
          }
        }
        out += frame + "\n";
      }
    }
    if (out !== "") writeStderr(out);
  } finally {
    inEnvTrace = false;
  }
}

// Captured at module-eval time (before user code runs) so the proxy traps
// keep working even if user code overwrites Reflect.* later.
const ReflectGet = Reflect.get;
const ReflectSet = Reflect.set;
const ReflectHas = Reflect.has;
const ReflectDeleteProperty = Reflect.deleteProperty;
const ReflectDefineProperty = Reflect.defineProperty;
const ReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const ReflectOwnKeys = Reflect.ownKeys;

function installEnvTracing(): void {
  const real = process.env;
  const proxy = new Proxy(real, {
    get(target, prop) {
      if (typeof prop === "string") printEnvTrace("get", prop);
      return ReflectGet(target, prop);
    },
    set(target, prop, value) {
      if (typeof prop === "string") printEnvTrace("set", prop);
      return ReflectSet(target, prop, value);
    },
    has(target, prop) {
      if (typeof prop === "string") printEnvTrace("query", prop);
      return ReflectHas(target, prop);
    },
    deleteProperty(target, prop) {
      if (typeof prop === "string") printEnvTrace("delete", prop);
      return ReflectDeleteProperty(target, prop);
    },
    defineProperty(target, prop, desc) {
      if (typeof prop === "string") printEnvTrace("define", prop);
      return ReflectDefineProperty(target, prop, desc);
    },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === "string") printEnvTrace("descriptor", prop);
      return ReflectGetOwnPropertyDescriptor(target, prop);
    },
    ownKeys(target) {
      printEnvTrace("enumerate", null);
      return ReflectOwnKeys(target);
    },
  });
  Object.defineProperty(process, "env", {
    value: proxy,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  readStartupEnvVars();
}

// Node.js reads these env vars while bootstrapping even an empty script, and
// test-trace-env asserts a `get "<name>"` line for each. Bun's startup reads
// env natively (not through process.env), so mirror the reads through the
// traced path. Kept in this module on purpose: with --trace-env-js-stack the
// printed frame must contain `internal/process/pre_execution`.
function readStartupEnvVars(): void {
  const env = process.env;
  const names = [
    "NODE_ICU_DATA",
    "NODE_EXTRA_CA_CERTS",
    "OPENSSL_CONF",
    "NODE_DEBUG_NATIVE",
    "NODE_COMPILE_CACHE",
    "NODE_NO_WARNINGS",
    "NODE_V8_COVERAGE",
    "NODE_DEBUG",
    "NODE_CHANNEL_FD",
    "NODE_UNIQUE_ID",
    process.platform === "win32" ? "USERPROFILE" : "HOME",
    "NODE_PATH",
    "WATCH_REPORT_DEPENDENCIES",
  ];
  for (let i = 0; i < names.length; i++) void env[names[i]];
}

{
  const execArgv = process.execArgv;
  let catString: string | null = null;
  let filePattern: string | null = null;
  let stackTraceLimit: string | null = null;
  let traceEnv = false;
  let traceEnvJsStack = false;
  let traceExit = false;

  for (let i = 0; i < execArgv.length; i++) {
    const arg = execArgv[i];
    if (arg === "--trace-events-enabled") {
      // Node alias: expands to `--trace-event-categories
      // v8,node,node.async_hooks` at this position; a later explicit
      // --trace-event-categories overrides it (and vice versa).
      catString = "v8,node,node.async_hooks";
    } else if (arg === "--trace-event-categories") {
      if (i + 1 < execArgv.length) catString = execArgv[++i];
    } else if (arg.startsWith("--trace-event-categories=")) {
      catString = arg.slice("--trace-event-categories=".length);
    } else if (arg === "--trace-event-file-pattern") {
      if (i + 1 < execArgv.length) filePattern = execArgv[++i];
    } else if (arg.startsWith("--trace-event-file-pattern=")) {
      filePattern = arg.slice("--trace-event-file-pattern=".length);
    } else if (arg === "--stack-trace-limit") {
      if (i + 1 < execArgv.length) stackTraceLimit = execArgv[++i];
    } else if (arg.startsWith("--stack-trace-limit=")) {
      stackTraceLimit = arg.slice("--stack-trace-limit=".length);
    } else if (arg === "--trace-env") {
      traceEnv = true;
    } else if (arg === "--trace-env-js-stack") {
      traceEnvJsStack = true;
    } else if (arg === "--trace-env-native-stack") {
      // Accepted but a no-op: bun has no native env accessors to backtrace
      // through, and node prints only native frames for this flag (no
      // message lines). Never print "PrintTraceEnvStack" — the vendored test
      // keys its native-stack assertions on that string appearing.
    } else if (arg === "--trace-exit") {
      traceExit = true;
    }
  }

  // Node's --trace-exit prints `--stack-trace-limit` frames, not `Error.stackTraceLimit` frames:
  // https://github.com/nodejs/node/blob/v26.3.0/src/env.cc#L1911-L1915
  let exitTraceFrameLimit: number | undefined;
  if (stackTraceLimit !== null) {
    const limit = Number(stackTraceLimit);
    if (Number.isFinite(limit)) {
      Error.stackTraceLimit = limit;
      exitTraceFrameLimit = limit;
    }
  }

  // CLI-driven tracing runs in worker VMs too (workers inherit the parent's
  // execArgv): each worker buffers its own events and flushes them to a
  // `<file>.<tid>.part` file at worker exit; the main thread merges parts.
  // (`require('node:trace_events')` still throws in workers — only the
  // module API is main-thread-only, not CLI-driven tracing.)
  //
  // ORDER MATTERS: this must run before anything below evaluates node:fs.
  // node:fs captures the shared fs-binding methods via `.bind()` at
  // module-eval time, so requiring it before installFsInstrumentation would
  // freeze the unwrapped natives into the bound exports and fs.sync/fs.async
  // trace events would silently go missing.
  if (catString !== null) {
    require("internal/trace_events").initFromCli(catString, filePattern);
  } else if (filePattern !== null) {
    // Node honors --trace-event-file-pattern no matter how tracing is later
    // enabled (e.g. a dynamic createTracing(...).enable()), so hand the
    // pattern to the agent even when no CLI categories were given.
    require("internal/trace_events").setFilePattern(filePattern);
  }

  if (traceExit) {
    const enableExitTrace = $newCppFunction("BunProcess.cpp", "jsFunctionEnableExitTrace", 1) as (
      frameLimit: number | undefined,
    ) => void;
    enableExitTrace(exitTraceFrameLimit);
  }
  if (traceEnv || traceEnvJsStack) {
    // The agent's raw binding capture, NOT node:fs — loading node:fs here
    // would freeze unwrapped natives into its bound exports and a later
    // dynamic createTracing(...).enable() of fs categories would miss events;
    // it also keeps our own stderr writes out of fs.sync traces.
    writeSync = require("internal/trace_events").rawWriteSync;
    envTracePrintMessage = traceEnv;
    envTracePrintJsStack = traceEnvJsStack;
    if (traceEnvJsStack) {
      formatCurrentStackTrace = $newCppFunction(
        "FormatStackTraceForJS.cpp",
        "jsFunctionFormatCurrentStackTrace",
        2,
      ) as typeof formatCurrentStackTrace;
    }
    installEnvTracing();
  }
}

export default {};
