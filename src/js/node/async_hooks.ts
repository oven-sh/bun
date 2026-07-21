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
// AsyncContextData is an immutable array managed in here, formatted [key, value, key, value] where
// each key is an AsyncLocalStorage object and the value is the associated value. There are a ton of
// calls to $assert which will verify this invariant (only during bun-debug)
//
const setAsyncHooksEnabled = $newCppFunction("NodeAsyncHooks.cpp", "jsSetAsyncHooksEnabled", 1);
const hooksHub = require("internal/async_hooks_tick");
const cleanupLater = $newCppFunction("NodeAsyncHooks.cpp", "jsCleanupLater", 0);
const { validateFunction, validateString, validateObject } = require("internal/validators");
// SameValue in pure operators. Node compares stores with the primordial
// ObjectIs; capturing Object.is here would still inherit a patch applied
// before this module was lazily loaded.
function sameValue(a, b) {
  if (a === b) return a !== 0 || 1 / a === 1 / b;
  return a !== a && b !== b;
}

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
  $assert(assertValidAsyncContextArray(contextValue));
  $debug("set", debugFormatContextValue(contextValue));
  return $putInternalField($asyncContext, 0, contextValue);
}

// Node parity: dispose() is enterWith(previousStore), which on a fresh ALS
// installs [als, undefined] instead of splicing like run(). Bun's
// cleanupAsyncHooksData resets top-level next tick, so residue is bounded.
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
        return fn(...args);
      } finally {
        set(prev);
      }
    };
  }

  enterWith(store) {
    cleanupLater();
    // we must renable it when asyncLocalStorage.enterWith() is called https://nodejs.org/api/async_context.html#asynclocalstoragedisable
    this.#disabled = false;
    var context = get();
    if (!context) {
      set([this, store]);
      return;
    }
    var { length } = context;
    $assert(length > 0);
    $assert(length % 2 === 0);
    for (var i = 0; i < length; i += 2) {
      if (context[i] === this) {
        $assert(length > i + 1);
        const clone = context.slice();
        clone[i + 1] = store;
        set(clone);
        return;
      }
    }
    set(context.concat(this, store));
    $assert(sameValue(this.getStore(), store));
  }

  exit(cb, ...args) {
    return this.run(undefined, cb, ...args);
  }

  // This function is litered with $asserts to ensure that everything that
  // is assumed to be true is *actually* true.
  run(store_value, callback, ...args) {
    $debug("run " + (this as any).__id__);
    // Node short-circuits when the value is unchanged: no enterWith, no
    // finally-restore. Observable when the callback calls enterWith() —
    // the new value survives past run() (verified against Node v22/v26).
    // Not while disabled: getStore() masks the frame with #defaultValue then,
    // so a match here would skip installing store_value and let the callback
    // read the unmasked frame value instead.
    if (!this.#disabled && sameValue(this.getStore(), store_value)) {
      return callback(...args);
    }
    var context = get() as any[]; // we make sure to .slice() before mutating
    var hasPrevious = false;
    var previous_value;
    var i = 0;
    var contextWasAlreadyInit = !context;
    // we must renable it when asyncLocalStorage.run() is called https://nodejs.org/api/async_context.html#asynclocalstoragedisable
    this.#disabled = false;
    if (contextWasAlreadyInit) {
      set((context = [this, store_value]));
    } else {
      // it's safe to mutate context now that it was cloned
      context = context!.slice();
      // Scan even (key) slots only — a value slot can hold this storage when
      // another ALS stored it via enterWith/run.
      i = -1;
      for (var j = 0, len = context.length; j < len; j += 2) {
        if (context[j] === this) {
          i = j;
          break;
        }
      }
      if (i > -1) {
        hasPrevious = true;
        previous_value = context[i + 1];
        context[i + 1] = store_value;
      } else {
        i = context.length;
        context.push(this, store_value);
        $assert(i % 2 === 0);
        $assert(context.length % 2 === 0);
      }
      set(context);
    }
    $assert(i > -1, "i was not set");
    $assert(sameValue(this.getStore(), store_value), "run: store_value was not set");
    try {
      return callback(...args);
    } finally {
      // Note: early `return` will prevent `throw` above from working. I think...
      // Set AsyncContextFrame to undefined if we are out of context values.
      // Restoration is unconditional, mirroring node's `finally { enterWith(prior) }`:
      // entering a disabled storage must not leave store_value installed after run().
      {
        var context2 = get()! as any[]; // we make sure to .slice() before mutating
        if (context2 === context && contextWasAlreadyInit) {
          $assert(context2.length === 2, "context was mutated without copy");
          set(undefined);
        } else {
          // The context array can change shape during the callback (disable()
          // splices storages out), so re-locate this storage by identity
          // instead of trusting the index captured before the callback ran.
          // This mirrors node's run(), whose finally is enterWith(prior):
          // restore by value, re-adding the previous value even after a
          // disable() during the callback.
          context2 = context2 ? context2.slice() : []; // array is cloned here
          // Scan even (key) slots only — a value slot can hold this storage
          // when another ALS stored it via enterWith/run.
          let idx = -1;
          for (let j = 0, len = context2.length; j < len; j += 2) {
            if (context2[j] === this) {
              idx = j;
              break;
            }
          }
          if (idx > -1) {
            if (hasPrevious) {
              context2[idx + 1] = previous_value;
              set(context2);
            } else {
              context2.splice(idx, 2);
              $assert(context2.length % 2 === 0);
              set(context2.length ? context2 : undefined);
            }
          } else if (hasPrevious) {
            // disable() removed us mid-callback; node still restores the
            // previous value (and the storage becomes enabled again).
            this.#disabled = false;
            context2.push(this, previous_value);
            set(context2);
          } else {
            // idx===-1 && !hasPrevious: disable() removed us; Node's finally
            // is unconditionally enterWith(prior), which re-enables regardless.
            this.#disabled = false;
          }
        }
        const expectedStore = hasPrevious ? previous_value : this.#defaultValue;
        $assert(
          sameValue(this.getStore(), expectedStore),
          "run: previous_value",
          Bun.inspect(expectedStore),
          "was not restored, i see",
          this.getStore(),
        );
      }
    }
  }

  disable() {
    $debug("disable " + (this as any).__id__);
    // In this case, we actually do want to mutate the context state
    if (this.#disabled) return;
    this.#disabled = true;
    var context = get() as any[];
    if (context) {
      var { length } = context;
      for (var i = 0; i < length; i += 2) {
        if (context[i] === this) {
          context.splice(i, 2);
          set(context.length ? context : undefined);
          break;
        }
      }
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
    var context = get();
    if (context) {
      var { length } = context;
      for (var i = 0; i < length; i += 2) {
        if (context[i] === this) return context[i + 1];
      }
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

// GC-tracked destroy: an undestroyed resource emits destroy when collected.
// The record's flag lets emitDestroy() suppress the GC emission, and the hook
// count is re-checked at emit time so disabled hooks stop GC destroys.
const destroyRegistry = new FinalizationRegistry((rec: any) => {
  if (!rec.destroyed && hooksHub.destroyHooks.length !== 0) {
    rec.destroyed = true;
    hooksHub.queueDestroy(rec.asyncId);
  }
});

class AsyncResource {
  type;
  #snapshot;
  #asyncId;
  #triggerAsyncId;
  #destroyRec = null;

  constructor(type, opts?) {
    validateString(type, "type");

    let requireManualDestroy = false;
    // Node defaults to getDefaultTriggerAsyncId(), the current execution
    // async id.
    let triggerAsyncId;
    if (typeof opts === "number") {
      triggerAsyncId = opts;
    } else {
      triggerAsyncId = opts?.triggerAsyncId === undefined ? hooksHub.state.exec : opts.triggerAsyncId;
      requireManualDestroy = !!opts?.requireManualDestroy;
    }
    if (!Number.isSafeInteger(triggerAsyncId) || triggerAsyncId < -1) {
      throw $ERR_INVALID_ASYNC_ID("triggerAsyncId", triggerAsyncId);
    }
    // node throws only while init hooks are enabled (verified on v26.3.0:
    // a destroy-only hook does not make the empty type throw).
    if (type.length === 0 && hooksHub.initHooks.length !== 0) {
      throw $ERR_ASYNC_TYPE(type);
    }

    setAsyncHooksEnabled(true);
    this.type = type;
    this.#snapshot = get();
    this.#asyncId = hooksHub.newAsyncId();
    this.#triggerAsyncId = triggerAsyncId;
    if (hooksHub.initHooks.length !== 0) {
      hooksHub.emitInit(this.#asyncId, type, triggerAsyncId, this);
    }
    if (!requireManualDestroy && hooksHub.destroyHooks.length !== 0) {
      const rec = { asyncId: this.#asyncId, destroyed: false };
      this.#destroyRec = rec;
      destroyRegistry.register(this, rec, rec);
    }
  }

  emitBefore() {
    return true;
  }

  emitAfter() {
    return true;
  }

  asyncId() {
    return this.#asyncId;
  }

  triggerAsyncId() {
    return this.#triggerAsyncId;
  }

  emitDestroy() {
    const rec = this.#destroyRec;
    if (rec !== null) {
      // Suppress the GC emission; a second *manual* emitDestroy still
      // re-emits (node fires destroy again, no throw).
      rec.destroyed = true;
      destroyRegistry.unregister(rec);
      this.#destroyRec = null;
    }
    if (hooksHub.destroyHooks.length !== 0) {
      hooksHub.queueDestroy(this.#asyncId);
    }
    return this;
  }

  runInAsyncScope(fn, thisArg, ...args) {
    var prev = get();
    set(this.#snapshot);
    const state = hooksHub.state;
    const asyncId = this.#asyncId;
    const prevExec = state.exec;
    const prevTrigger = state.trigger;
    state.exec = asyncId;
    state.trigger = this.#triggerAsyncId;
    if (hooksHub.beforeHooks.length !== 0) hooksHub.emitBefore(asyncId);
    try {
      return fn.$apply(thisArg, args);
    } finally {
      if (hooksHub.afterHooks.length !== 0) hooksHub.emitAfter(asyncId);
      state.exec = prevExec;
      state.trigger = prevTrigger;
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
  "async_hooks.createHook in Bun does not emit events for promises; promiseResolve hooks are never called.",
  true,
);

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

  // Per-instance wrappers: two hooks registered with the same callback must
  // stay independently removable (removal is by identity).
  let registered;
  return {
    enable() {
      if (this[kHookEnabled]) return this;
      this[kHookEnabled] = true;
      registered = [];
      if (init !== undefined) {
        const wrapper = (asyncId, type, triggerAsyncId, resource) => init(asyncId, type, triggerAsyncId, resource);
        hooksHub.initHooks.push(wrapper);
        registered.push(hooksHub.initHooks, wrapper);
      }
      if (before !== undefined) {
        const wrapper = asyncId => before(asyncId);
        hooksHub.beforeHooks.push(wrapper);
        registered.push(hooksHub.beforeHooks, wrapper);
      }
      if (after !== undefined) {
        const wrapper = asyncId => after(asyncId);
        hooksHub.afterHooks.push(wrapper);
        registered.push(hooksHub.afterHooks, wrapper);
      }
      if (destroy !== undefined) {
        const wrapper = asyncId => destroy(asyncId);
        hooksHub.destroyHooks.push(wrapper);
        registered.push(hooksHub.destroyHooks, wrapper);
      }
      if (promiseResolve !== undefined) {
        createHookNotImpl(hook);
      }
      hooksHub.enableTracking();
      require("internal/async_hooks").markHookEnabled();
      return this;
    },
    disable() {
      if (!this[kHookEnabled]) return this;
      this[kHookEnabled] = false;
      for (let i = 0; i < registered.length; i += 2) {
        const hooks = registered[i];
        const idx = hooks.indexOf(registered[i + 1]);
        if (idx !== -1) hooks.splice(idx, 1);
      }
      registered = undefined;
      require("internal/async_hooks").markHookDisabled();
      return this;
    },
  };
}

// Ids advance for TickObject, Immediate, Timeout, AsyncResource and wrapped
// request callbacks; promise reactions do not push their own frame yet.
function executionAsyncId() {
  hooksHub.enableTracking();
  return hooksHub.state.exec;
}

function triggerAsyncId() {
  hooksHub.enableTracking();
  return hooksHub.state.trigger;
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
