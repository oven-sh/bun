var $;// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from src/js/node/repl.ts


// Hardcoded module "node:repl"
// This is a stub! None of this is actually implemented yet.
// It only exists to make some packages which import this module work.
const { throwNotImplemented } = (__intrinsic__getInternalField(__intrinsic__internalModuleRegistry, 6/*internal/shared.ts*/) || __intrinsic__createInternalModuleById(6/*internal/shared.ts*/));

function REPLServer() {
  throwNotImplemented("node:repl REPLServer");
}

function Recoverable() {
  throwNotImplemented("node:repl Recoverable");
}

var REPL_MODE_SLOPPY = 0,
  REPL_MODE_STRICT = 1;

function start() {
  throwNotImplemented("node:repl");
}

$ = {
  lines: [],
  context: globalThis,
  historyIndex: -1,
  cursor: 0,
  historySize: 1000,
  removeHistoryDuplicates: false,
  crlfDelay: 100,
  completer: () => {
    throwNotImplemented("node:repl");
  },
  history: [],
  _initialPrompt: "> ",
  terminal: true,
  input: new Proxy(
    {},
    {
      get() {
        throwNotImplemented("node:repl");
      },
      has: () => false,
      ownKeys: () => [],
      getOwnPropertyDescriptor: () => undefined,
      set() {
        throwNotImplemented("node:repl");
      },
    },
  ),
  line: "",
  eval: () => {
    throwNotImplemented("node:repl");
  },
  isCompletionEnabled: true,
  escapeCodeTimeout: 500,
  tabSize: 8,
  breakEvalOnSigint: true,
  useGlobal: true,
  underscoreAssigned: false,
  last: undefined,
  _domain: undefined,
  allowBlockingCompletions: false,
  useColors: true,
  output: new Proxy(
    {},
    {
      get() {
        throwNotImplemented("node:repl");
      },
      has: () => false,
      ownKeys: () => [],
      getOwnPropertyDescriptor: () => undefined,
      set() {
        throwNotImplemented("node:repl");
      },
    },
  ),
  _builtinLibs: [
    "bun",
    "ffi",
    "assert",
    "assert/strict",
    "async_hooks",
    "buffer",
    "child_process",
    "cluster",
    "console",
    "constants",
    "crypto",
    "dgram",
    "diagnostics_channel",
    "dns",
    "dns/promises",
    "domain",
    "events",
    "fs",
    "fs/promises",
    "http",
    "http2",
    "https",
    "inspector",
    "inspector/promises",
    "module",
    "net",
    "os",
    "path",
    "path/posix",
    "path/win32",
    "perf_hooks",
    "process",
    "punycode",
    "querystring",
    "readline",
    "readline/promises",
    "repl",
    "stream",
    "stream/consumers",
    "stream/promises",
    "stream/web",
    "string_decoder",
    "sys",
    "timers",
    "timers/promises",
    "tls",
    "trace_events",
    "tty",
    "url",
    "util",
    "util/types",
    "v8",
    "vm",
    "wasi",
    "worker_threads",
    "zlib",
  ],
};
$$EXPORT$$($).$$EXPORT_END$$;
