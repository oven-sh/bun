// Consolidated shims for Node.js internal modules consumed by the ported
// node:repl / internal/readline stack. Each export matches the name and
// calling convention of the Node internal it replaces; implementations
// delegate to Bun equivalents.
const util = require("node:util");
const Module = require("node:module");
const path = require("node:path");
const {
  ArrayPrototypeIncludes,
  ArrayPrototypeJoin,
  ArrayPrototypeMap,
  ArrayPrototypePush,
  ArrayPrototypeSlice,
  RegExpPrototypeExec,
  RegExpPrototypeSymbolReplace,
  RegExpPrototypeSymbolSplit,
  StringPrototypeIncludes,
  StringPrototypeReplace,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeStartsWith,
} = require("internal/repl/node-primordials");

// ---- internal/util ----------------------------------------------------

const { kEmptyObject } = require("internal/shared");

// Node's real implementation reconstructs the regex in an internal realm so a
// tampered `RegExp.prototype[Symbol.replace]` can't observe it. Bun has no
// internal realm; the load-time-captured intrinsics close the `[Symbol.*]`
// override hole (a tampered `RegExp.prototype.exec` is still observable per
// spec — see `@@replace`/`@@split` `Get(rx,"exec")`).
function SideEffectFreeRegExpPrototypeSymbolReplace(regexp, str, replacement) {
  return RegExpPrototypeSymbolReplace(regexp, str, replacement);
}

function SideEffectFreeRegExpPrototypeSymbolSplit(regexp, str, limit) {
  return RegExpPrototypeSymbolSplit(regexp, str, limit);
}

function decorateErrorStack(err) {
  // JSC materializes stacks eagerly so Node's overrideStackTrace never runs;
  // reproduce it by normalizing "<anonymous> (loc)" frames and cutting at the
  // last REPLn:l:c frame (drops the REPL top-level + vm runner frames).
  if (typeof err?.stack !== "string") return err;
  let lines = StringPrototypeSplit(err.stack, "\n");
  lines = ArrayPrototypeMap(lines, l => StringPrototypeReplace(l, /^(\s+at )<anonymous> \((.+)\)$/, "$1$2"));
  let anonIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (RegExpPrototypeExec(/^\s+at REPL\d*:\d+:\d+$/, lines[i]) !== null) anonIdx = i;
  }
  if (anonIdx !== -1) lines = ArrayPrototypeSlice(lines, 0, anonIdx);
  const newStack = ArrayPrototypeJoin(lines, "\n");
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
  return util.types.isNativeError(e) || e instanceof Error;
}

// ---- internal/util/colors ----------------------------------------------

const { shouldColorize } = require("internal/util/colors");

// ---- internal/util/debuglog ----------------------------------------------

function debuglog(set, cb) {
  const fn = util.debuglog(set);
  if (typeof cb === "function") cb(fn);
  return fn;
}

// ---- internal/util/inspector ----------------------------------------------

function sendInspectorCommand(cb, onError) {
  // JSC's inspector protocol has no `Runtime.globalLexicalScopeNames` (V8-only),
  // so let/const/class tab-completion in useGlobal:true mode is inert until a
  // native binding enumerates JSGlobalObject::globalLexicalEnvironment().
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

const { addAbortListener } = require("internal/abort_listener");

// ---- internal/bootstrap/realm ----------------------------------------------

const BuiltinModule = {
  getSchemeOnlyModuleNames() {
    // Bare names; completion.js prefixes them with "node:" itself. Derived
    // from the `node:`-prefixed builtinModules entries (e.g. node:sqlite);
    // `test` resolves as node:test but is missing from builtinModules.
    const names = ["test"];
    for (const id of Module.builtinModules) {
      if (!StringPrototypeStartsWith(id, "node:")) continue;
      const bare = StringPrototypeSlice(id, 5);
      if (!ArrayPrototypeIncludes(names, bare)) ArrayPrototypePush(names, bare);
    }
    return names;
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
    // Node filters slash-modules here (not in getBuiltinLibs), so
    // repl.builtinModules and require-completion still offer them.
    if (StringPrototypeIncludes(name, "/") || Object.getOwnPropertyDescriptor(object, name)) {
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
  return new vm.Script(code, {
    filename,
    lineOffset,
    columnOffset,
    cachedData,
    produceCachedData,
    importModuleDynamically: importModuleDynamically ?? (specifier => import(specifier)),
  });
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
  // breakOnSigint interruption of synchronous eval WORKS via Bun's own
  // SigintWatcher (wired in NodeVMScript.cpp). Only Node's `had_pending_
  // signals` race — SIGINT landing after the script exits but before raw mode
  // is restored — is unimplemented, so stopSigintWatchdog() always reports no
  // pending signal.
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
  const keys = [];
  if (!(filter & SKIP_STRINGS)) {
    const names = Object.getOwnPropertyNames(obj);
    for (let i = 0; i < names.length; i++) {
      const key = names[i];
      if (RegExpPrototypeExec(indexRegex, key) !== null) continue;
      if (filter & ONLY_ENUMERABLE) {
        const desc = Object.getOwnPropertyDescriptor(obj, key);
        if (!desc?.enumerable) continue;
      }
      ArrayPrototypePush(keys, key);
    }
  }
  if (!(filter & SKIP_SYMBOLS)) {
    const syms = Object.getOwnPropertySymbols(obj);
    for (let i = 0; i < syms.length; i++) {
      const sym = syms[i];
      if (filter & ONLY_ENUMERABLE) {
        const desc = Object.getOwnPropertyDescriptor(obj, sym);
        if (!desc?.enumerable) continue;
      }
      ArrayPrototypePush(keys, sym);
    }
  }
  return keys;
}

// ---- process.addUncaughtExceptionCaptureCallback polyfill ----------------
// Bun only implements the single-callback set/clear API; emulate Node's
// additive API with a dispatcher list. The shim occupies the exclusive slot
// for the process lifetime once the first REPL starts — see repl.js
// setupExceptionCapture() for the rationale.

let captureCallbacks = null;

function addUncaughtExceptionCaptureCallback(cb) {
  if (!captureCallbacks) {
    captureCallbacks = [];
    try {
      process.setUncaughtExceptionCaptureCallback(err => {
        // Indexed, not for..of: user code can delete Array.prototype[Symbol.iterator]
        // and this runs while reporting that very error, so an unsafe iteration here
        // replaces the user's exception with "{} is not iterable".
        for (let i = 0; i < captureCallbacks.length; i++) {
          if (captureCallbacks[i](err)) return;
        }
        // No callback claimed it: Node's aux API falls through to the
        // regular 'uncaughtException' flow (with the origin arg), then to
        // the native fatal handler.
        if (process.emit("uncaughtException", err, "uncaughtException")) return;
        try {
          process.stderr.write(`Uncaught ${util.inspect(err)}\n`);
        } catch {}
        process.exit(1);
      });
    } catch {
      // A user capture callback already occupies the exclusive slot. Node's
      // additive API coexists with it natively; without that engine support,
      // defer to the user's callback and don't push (the dispatcher isn't
      // wired, so a queued cb would never fire).
      return;
    }
  }
  captureCallbacks.push(cb);
}

export default {
  addUncaughtExceptionCaptureCallback,
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
