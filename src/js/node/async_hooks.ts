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
// AsyncContextData is the innermost Frame of a persistent linked list managed in
// here: each Frame binds one AsyncLocalStorage to a value and points at the frame
// it was pushed onto, so run() allocates one three-field object and never copies,
// getStore() walks the (short) chain, and a captured context is a single
// reference that shares its tail with every other capture.
//
const setAsyncHooksEnabled = $newCppFunction("NodeAsyncHooks.cpp", "jsSetAsyncHooksEnabled", 1);
const { validateFunction, validateString, validateObject } = require("internal/validators");
// SameValue in pure operators. Node compares stores with the primordial
// ObjectIs; capturing Object.is here would still inherit a patch applied
// before this module was lazily loaded.
function sameValue(a, b) {
  if (a === b) return a !== 0 || 1 / a === 1 / b;
  return a !== a && b !== b;
}

class Frame {
  storage: AsyncLocalStorage | undefined; // undefined once disable() has exited it
  value: unknown;
  prev: Frame | undefined;
  constructor(storage: AsyncLocalStorage, value: unknown, prev: Frame | undefined) {
    this.storage = storage;
    this.value = value;
    this.prev = prev;
  }
}

// Only run during debug
function assertValidFrame(frame: unknown): boolean {
  for (var f = frame, n = 0; f !== undefined; f = (f as Frame).prev, n++) {
    $assert(f instanceof Frame, "AsyncContextData must be a Frame chain or undefined, got", f);
    $assert(
      (f as Frame).storage === undefined || (f as Frame).storage instanceof AsyncLocalStorage,
      "Frame.storage must be an AsyncLocalStorage",
    );
    $assert(n < 10000, "AsyncContextData chain is unreasonably long (cycle?)");
  }
  return true;
}

// Only run during debug
function debugFormatContextValue(frame: Frame | undefined) {
  if (frame === undefined) return "undefined";
  let str = "{";
  for (var f: Frame | undefined = frame; f !== undefined; f = f.prev) {
    str += ` ${f.storage ? (f.storage as any).__id__ : "<exited>"}: ${typeof f.value};`;
  }
  return str + " }";
}

// Bumped whenever disable() exits a frame in place, so run() can tell that the
// chain it installed changed under it even though its identity did not.
let frameMutations = 0;

function get(): Frame | undefined {
  $debug("get", debugFormatContextValue($getInternalField($asyncContext, 0)));
  return $getInternalField($asyncContext, 0);
}

function set(frame: Frame | undefined) {
  $assert(assertValidFrame(frame));
  $debug("set", debugFormatContextValue(frame));
  return $putInternalField($asyncContext, 0, frame);
}

// The innermost frame binding `storage`, or undefined.
function find(frame: Frame | undefined, storage: AsyncLocalStorage): Frame | undefined {
  for (var f = frame; f !== undefined; f = f.prev) {
    if (f.storage === storage) return f;
  }
  return undefined;
}

// `frame` with the innermost binding of `storage` removed. Frames above it are
// copied (they are immutable and may be shared); the tail below it is shared.
function without(frame: Frame | undefined, storage: AsyncLocalStorage): Frame | undefined {
  var found = find(frame, storage);
  if (found === undefined) return frame;
  return copyUntil(frame!, found, found.prev);
}

function copyUntil(from: Frame, stop: Frame, tail: Frame | undefined): Frame | undefined {
  if (from === stop) return tail;
  return new Frame(from.storage!, from.value, copyUntil(from.prev!, stop, tail));
}

// Node parity: dispose() is enterWith(previousStore), which on a fresh ALS
// leaves a binding to undefined rather than removing it like run(). Like any
// enterWith() residue, it is dropped at the next top-level checkpoint.
class RunScope {
  #storage;
  #previousStore;
  #disposed = false;

  constructor(storage, store) {
    this.#storage = storage;
    this.#previousStore = storage.getStore();
    storage.enterWith(store);
  }

  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#storage.enterWith(this.#previousStore);
  }

  [Symbol.dispose]() {
    this.dispose();
  }
}

class AsyncLocalStorage {
  #disabled = false;
  #defaultValue = undefined;
  #name = undefined;

  constructor(options) {
    if (options !== undefined) {
      validateObject(options, "options");
      this.#defaultValue = options.defaultValue;
      const name = options.name;
      if (name !== undefined) {
        this.#name = `${name}`;
      }
    }
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
        return fn.$apply(undefined, args);
      } finally {
        set(prev);
      }
    };
  }

  enterWith(store) {
    // we must renable it when asyncLocalStorage.enterWith() is called https://nodejs.org/api/async_context.html#asynclocalstoragedisable
    this.#disabled = false;
    // Replace rather than shadow an existing binding so repeated enterWith() calls
    // keep the chain bounded by the number of storages.
    set(new Frame(this, store, without(get(), this)));
    $assert(sameValue(this.getStore(), store));
  }

  exit(cb, ...args) {
    return this.run(undefined, cb, ...args);
  }

  run(store_value, callback, ...args) {
    $debug("run " + (this as any).__id__);
    // Node short-circuits when the value is unchanged: no enterWith, no
    // finally-restore. Observable when the callback calls enterWith() —
    // the new value survives past run() (verified against Node v22/v26).
    // Not while disabled: getStore() masks the frame with #defaultValue then,
    // so a match here would skip installing store_value and let the callback
    // read the unmasked frame value instead.
    if (!this.#disabled && sameValue(this.getStore(), store_value)) {
      return callback.$apply(undefined, args);
    }
    // we must renable it when asyncLocalStorage.run() is called https://nodejs.org/api/async_context.html#asynclocalstoragedisable
    this.#disabled = false;
    var prior = get();
    var mutations = frameMutations;
    // Shadows any outer binding of this storage: lookups stop at the innermost.
    var frame = new Frame(this, store_value, prior);
    set(frame);
    try {
      // $apply, not a spread: spreading goes through Array.prototype[Symbol.iterator],
      // which userland can delete (node uses ReflectApply here for the same reason).
      return callback.$apply(undefined, args);
    } finally {
      if (get() === frame && mutations === frameMutations) {
        set(prior);
      } else {
        // enterWith()/disable() ran inside the callback. Node's finally is
        // enterWith(prior value): keep whatever else the callback installed and
        // restore only this storage's binding, re-enabling the storage.
        this.#disabled = false;
        var before = find(prior, this);
        var current = without(get(), this);
        set(before !== undefined ? new Frame(this, before.value, current) : current);
      }
      $assert(
        sameValue(this.getStore(), find(prior, this) !== undefined ? find(prior, this)!.value : this.#defaultValue),
        "run: previous value was not restored",
      );
    }
  }

  disable() {
    $debug("disable " + (this as any).__id__);
    if (this.#disabled) return;
    this.#disabled = true;
    // Exit the binding in place, so continuations that captured this frame lose
    // it too (Node deletes from the shared frame object).
    var found = find(get(), this);
    if (found !== undefined) {
      found.storage = undefined;
      frameMutations++;
    }
  }

  get name() {
    return this.#name || "";
  }

  getStore() {
    $debug("getStore " + (this as any).__id__);
    // Node v26: both ALS impls return #defaultValue after disable() — the
    // frame impl has no disabled flag; the legacy impl's not-enabled branch
    // is `return this.#defaultValue`.
    if (this.#disabled) return this.#defaultValue;
    for (var f = get(); f !== undefined; f = f.prev) {
      if (f.storage === this) return f.value;
    }
    return this.#defaultValue;
  }

  withScope(store) {
    return new RunScope(this, store);
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
  #triggerAsyncId;

  constructor(type, opts?) {
    validateString(type, "type");

    // Node defaults to getDefaultTriggerAsyncId() (the current execution async
    // id); Bun does not track async ids, so its executionAsyncId() is 0.
    let triggerAsyncId = typeof opts === "number" ? opts : opts?.triggerAsyncId === undefined ? 0 : opts.triggerAsyncId;
    if (!Number.isSafeInteger(triggerAsyncId) || triggerAsyncId < -1) {
      throw $ERR_INVALID_ASYNC_ID("triggerAsyncId", triggerAsyncId);
    }
    if (hasEnabledCreateHook && type.length === 0) {
      throw $ERR_ASYNC_TYPE(type);
    }

    setAsyncHooksEnabled(true);
    this.type = type;
    this.#snapshot = get();
    this.#triggerAsyncId = triggerAsyncId;
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
    return this.#triggerAsyncId;
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
    let bound;
    if (thisArg === undefined) {
      const resource = this;
      bound = function (this: unknown, ...args) {
        return resource.runInAsyncScope(fn, this, ...args);
      };
    } else {
      bound = this.runInAsyncScope.bind(this, fn, thisArg);
    }
    Object.defineProperties(bound, {
      length: {
        __proto__: null,
        configurable: true,
        enumerable: false,
        value: fn.length,
        writable: false,
      },
    });
    return bound;
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
