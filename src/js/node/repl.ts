// Hardcoded module "node:repl"
// This is a stub! None of this is actually implemented yet.
// It only exists to make some packages which import this module work.
const { throwNotImplemented } = require("internal/shared");
const { inspect } = require("node:util");

const builtinModules = [
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
  "node:test",
];

const REPL_MODE_SLOPPY = Symbol("repl-sloppy");
const REPL_MODE_STRICT = Symbol("repl-strict");

function start() {
  throwNotImplemented("node:repl", 28478);
}

function REPLServer() {
  throwNotImplemented("node:repl REPLServer", 28478);
}

class Recoverable extends SyntaxError {
  err;
  constructor(err) {
    super();
    this.err = err;
  }
}

function writer(obj) {
  return inspect(obj, writer.options);
}
writer.options = { ...inspect.replDefaults };

// The module-level exports match Node's `require("node:repl")` shape. Instance
// fields like `context`/`terminal`/`useGlobal` belong to a REPLServer instance,
// not this module, so they are intentionally absent.
export default {
  start,
  REPLServer,
  Recoverable,
  REPL_MODE_SLOPPY,
  REPL_MODE_STRICT,
  writer,
  _builtinLibs: builtinModules,
  builtinModules: builtinModules,
};
