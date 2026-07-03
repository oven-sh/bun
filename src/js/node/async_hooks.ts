// Hardcoded module "node:async_hooks"
// Bun is only going to implement AsyncLocalStorage and AsyncResource (partial).
// The other functions are deprecated anyways, and would impact performance too much.
// API: https://nodejs.org/api/async_hooks.html
//
// JSC has been patched to include a special global variable $asyncContext which is set to
// a constant InternalFieldTuple<[AsyncContextData, never]>. `get` and `set` read/write to the
// first element of this tuple. Inside of PromiseOperations.js, we "snapshot" the context (store it
// in the promise reaction) and then just before we call .then, we restore it.
//
// This means context tracking is *kind-of* manual. If we receive a callback in native code
// - In Rust, call jsValue.with_async_context_if_needed(); which returns another JSValue. Store that and
//   then run .$call() on it later.
// - In C++, call AsyncContextFrame::withAsyncContextIfNeeded(jsValue). Then to call it,
//   use AsyncContextFrame:: call(...) instead of JSC:: call.
//
// The above functions will return the same JSFunction if the context is empty, and there are many
// other checks to ensure that AsyncLocalStorage has virtually no impact on performance when not in
// use. But the nature of this approach makes the implementation *itself* very low-impact on performance.
//
// AsyncContextData is an array managed in here, formatted [key, value, key, value] where each key is
// an AsyncLocalStorage object and the value is the associated value. It is copy-on-write, so that a
// captured context keeps its bindings; disable() is the one exception, see the comment there.
//
const setAsyncHooksEnabled = $newCppFunction("NodeAsyncHooks.cpp", "jsSetAsyncHooksEnabled", 1);
const cleanupLater = $newCppFunction("NodeAsyncHooks.cpp", "jsCleanupLater", 0);
const { validateFunction, validateString, validateObject } = require("internal/validators");

// Only run during debug
function assertValidAsyncContextArray(array: unknown): array is ReadonlyArray<any> | undefined {
  // undefined is OK
  if (array === undefined) return true;
  // Otherwise, it must be an array
  $assert(
    Array.isArray(array),
    "AsyncContextData must be an array or undefined, got",
    Bun.inspect(array, { depth: 1 }),
  );
  // the array has to be even
  $assert(array.length % 2 === 0, "AsyncContextData should be even-length, got", Bun.inspect(array, { depth: 1 }));
  // if it is zero-length, use undefined instead
  $assert(array.length > 0, "AsyncContextData should be undefined if empty, got", Bun.inspect(array, { depth: 1 }));
  for (var i = 0; i < array.length; i += 2) {
    $assert(
      array[i] instanceof AsyncLocalStorage,
      `Odd indexes in AsyncContextData should be an array of AsyncLocalStorage\nIndex %s was %s`,
      i,
      array[i],
    );
  }
  return true;
}

// Only run during debug
function debugFormatContextValue(value: ReadonlyArray<any> | undefined) {
  if (value === undefined) return "undefined";
  let str = "{\n";
  for (var i = 0; i < value.length; i += 2) {
    str += `  ${value[i].__id__}: typeof = ${typeof value[i + 1]}\n`;
  }
  str += "}";
  return str;
}

function get(): ReadonlyArray<any> | undefined {
  $debug("get", debugFormatContextValue($getInternalField($asyncContext, 0)));
  return $getInternalField($asyncContext, 0);
}

function set(contextValue: ReadonlyArray<any> | undefined) {
  // disable() empties its frame in place, so a context captured before it can
  // be handed back here zero-length. Everything else expects undefined instead.
  if (contextValue !== undefined && contextValue.length === 0) contextValue = undefined;
  $assert(assertValidAsyncContextArray(contextValue));
  $debug("set", debugFormatContextValue(contextValue));
  return $putInternalField($asyncContext, 0, contextValue);
}

// Storages live at even indices. A plain indexOf() would also match a storage
// that was passed as a *value*, which sits at an odd index.
function indexOfStorage(context: ReadonlyArray<any>, storage: AsyncLocalStorage): number {
  for (var i = 0, { length } = context; i < length; i += 2) {
    if (context[i] === storage) return i;
  }
  return -1;
}

// Object.is, without routing through a user-replaceable global.
function sameValue(a, b): boolean {
  if (a === b) return a !== 0 || 1 / a === 1 / b;
  return a !== a && b !== b;
}

// Copy-on-write, like node's `new AsyncContextFrame(storage, value)`: contexts
// already captured elsewhere (pending ticks, promise reactions) keep their bindings.
function bindStorage(storage: AsyncLocalStorage, value: unknown) {
  const context = get();
  if (!context) {
    set([storage, value]);
    return;
  }
  const i = indexOfStorage(context, storage);
  const clone = context.slice();
  if (i > -1) clone[i + 1] = value;
  else clone.push(storage, value);
  set(clone);
}

function unbindStorage(storage: AsyncLocalStorage) {
  const context = get();
  if (!context) return;
  const i = indexOfStorage(context, storage);
  if (i < 0) return;
  const clone = context.slice();
  clone.splice(i, 2);
  set(clone);
}

class AsyncLocalStorage {
  constructor() {
    setAsyncHooksEnabled(true);

    // In debug mode assign every AsyncLocalStorage a unique ID
    if (IS_BUN_DEVELOPMENT) {
      const uid = Math.random().toString(36).slice(2, 8);
      const source = require("bun:jsc").callerSourceOrigin();

      (this as any).__id__ = uid + "@" + require("node:path").basename(source);

      $debug("new AsyncLocalStorage uid=", (this as any).__id__, source);
    }
  }

  static bind(fn, ...args: any) {
    validateFunction(fn);
    return this.snapshot().bind(null, fn, ...args);
  }

  static snapshot() {
    var context = get();
    return (fn, ...args) => {
      var prev = get();
      set(context);
      try {
        return fn(...args);
      } finally {
        set(prev);
      }
    };
  }

  enterWith(store) {
    cleanupLater();
    bindStorage(this, store);
    $assert(sameValue(this.getStore(), store));
  }

  exit(cb, ...args) {
    return this.run(undefined, cb, ...args);
  }

  run(store_value, callback, ...args) {
    $debug("run " + (this as any).__id__);
    const context = get();
    const i = context ? indexOfStorage(context, this) : -1;
    const hasPrevious = i > -1;
    const previous_value = hasPrevious ? context![i + 1] : undefined;

    // node does not open a frame when the store is already this value, so
    // enterWith()/disable() calls the callback makes are not rolled back.
    if (sameValue(previous_value, store_value)) {
      return callback(...args);
    }

    bindStorage(this, store_value);
    $assert(sameValue(this.getStore(), store_value), "run: store_value was not set");
    try {
      return callback(...args);
    } finally {
      // The callback may have swapped or spliced the context out from under us
      // (nested run(), enterWith(), disable()), so `i` is no longer trustworthy.
      if (hasPrevious) bindStorage(this, previous_value);
      else unbindStorage(this);
    }
  }

  disable() {
    $debug("disable " + (this as any).__id__);
    // Mirrors node's AsyncContextFrame.disable(): the current context is edited
    // in place, so contexts already captured from it also drop the store.
    const context = get() as any[];
    if (!context) return;
    const i = indexOfStorage(context, this);
    if (i < 0) return;
    context.splice(i, 2);
    set(context);
  }

  getStore() {
    $debug("getStore " + (this as any).__id__);
    const context = get();
    if (!context) return;
    const i = indexOfStorage(context, this);
    if (i > -1) return context[i + 1];
  }

  // Node.js internal function. In Bun's implementation, calling this is not
  // observable from outside the AsyncLocalStorage implementation.
  _enable() {}

  // Node.js internal function. In Bun's implementation, calling this is not
  // observable from outside the AsyncLocalStorage implementation.
  _propagate(_resource, _triggerResource, _type) {}
}

if (IS_BUN_DEVELOPMENT) {
  AsyncLocalStorage.prototype[Bun.inspect.custom] = function (depth, options) {
    if (depth < 0) return `AsyncLocalStorage { ${Bun.inspect((this as any).__id__, options)} }`;
    return `AsyncLocalStorage { [${options.stylize("debug id", "special")}]: ${Bun.inspect(
      (this as any).__id__,
      options,
    )} }`;
  };
}

class AsyncResource {
  type;
  #snapshot;

  constructor(type, opts?) {
    validateString(type, "type");

    let triggerAsyncId = opts;
    if (opts != null) {
      if (typeof opts !== "number") {
        triggerAsyncId = opts.triggerAsyncId === undefined ? 1 : opts.triggerAsyncId;
      }
      if (!Number.isSafeInteger(triggerAsyncId) || triggerAsyncId < -1) {
        throw $ERR_INVALID_ASYNC_ID("triggerAsyncId", triggerAsyncId);
      }
    }
    if (hasEnabledCreateHook && type.length === 0) {
      throw $ERR_ASYNC_TYPE(type);
    }

    setAsyncHooksEnabled(true);
    this.type = type;
    this.#snapshot = get();
  }

  emitBefore() {
    return true;
  }

  emitAfter() {
    return true;
  }

  asyncId() {
    return 0;
  }

  triggerAsyncId() {
    return 0;
  }

  emitDestroy() {
    //
  }

  runInAsyncScope(fn, thisArg, ...args) {
    var prev = get();
    set(this.#snapshot);
    try {
      return fn.$apply(thisArg, args);
    } finally {
      set(prev);
    }
  }

  bind(fn, thisArg) {
    validateFunction(fn, "fn");
    return this.runInAsyncScope.bind(this, fn, thisArg ?? this);
  }

  static bind(fn, type, thisArg) {
    type = type || fn.name;
    return new AsyncResource(type || "bound-anonymous-fn").bind(fn, thisArg);
  }
}

// The rest of async_hooks is not implemented and is stubbed with no-ops and warnings.

function createWarning(message, isCreateHook?: boolean) {
  let warned = false;
  var wrapped = function (arg1?) {
    if (warned || (!Bun.env.BUN_FEATURE_FLAG_VERBOSE_WARNINGS && (warned = true))) return;

    const known_supported_modules = [
      // the following do not actually need async_hooks to work properly
      "zx/build/core.js",
      "datadog-core/src/storage/async_resource.js",
    ];
    const e = new Error().stack!;
    if (known_supported_modules.some(m => e.includes(m))) return;
    if (isCreateHook && arg1) {
      // this block is to specifically filter out react-server, which is often
      // times bundled into a framework or application. Their use defines three
      // handlers which are all TODO stubs. for more info see this comment:
      // https://github.com/oven-sh/bun/issues/13866#issuecomment-2397896065
      if (typeof arg1 === "object") {
        const { init, promiseResolve, destroy } = arg1;
        if (init && promiseResolve && destroy) {
          if (isEmptyFunction(init) && isEmptyFunction(destroy)) return;
        }
      }
    }

    warned = true;
    console.warn("[bun] Warning:", message);
  };
  return wrapped;
}

function isEmptyFunction(f: Function) {
  let str = f.toString();
  if (!str.startsWith("function()")) return false;
  str = str.slice("function()".length).trim();
  return /^{\s*}$/.test(str);
}

const createHookNotImpl = createWarning(
  "async_hooks.createHook is not implemented in Bun. Hooks can still be created but will never be called.",
  true,
);

let hasEnabledCreateHook = false;
const kHookEnabled = Symbol("kHookEnabled");
function createHook(hook) {
  validateObject(hook, "hook");
  const { init, before, after, destroy, promiseResolve } = hook;
  if (init !== undefined && typeof init !== "function") throw $ERR_ASYNC_CALLBACK("hook.init");
  if (before !== undefined && typeof before !== "function") throw $ERR_ASYNC_CALLBACK("hook.before");
  if (after !== undefined && typeof after !== "function") throw $ERR_ASYNC_CALLBACK("hook.after");
  if (destroy !== undefined && typeof destroy !== "function") throw $ERR_ASYNC_CALLBACK("hook.destroy");
  if (promiseResolve !== undefined && typeof promiseResolve !== "function")
    throw $ERR_ASYNC_CALLBACK("hook.promiseResolve");

  let enabledInit;
  return {
    enable() {
      if (init !== undefined && enabledInit === undefined) {
        // init is delivered for TickObject resources (process.nextTick);
        // other resource types are still unimplemented.
        // Per-instance wrapper: two hooks registered with the same init
        // function must stay independently removable (removal is by
        // identity, and removing the other instance's entry would reorder
        // its callback relative to unrelated hooks).
        enabledInit = (asyncId, type, triggerAsyncId, resource) => init(asyncId, type, triggerAsyncId, resource);
        require("internal/async_hooks_tick").tickInitHooks.push(enabledInit);
      }
      if (before !== undefined || after !== undefined || destroy !== undefined || promiseResolve !== undefined) {
        createHookNotImpl(hook);
      }
      hasEnabledCreateHook = true;
      if (!this[kHookEnabled]) {
        this[kHookEnabled] = true;
        require("internal/async_hooks").markHookEnabled();
      }
      return this;
    },
    disable() {
      if (enabledInit !== undefined) {
        const hooks = require("internal/async_hooks_tick").tickInitHooks;
        const idx = hooks.indexOf(enabledInit);
        if (idx !== -1) hooks.splice(idx, 1);
        enabledInit = undefined;
      }
      if (this[kHookEnabled]) {
        this[kHookEnabled] = false;
        require("internal/async_hooks").markHookDisabled();
      }
      return this;
    },
  };
}

const executionAsyncIdNotImpl = createWarning(
  "async_hooks.executionAsyncId/triggerAsyncId are not implemented in Bun. It will return 0 every time.",
);
function executionAsyncId() {
  executionAsyncIdNotImpl();
  return 0;
}

function triggerAsyncId() {
  return 0;
}

const executionAsyncResourceWarning = createWarning(
  "async_hooks.executionAsyncResource is not implemented in Bun. It returns a reference to process.stdin every time.",
);
function executionAsyncResource() {
  executionAsyncResourceWarning();
  return process.stdin;
}

const asyncWrapProviders = {
  NONE: 0,
  DIRHANDLE: 1,
  DNSCHANNEL: 2,
  ELDHISTOGRAM: 3,
  FILEHANDLE: 4,
  FILEHANDLECLOSEREQ: 5,
  FIXEDSIZEBLOBCOPY: 6,
  FSEVENTWRAP: 7,
  FSREQCALLBACK: 8,
  FSREQPROMISE: 9,
  GETADDRINFOREQWRAP: 10,
  GETNAMEINFOREQWRAP: 11,
  HEAPSNAPSHOT: 12,
  HTTP2SESSION: 13,
  HTTP2STREAM: 14,
  HTTP2PING: 15,
  HTTP2SETTINGS: 16,
  HTTPINCOMINGMESSAGE: 17,
  HTTPCLIENTREQUEST: 18,
  JSSTREAM: 19,
  JSUDPWRAP: 20,
  MESSAGEPORT: 21,
  PIPECONNECTWRAP: 22,
  PIPESERVERWRAP: 23,
  PIPEWRAP: 24,
  PROCESSWRAP: 25,
  PROMISE: 26,
  QUERYWRAP: 27,
  SHUTDOWNWRAP: 28,
  SIGNALWRAP: 29,
  STATWATCHER: 30,
  STREAMPIPE: 31,
  TCPCONNECTWRAP: 32,
  TCPSERVERWRAP: 33,
  TCPWRAP: 34,
  TTYWRAP: 35,
  UDPSENDWRAP: 36,
  UDPWRAP: 37,
  SIGINTWATCHDOG: 38,
  WORKER: 39,
  WORKERHEAPSNAPSHOT: 40,
  WRITEWRAP: 41,
  ZLIB: 42,
  CHECKPRIMEREQUEST: 43,
  PBKDF2REQUEST: 44,
  KEYPAIRGENREQUEST: 45,
  KEYGENREQUEST: 46,
  KEYEXPORTREQUEST: 47,
  CIPHERREQUEST: 48,
  DERIVEBITSREQUEST: 49,
  HASHREQUEST: 50,
  RANDOMBYTESREQUEST: 51,
  RANDOMPRIMEREQUEST: 52,
  SCRYPTREQUEST: 53,
  SIGNREQUEST: 54,
  TLSWRAP: 55,
  VERIFYREQUEST: 56,
  INSPECTORJSBINDING: 57,
};

export default {
  AsyncLocalStorage,
  createHook,
  executionAsyncId,
  triggerAsyncId,
  executionAsyncResource,
  asyncWrapProviders,
  AsyncResource,
};
