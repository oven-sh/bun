// Consolidated shims for Node.js internal modules consumed by the ported
// node:repl / internal/readline stack. Each export matches the name and
// calling convention of the Node internal it replaces; implementations
// delegate to Bun equivalents.
const util = require("node:util");
const Module = require("node:module");
const path = require("node:path");
const {
  ArrayIsArray,
  ArrayPrototypeIncludes,
  ArrayPrototypeJoin,
  ArrayPrototypeMap,
  ArrayPrototypePush,
  ArrayPrototypeSlice,
  ObjectDefineProperty,
  ObjectGetPrototypeOf,
  ObjectKeys,
  ReflectApply,
  SafeMap,
  SafeSet,
  SafeWeakMap,
  RegExpPrototypeExec,
  RegExpPrototypeSymbolReplace,
  RegExpPrototypeSymbolSplit,
  StringPrototypeIncludes,
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
  lines = ArrayPrototypeMap(lines, l => RegExpPrototypeSymbolReplace(/^(\s+at )<anonymous> \((.+)\)$/, l, "$1$2"));
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
//
// Node's sendInspectorCommand opens a V8 inspector session; REPL previews rely
// on `Runtime.evaluate` with `throwOnSideEffect: true`. JSC has no side-effect-
// checking evaluator, so this shim emulates the session: expressions are vetted
// statically (acorn AST allowlist, fail-closed — unvetted input is never
// evaluated) and only then run in the REPL's vm context. Unlike V8's dynamic
// check the vet goes by callee name/shape, so a preview can invoke a user
// function bound to an allowlisted name (`Array = f` then typing `Array(1)`).

// Lazy: don't destructure — see internal/repl/acorn.js.
const acorn = require("internal/repl/acorn");

const { globalLexicalScopeNames } = $cpp("NodeVM.cpp", "Bun::createNodeVMBinding");

// Globals whose direct call cannot mutate pre-existing state (constructors of
// fresh objects, pure conversions/parsers). Mirrors the spirit of V8's
// debug-evaluate allowlist (v8/src/debug/debug-evaluate.cc).
const kSafeGlobalCallees = new SafeSet([
  "Array", "ArrayBuffer", "BigInt", "Boolean", "Date", "Error", "EvalError", "Map", "Number", "Object",
  "RangeError", "ReferenceError", "RegExp", "Set", "String", "Symbol", "SyntaxError", "TypeError", "URIError",
  "AggregateError", "WeakMap", "WeakSet", "Proxy",
  "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent", "escape", "unescape",
  "isFinite", "isNaN", "parseFloat", "parseInt",
]);

// Method names that do not mutate their receiver or arguments.
const kSafeMethodNames = new SafeSet([
  // Object / Reflect statics + Object.prototype
  "create", "entries", "fromEntries", "getOwnPropertyDescriptor", "getOwnPropertyDescriptors",
  "getOwnPropertyNames", "getOwnPropertySymbols", "getPrototypeOf", "is", "isExtensible", "isFrozen",
  "isSealed", "keys", "values", "has", "hasOwn", "ownKeys", "get", "hasOwnProperty", "isPrototypeOf",
  "propertyIsEnumerable",
  // Array reads
  "isArray", "of", "from", "at", "concat", "every", "filter", "find", "findIndex", "findLast",
  "findLastIndex", "flat", "flatMap", "forEach", "includes", "indexOf", "join", "lastIndexOf", "map",
  "reduce", "reduceRight", "slice", "some", "toReversed", "toSorted", "toSpliced", "with",
  // String reads
  "charAt", "charCodeAt", "codePointAt", "endsWith", "localeCompare", "match", "matchAll", "normalize",
  "padEnd", "padStart", "repeat", "replace", "replaceAll", "search", "split", "startsWith", "substring",
  "toLowerCase", "toUpperCase", "trim", "trimEnd", "trimStart", "valueOf", "toString",
  // Number
  "toFixed", "toPrecision", "toExponential", "isInteger", "isSafeInteger",
  // Math
  "abs", "ceil", "floor", "round", "trunc", "sign", "sqrt", "cbrt", "min", "max", "pow", "exp", "log",
  "log2", "log10", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "hypot", "fround", "clz32", "imul",
  // JSON
  "parse", "stringify",
  // Date reads
  "getTime", "getDate", "getDay", "getFullYear", "getHours", "getMilliseconds", "getMinutes", "getMonth",
  "getSeconds", "getTimezoneOffset", "getUTCDate", "getUTCDay", "getUTCFullYear", "getUTCHours",
  "getUTCMilliseconds", "getUTCMinutes", "getUTCMonth", "getUTCSeconds", "toISOString", "toJSON",
]);

// Mutating methods, allowed only when the receiver is provably allocated by the
// expression itself (V8 tracks this dynamically; `Array(100).fill(1)` must
// preview but `existing.fill(1)` must not).
const kFreshOnlyMethodNames = new SafeSet(["fill", "push", "unshift", "sort", "reverse", "copyWithin", "add", "set"]);

function isFreshAllocation(node) {
  switch (node.type) {
    case "ArrayExpression":
    case "ObjectExpression":
    case "NewExpression":
    case "TemplateLiteral":
    case "Literal":
      return true;
    case "CallExpression":
      // Only direct constructor-style calls (`Array(100)`) are known-fresh.
      return node.callee.type === "Identifier" && kSafeGlobalCallees.has(node.callee.name);
    default:
      return false;
  }
}

function memberCallName(callee) {
  if (callee.computed) {
    return callee.property.type === "Literal" && typeof callee.property.value === "string"
      ? callee.property.value
      : null;
  }
  return callee.property.type === "Identifier" ? callee.property.name : null;
}

function calleeAllowed(callee) {
  if (callee.type === "ChainExpression") callee = callee.expression;
  switch (callee.type) {
    case "Literal":
    case "TemplateLiteral":
    case "ArrayExpression":
    case "ObjectExpression":
      // Calling a non-function throws TypeError before any side effect runs.
      return true;
    case "Identifier":
      return kSafeGlobalCallees.has(callee.name);
    case "MemberExpression": {
      const name = memberCallName(callee);
      if (name === null) return false;
      if (kSafeMethodNames.has(name)) return true;
      return kFreshOnlyMethodNames.has(name) && isFreshAllocation(callee.object);
    }
  }
  return false;
}

function nodeAllowed(node, inFunction) {
  switch (node.type) {
    case "UnaryExpression":
      if (node.operator === "delete") return false;
      break;
    case "CallExpression":
    case "NewExpression":
      if (!calleeAllowed(node.callee)) return false;
      break;
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      // Definition alone is inert; the body still gets walked in case an
      // allowlisted higher-order call (e.g. `.map`) invokes it.
      inFunction = true;
      break;
    case "ReturnStatement":
    case "IfStatement":
    case "VariableDeclaration":
    case "VariableDeclarator":
      // Locals only: a top-level declaration creates a context binding.
      if (!inFunction) return false;
      break;
    case "Program":
    case "ExpressionStatement":
    case "EmptyStatement":
    case "BlockStatement":
    case "LabeledStatement":
    case "ThrowStatement":
    case "SequenceExpression":
    case "ConditionalExpression":
    case "LogicalExpression":
    case "BinaryExpression":
    case "Literal":
    case "Identifier":
    case "TemplateLiteral":
    case "TemplateElement":
    case "ArrayExpression":
    case "ObjectExpression":
    case "Property":
    case "SpreadElement":
    case "MemberExpression":
    case "ChainExpression":
      break;
    default:
      return false;
  }
  return childrenAllowed(node, inFunction);
}

function childrenAllowed(node, inFunction) {
  const keys = ObjectKeys(node);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key === "type" || key === "start" || key === "end") continue;
    const value = node[key];
    if (ArrayIsArray(value)) {
      for (let j = 0; j < value.length; j++) {
        const el = value[j];
        // Elisions in array literals are null entries.
        if (el !== null && typeof el === "object" && typeof el.type === "string" && !nodeAllowed(el, inFunction)) {
          return false;
        }
      }
    } else if (value !== null && typeof value === "object" && typeof value.type === "string") {
      if (!nodeAllowed(value, inFunction)) return false;
    }
  }
  return true;
}

// Top-level declarations and module syntax can never preview; rejecting them
// by keyword skips an acorn parse per keystroke (previews re-vet the line on
// every keypress, and this path dominated a debug-build profile).
const kDeclarationStartRegExp = /^\s*(?:const|let|var|class|function|import|export)\b/;

// true: safe to evaluate; false: possible side effect; null: does not parse.
function vetPreviewExpression(code) {
  if (RegExpPrototypeExec(kDeclarationStartRegExp, code) !== null) return false;
  let ast;
  try {
    ast = acorn.Parser.parse(code, { ecmaVersion: "latest" });
  } catch {
    return null;
  }
  return nodeAllowed(ast, false);
}

function remoteClassName(value) {
  if (typeof value === "function") return "Function";
  try {
    const ctor = ObjectGetPrototypeOf(value)?.constructor;
    const name = ctor?.name;
    if (typeof name === "string" && name !== "") return name;
  } catch {}
  return "Object";
}

// The inspector protocol's ids are opaque to internal/repl/utils.js, so the
// context "id" is the vm context object itself and the objectId carries the
// value plus its context — no registry to leak or invalidate.
function toRemoteObject(value, ctx) {
  switch (typeof value) {
    case "undefined":
      return { type: "undefined" };
    case "boolean":
    case "string":
      return { type: typeof value, value };
    case "number":
      if (value !== value || value === Infinity || value === -Infinity || (value === 0 && 1 / value < 0)) {
        return { type: "number", unserializableValue: value === 0 ? "-0" : `${value}` };
      }
      return { type: "number", value };
    case "bigint":
      return { type: "bigint", unserializableValue: `${value}n` };
  }
  if (value === null) return { type: "object", subtype: "null", value: null };
  return { type: typeof value, className: remoteClassName(value), objectId: { value, ctx } };
}

// No `timeout` option: JSC's Watchdog asserts on the REPL's re-entrant use
// (preview evaluation runs inside completer callbacks), and the static vet
// already rejects unbounded top-level constructs.
function runPreviewCode(code, ctx) {
  const options = { displayErrors: false };
  return ctx === undefined ? vm.runInThisContext(code, options) : vm.runInContext(code, ctx, options);
}

function runtimeEvaluate(params, callback) {
  const ctx = params.contextId;
  if (params.throwOnSideEffect) {
    const verdict = vetPreviewExpression(params.expression);
    if (verdict === null) {
      callback(null, { result: { type: "object", className: "SyntaxError" }, exceptionDetails: {} });
      return;
    }
    if (!verdict) {
      callback(null, {
        result: { type: "object", className: "EvalError" },
        exceptionDetails: { text: "Possible side-effect in debug-evaluate" },
      });
      return;
    }
  }
  let value;
  try {
    value = runPreviewCode(params.expression, ctx);
  } catch (err) {
    callback(null, { result: toRemoteObject(err, ctx), exceptionDetails: {} });
    return;
  }
  callback(null, { result: toRemoteObject(value, ctx) });
}

// The preview's inspect callback arrives as the same functionDeclaration text
// on every keystroke; cache the compiled function per context.
const compiledFunctionCaches = new SafeWeakMap();
const kNoContext = { __proto__: null };

function compileFunctionOn(declaration, ctx) {
  const cacheKey = ctx === undefined ? kNoContext : ctx;
  let cache = compiledFunctionCaches.get(cacheKey);
  if (cache === undefined) {
    cache = new SafeMap();
    compiledFunctionCaches.set(cacheKey, cache);
  }
  let fn = cache.get(declaration);
  if (fn === undefined) {
    fn = runPreviewCode(`(${declaration})`, ctx);
    cache.set(declaration, fn);
  }
  return fn;
}

function runtimeCallFunctionOn(params, callback) {
  const objectId = params.objectId;
  const ctx = objectId?.ctx;
  try {
    const fn = compileFunctionOn(params.functionDeclaration, ctx);
    const args = [];
    const callArgs = params.arguments;
    if (callArgs) {
      for (let i = 0; i < callArgs.length; i++) {
        const arg = callArgs[i];
        ArrayPrototypePush(args, arg != null && arg.objectId !== undefined ? arg.objectId.value : arg?.value);
      }
    }
    const result = ReflectApply(fn, undefined, args);
    callback(null, { result: toRemoteObject(result, ctx) });
  } catch (err) {
    callback(null, { result: toRemoteObject(err, ctx), exceptionDetails: {} });
  }
}

class InspectorSession {
  #onceHandlers = { __proto__: null };

  once(event, handler) {
    const existing = this.#onceHandlers[event];
    if (existing === undefined) this.#onceHandlers[event] = [handler];
    else ArrayPrototypePush(existing, handler);
  }

  // Not part of Node's inspector.Session: JSC's inspector does not observe
  // vm.createContext, so repl.js reports the new context here and the session
  // echoes the executionContextCreated event Runtime.enable would produce.
  contextCreated(context) {
    const handlers = this.#onceHandlers["Runtime.executionContextCreated"];
    if (handlers === undefined) return;
    this.#onceHandlers["Runtime.executionContextCreated"] = undefined;
    const message = { params: { context: { id: context, origin: "", name: "<repl>" } } };
    for (let i = 0; i < handlers.length; i++) handlers[i](message);
  }

  // Callbacks fire synchronously: internal/repl/utils.js's double-eval of
  // `{`-wrapped input relies on the first response landing before its
  // `if (wrapped)` re-dispatch check.
  post(method, params, callback) {
    if (typeof params === "function") {
      callback = params;
      params = undefined;
    }
    switch (method) {
      case "Runtime.enable":
      case "Runtime.disable":
        callback?.(null, {});
        return;
      case "Runtime.evaluate":
        runtimeEvaluate(params, callback);
        return;
      case "Runtime.callFunctionOn":
        runtimeCallFunctionOn(params, callback);
        return;
      case "Runtime.globalLexicalScopeNames":
        callback?.(null, { names: globalLexicalScopeNames(params?.executionContextId) });
        return;
      default:
        callback?.(new Error(`Unsupported inspector method: ${method}`));
    }
  }
}

function sendInspectorCommand(cb, onError) {
  return cb(new InspectorSession());
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
    // Indexed, not for..of: user code can delete Array.prototype[Symbol.iterator].
    const modules = Module.builtinModules;
    for (let i = 0; i < modules.length; i++) {
      const id = modules[i];
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
  const anchor = path.join(cwd, "<repl>");
  const boundRequire = Module.createRequire(anchor);
  // Bun's resolver throws a ResolveMessage; Node's loader throws a plain Error
  // with the "Require stack" message, `code`, and `requireStack` — user code
  // (and test-repl-require) matches on that exact shape. Only reshape failures
  // whose referrer is the REPL itself: a miss inside a required module keeps
  // its own (accurate) referrer message.
  // Not named `require`: the builtin bundler rewrites `require(` tokens.
  function replRequire(id) {
    try {
      return boundRequire(id);
    } catch (err) {
      if (err?.code === "MODULE_NOT_FOUND" && typeof err.specifier === "string" && err.referrer === anchor) {
        const nodeError = new Error(`Cannot find module '${err.specifier}'\nRequire stack:\n- <repl>`);
        nodeError.code = "MODULE_NOT_FOUND";
        nodeError.requireStack = ["<repl>"];
        throw nodeError;
      }
      throw err;
    }
  }
  ObjectDefineProperty(replRequire, "name", { __proto__: null, value: "require", configurable: true });
  replRequire.resolve = boundRequire.resolve;
  replRequire.cache = boundRequire.cache;
  replRequire.extensions = boundRequire.extensions;
  replRequire.main = boundRequire.main;
  return replRequire;
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
// node:domain needs the same stacking behaviour, so the dispatcher lives in
// a shared module both can install into.

const { addUncaughtExceptionCaptureCallback } = require("internal/uncaught_exception_capture");

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
