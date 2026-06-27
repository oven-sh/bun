// Consolidated shims for Node.js internal modules consumed by the ported
// node:repl / internal/readline stack. Each export matches the name and
// calling convention of the Node internal it replaces; implementations
// delegate to Bun equivalents.
const util = require("node:util");
const Module = require("node:module");
const path = require("node:path");

// ---- internal/util ----------------------------------------------------

const kEmptyObject = Object.freeze({ __proto__: null });

function SideEffectFreeRegExpPrototypeSymbolReplace(regexp, str, replacement) {
  return regexp[Symbol.replace](str, replacement);
}

function SideEffectFreeRegExpPrototypeSymbolSplit(regexp, str, limit) {
  return regexp[Symbol.split](str, limit);
}

function assignFunctionName(name, fn) {
  return Object.defineProperty(fn, "name", {
    __proto__: null,
    configurable: true,
    value: name,
  });
}

function decorateErrorStack(err) {
  // JSC materializes stacks eagerly so Node's overrideStackTrace never runs;
  // reproduce it by normalizing "<anonymous> (loc)" frames and cutting at the
  // last REPLn:l:c frame (drops the REPL top-level + vm runner frames).
  if (typeof err?.stack !== "string") return err;
  let lines = err.stack.split("\n");
  lines = lines.map(l => l.replace(/^(\s+at )<anonymous> \((.+)\)$/, "$1$2"));
  let anonIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s+at REPL\d*:\d+:\d+$/.test(lines[i])) anonIdx = i;
  }
  if (anonIdx !== -1) lines = lines.slice(0, anonIdx);
  const newStack = lines.join("\n");
  if (newStack !== err.stack) {
    // Errors with a non-writable .stack (Object.freeze, getter-only) must
    // not turn into a TypeError that escapes the REPL's error handler.
    try {
      err.stack = newStack;
    } catch {}
  }
  return err;
}

function isError(e) {
  return e instanceof Error || Object.prototype.toString.$call(e) === "[object Error]";
}

// ---- internal/util/colors ----------------------------------------------

function shouldColorize(stream) {
  if (process.env.FORCE_COLOR !== undefined) {
    const getColorDepth = require("node:tty").WriteStream.prototype.getColorDepth;
    return getColorDepth.$call({}) > 2;
  }
  return stream?.isTTY && (typeof stream.getColorDepth === "function" ? stream.getColorDepth() > 2 : true);
}

// ---- internal/util/debuglog ----------------------------------------------

function debuglog(set, cb) {
  const fn = util.debuglog(set);
  if (typeof cb === "function") cb(fn);
  return fn;
}

// ---- internal/util/inspector ----------------------------------------------

function sendInspectorCommand(cb, onError) {
  return onError();
}

// ---- internal/util/types ----------------------------------------------

const isProxy = util.types.isProxy;

// ---- internal/options ----------------------------------------------

function getOptionValue(name) {
  switch (name) {
    case "--pending-deprecation":
      return process.execArgv.includes("--pending-deprecation");
    case "--experimental-repl-await":
      return true;
    case "--use-strict":
      return false;
    default:
      return undefined;
  }
}

// ---- internal/process/permission ----------------------------------------------

function isEnabled() {
  return false;
}

function has() {
  return true;
}

// ---- internal/streams/utils ----------------------------------------------

function isWritable(stream) {
  return typeof stream?.write === "function";
}

// ---- internal/events/abort_listener ----------------------------------------------

function addAbortListener(signal, listener) {
  if (require("node:events").addAbortListener) {
    return require("node:events").addAbortListener(signal, listener);
  }
  if (signal.aborted) {
    queueMicrotask(() => listener());
  } else {
    signal.addEventListener("abort", listener, { once: true });
  }
  return {
    [Symbol.dispose]() {
      signal?.removeEventListener("abort", listener);
    },
  };
}

// ---- internal/bootstrap/realm ----------------------------------------------

const BuiltinModule = {
  getSchemeOnlyModuleNames() {
    // Bare names; completion.js prefixes them with "node:" itself.
    return ["test"];
  },
  exists(id) {
    return Module.isBuiltin(id);
  },
  canBeRequiredByUsers(id) {
    return Module.isBuiltin(id);
  },
  canBeRequiredWithoutScheme(id) {
    return Module.isBuiltin(id) && Module.isBuiltin("node:" + id);
  },
};

// ---- internal/modules/esm/get_format ----------------------------------------------

const extensionFormatMap = {
  __proto__: null,
  ".cjs": "commonjs",
  ".js": "module",
  ".json": "json",
  ".mjs": "module",
  ".node": "addon",
  ".wasm": "wasm",
};

// ---- internal/modules/esm/loader ----------------------------------------------

const cascadedLoader = {
  kEvaluationPhase: "evaluation",
  kSourcePhase: "source",
  import(specifier, parentURL, _importAttributes, _phase) {
    // Relative specifiers resolve against the referrer the REPL threads
    // through (cwd/repl), not against this bundled module.
    if (parentURL && (specifier.startsWith("./") || specifier.startsWith("../"))) {
      return import(new URL(specifier, parentURL).href);
    }
    return import(specifier);
  },
};

function getOrInitializeCascadedLoader() {
  return cascadedLoader;
}

// ---- internal/modules/helpers ----------------------------------------------

function makeRequireFunction(_mod) {
  // Anchor relative requires to the REPL's cwd. process.cwd() throws when the
  // working directory has been deleted; same fallback as fixReplRequire
  // (internal/repl/utils.js).
  let cwd;
  try {
    cwd = process.cwd();
  } catch {
    cwd = path.dirname(process.execPath);
  }
  return Module.createRequire(path.join(cwd, "<repl>"));
}

let builtinLibs;

function getBuiltinLibs() {
  if (!builtinLibs) {
    // Bun's builtinModules also lists `bun`, `bun:*`, `undici`, `ws`; none
    // resolve under `node:`, so exclude them so completion and the REPL
    // global scope match Node's.
    builtinLibs = Module.builtinModules.filter(
      id => !id.startsWith("_") && !id.startsWith("node:") && !id.startsWith("bun") && id !== "undici" && id !== "ws",
    );
  }
  return builtinLibs;
}

function addBuiltinLibsToObject(object, _dummy) {
  // Make built-in modules available directly (loaded lazily). Builtin
  // specifiers don't need a cwd-anchored referrer, so anchor to execPath
  // (avoids ENOENT from process.cwd() in a deleted working directory).
  const builtinRequire = Module.createRequire(process.execPath);
  getBuiltinLibs().forEach(name => {
    if (Object.getOwnPropertyDescriptor(object, name)) {
      return;
    }

    const setReal = val => {
      // Deleting the property before re-assigning it disables the
      // getter/setter mechanism.
      delete object[name];
      object[name] = val;
    };

    Object.defineProperty(object, name, {
      __proto__: null,
      get: () => {
        const lib = builtinRequire(name);

        try {
          // Override the current getter/setter pair with the lib itself.
          delete object[name];
          Object.defineProperty(object, name, {
            __proto__: null,
            get: () => lib,
            set: setReal,
            configurable: true,
            enumerable: false,
          });
        } catch {
          // If the property is no longer configurable, ignore the error.
        }

        return lib;
      },
      set: setReal,
      configurable: true,
      enumerable: false,
    });
  });
}

// ---- internal/vm ----------------------------------------------

const vm = require("node:vm");

function makeContextifyScript(
  code,
  filename,
  lineOffset,
  columnOffset,
  cachedData,
  produceCachedData,
  parsingContext,
  hostDefinedOptionId,
  importModuleDynamically,
) {
  const script = new vm.Script(code, {
    filename,
    lineOffset,
    columnOffset,
    cachedData,
    produceCachedData,
    importModuleDynamically: importModuleDynamically ?? (specifier => import(specifier)),
  });
  // Node's vm.Script constructor throws SyntaxError eagerly; Bun's native
  // Script defers parsing to run time. The REPL's recoverable-error flow
  // depends on the eager throw, so force a parse via createCachedData and,
  // when it fails, surface the real SyntaxError by running the script in a
  // throwaway context (a parse error always fires before any code executes).
  try {
    script.createCachedData();
  } catch {
    new vm.Script(code, { filename, lineOffset, columnOffset }).runInContext(vm.createContext({}), {
      displayErrors: false,
    });
  }
  return script;
}

function runScriptInThisContext(script, displayErrors, _breakOnFirstLine) {
  return script.runInThisContext({ displayErrors });
}

// ---- internal/modules/cjs/loader (constructible Module shim) ----------------

class CJSModuleShim {
  constructor(id = "", parent = undefined) {
    this.id = id;
    this.path = "";
    this.exports = {};
    this.filename = null;
    this.loaded = false;
    this.children = [];
    this.paths = [];
    this.parent = parent;
  }

  static builtinModules = Module.builtinModules;
  static globalPaths = Module.globalPaths;
  static _extensions = Module._extensions;
  static _nodeModulePaths(from) {
    return Module._nodeModulePaths(from);
  }
  static _resolveLookupPaths(request, parent) {
    if (typeof Module._resolveLookupPaths === "function") {
      return Module._resolveLookupPaths(request, parent);
    }
    return Module._nodeModulePaths(process.cwd()).concat(Module.globalPaths ?? []);
  }
  static _resolveFilename(request, parent, isMain, options) {
    return Module._resolveFilename(request, parent, isMain, options);
  }
}

// ---- internalBinding('contextify') ----------------------------------------------

function startSigintWatchdog() {
  // Bun has no native SIGINT watchdog for vm script execution; report
  // success so breakEvalOnSigint callers proceed (Ctrl+C interruption of
  // long-running synchronous eval is not supported).
  return true;
}

function stopSigintWatchdog() {
  return false;
}

// ---- internalBinding('util') ----------------------------------------------

const ALL_PROPERTIES = 0;
const ONLY_WRITABLE = 1;
const ONLY_ENUMERABLE = 2;
const ONLY_CONFIGURABLE = 4;
const SKIP_STRINGS = 8;
const SKIP_SYMBOLS = 16;

function getOwnNonIndexProperties(obj, filter = ALL_PROPERTIES) {
  const indexRegex = /^(0|[1-9][0-9]*)$/;
  let keys = [];
  if (!(filter & SKIP_STRINGS)) {
    for (const key of Object.getOwnPropertyNames(obj)) {
      if (indexRegex.test(key)) continue;
      if (filter & ONLY_ENUMERABLE) {
        const desc = Object.getOwnPropertyDescriptor(obj, key);
        if (!desc?.enumerable) continue;
      }
      keys.push(key);
    }
  }
  if (!(filter & SKIP_SYMBOLS)) {
    for (const sym of Object.getOwnPropertySymbols(obj)) {
      if (filter & ONLY_ENUMERABLE) {
        const desc = Object.getOwnPropertyDescriptor(obj, sym);
        if (!desc?.enumerable) continue;
      }
      keys.push(sym);
    }
  }
  return keys;
}

// ---- process.addUncaughtExceptionCaptureCallback polyfill ----------------
// Bun only implements the single-callback set/clear API; emulate Node's
// additive API with a dispatcher list.

let captureCallbacks = null;

function addUncaughtExceptionCaptureCallback(cb) {
  if (!captureCallbacks) {
    captureCallbacks = [];
    try {
      process.setUncaughtExceptionCaptureCallback(err => {
        for (const fn of captureCallbacks) {
          if (fn(err)) return;
        }
        // No callback claimed the error: Node's additive API falls through to
        // the regular 'uncaughtException' flow, and only then to the fatal
        // handler.
        if (process.emit("uncaughtException", err)) return;
        try {
          process.stderr.write(`Uncaught ${util.inspect(err)}\n`);
        } catch {}
        process.exit(1);
      });
    } catch {
      // A user capture callback is already installed via the single-callback
      // API. Node's additive API coexists with it natively; without that
      // engine support, defer to the user's callback - REPL error handling
      // falls back to the regular uncaughtException flow.
    }
  }
  captureCallbacks.push(cb);
}

function removeUncaughtExceptionCaptureCallback(cb) {
  if (!captureCallbacks) return;
  const i = captureCallbacks.indexOf(cb);
  if (i !== -1) captureCallbacks.splice(i, 1);
  if (captureCallbacks.length === 0) {
    captureCallbacks = null;
    process.setUncaughtExceptionCaptureCallback(null);
  }
}

export default {
  addUncaughtExceptionCaptureCallback,
  removeUncaughtExceptionCaptureCallback,
  // internalBinding('contextify')
  startSigintWatchdog,
  stopSigintWatchdog,
  // internalBinding('util')
  constants: {
    ALL_PROPERTIES,
    ONLY_WRITABLE,
    ONLY_ENUMERABLE,
    ONLY_CONFIGURABLE,
    SKIP_STRINGS,
    SKIP_SYMBOLS,
  },
  getOwnNonIndexProperties,
  // internal/util
  SideEffectFreeRegExpPrototypeSymbolReplace,
  SideEffectFreeRegExpPrototypeSymbolSplit,
  assignFunctionName,
  decorateErrorStack,
  deprecate: util.deprecate,
  isError,
  kEmptyObject,
  promisify: util.promisify,
  // internal/util/colors
  shouldColorize,
  // internal/util/debuglog
  debuglog,
  // internal/util/inspector
  sendInspectorCommand,
  // internal/util/types
  isProxy,
  // internal/options
  getOptionValue,
  // internal/process/permission (consumed as a namespace: permission.isEnabled())
  isEnabled,
  has,
  // internal/streams/utils
  isWritable,
  // internal/events/abort_listener
  addAbortListener,
  // internal/bootstrap/realm
  BuiltinModule,
  // internal/modules/esm/get_format
  extensionFormatMap,
  // internal/modules/esm/loader
  getOrInitializeCascadedLoader,
  // internal/modules/cjs/loader
  Module: CJSModuleShim,
  // internal/modules/helpers
  addBuiltinLibsToObject,
  getBuiltinLibs,
  makeRequireFunction,
  // internal/vm
  makeContextifyScript,
  runScriptInThisContext,
};
