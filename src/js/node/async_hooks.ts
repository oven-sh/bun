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
// - In Zig, call jsValue.withAsyncContextIfNeeded(); which returns another JSValue. Store that and
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
  $assert(assertValidAsyncContextArray(contextValue));
  $debug("set", debugFormatContextValue(contextValue));
  return $putInternalField($asyncContext, 0, contextValue);
}

class AsyncLocalStorage {
  #disabled = false;

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
    $assert(this.getStore() === store);
  }

  exit(cb, ...args) {
    return this.run(undefined, cb, ...args);
  }

  // This function is litered with $asserts to ensure that everything that
  // is assumed to be true is *actually* true.
  run(store_value, callback, ...args) {
    $debug("run " + (this as any).__id__);
    var context = get() as any[]; // we make sure to .slice() before mutating
    var hasPrevious = false;
    var previous_value;
    var i = 0;
    var contextWasAlreadyInit = !context;
    // we must renable it when asyncLocalStorage.run() is called https://nodejs.org/api/async_context.html#asynclocalstoragedisable
    const wasDisabled = this.#disabled;
    this.#disabled = false;
    if (contextWasAlreadyInit) {
      set((context = [this, store_value]));
    } else {
      // it's safe to mutate context now that it was cloned
      context = context!.slice();
      i = context.indexOf(this);
      if (i > -1) {
        $assert(i % 2 === 0);
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
    $assert(this.getStore() === store_value, "run: store_value was not set");
    try {
      return callback(...args);
    } finally {
      // Note: early `return` will prevent `throw` above from working. I think...
      // Set AsyncContextFrame to undefined if we are out of context values
      if (!wasDisabled) {
        var context2 = get()! as any[]; // we make sure to .slice() before mutating
        if (context2 === context && contextWasAlreadyInit) {
          $assert(context2.length === 2, "context was mutated without copy");
          set(undefined);
        } else {
          context2 = context2.slice(); // array is cloned here
          $assert(context2[i] === this);
          if (hasPrevious) {
            context2[i + 1] = previous_value;
            set(context2);
          } else {
            // i wonder if this is a fair assert to make
            context2.splice(i, 2);
            $assert(context2.length % 2 === 0);
            set(context2.length ? context2 : undefined);
          }
        }
        $assert(
          this.getStore() === previous_value,
          "run: previous_value",
          Bun.inspect(previous_value),
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

  getStore() {
    $debug("getStore " + (this as any).__id__);
    // disabled AsyncLocalStorage always returns undefined https://nodejs.org/api/async_context.html#asynclocalstoragedisable
    if (this.#disabled) return;
    var context = get();
    if (!context) return;
    var { length } = context;
    for (var i = 0; i < length; i += 2) {
      if (context[i] === this) return context[i + 1];
    }
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

const createHookPartialWarning = createWarning(
  "async_hooks.createHook is partially implemented in Bun. Lifecycle hooks only fire for timers (setTimeout/setInterval/setImmediate).",
  true,
);

// ─── createHook: partial implementation ──────────────────────────────────────
// Bun's `createHook` has been historically stubbed because firing init/before/
// after/destroy for every async resource (promises, I/O, etc.) would require
// instrumenting every hot path in the runtime. This partial implementation
// covers the common case of timers by monkey-patching `globalThis.{set,clear}`
// `{Timeout,Interval,Immediate}` once any hook is enabled. When no user hook is
// active, the globals are untouched and the overhead is zero.
//
// See https://github.com/oven-sh/bun/issues/30827.

type AsyncHookCallbacks = {
  init?: (asyncId: number, type: string, triggerAsyncId: number, resource: any) => void;
  before?: (asyncId: number) => void;
  after?: (asyncId: number) => void;
  destroy?: (asyncId: number) => void;
  promiseResolve?: (asyncId: number) => void;
};

let hasEnabledCreateHook = false;
const activeHooks: AsyncHookCallbacks[] = [];
let timerGlobalsPatched = false;
let nextAsyncId = 2; // 1 is reserved for the root execution context (matches Node).
const kAsyncId = Symbol("bun.asyncId");
const kDestroyed = Symbol("bun.asyncHooksDestroyed");
// Distinguishes Timeout handles from Immediate handles so mismatched
// cancellation (clearTimeout on an Immediate, clearImmediate on a
// Timeout/Interval) is a no-op — matches Node, which keeps the two APIs
// strictly paired even though both return opaque objects.
const kTimerKind = Symbol("bun.asyncHooksTimerKind");

// Tracks the current `executionAsyncId()` while inside a before/after pair so
// observers can correlate resources. Trigger IDs fall back to the outer scope
// at `init()` time. Default is 0 (matching `AsyncResource.prototype.asyncId()`
// which is currently a stub that also returns 0) — Node uses 1 for the root
// context but `AsyncResource.asyncId() === executionAsyncId()` is a real
// invariant (see `test-async-hooks-recursive-stack-runInAsyncScope.js`), so
// we keep both sides at 0 at the root until `AsyncResource` is wired up.
let currentExecutionAsyncId = 0;
let currentTriggerAsyncId = 0;

// A pending-destroy queue flushed on nextTick — matches Node's batching so
// the destroy callback is observed after any synchronous init/before/after.
let pendingDestroy: number[] | null = null;

function scheduleDestroy(id: number) {
  if (pendingDestroy === null) {
    pendingDestroy = [id];
    process.nextTick(flushDestroyQueue);
  } else {
    pendingDestroy.push(id);
  }
}

function flushDestroyQueue() {
  const queue = pendingDestroy;
  pendingDestroy = null;
  if (!queue) return;
  for (let i = 0; i < queue.length; i++) {
    emitDestroy(queue[i]);
  }
}

function emitInit(asyncId: number, type: string, triggerAsyncId: number, resource: any) {
  // Snapshot: a hook's init may call createHook/enable/disable; we want to
  // iterate the set as it stood at emission time.
  const hooks = activeHooks.slice();
  for (let i = 0; i < hooks.length; i++) {
    const fn = hooks[i].init;
    if (fn) {
      try {
        fn(asyncId, type, triggerAsyncId, resource);
      } catch (err) {
        reportHookError(err);
      }
    }
  }
}

function emitBefore(asyncId: number) {
  const hooks = activeHooks.slice();
  for (let i = 0; i < hooks.length; i++) {
    const fn = hooks[i].before;
    if (fn) {
      try {
        fn(asyncId);
      } catch (err) {
        reportHookError(err);
      }
    }
  }
}

function emitAfter(asyncId: number) {
  const hooks = activeHooks.slice();
  for (let i = 0; i < hooks.length; i++) {
    const fn = hooks[i].after;
    if (fn) {
      try {
        fn(asyncId);
      } catch (err) {
        reportHookError(err);
      }
    }
  }
}

function emitDestroy(asyncId: number) {
  const hooks = activeHooks.slice();
  for (let i = 0; i < hooks.length; i++) {
    const fn = hooks[i].destroy;
    if (fn) {
      try {
        fn(asyncId);
      } catch (err) {
        reportHookError(err);
      }
    }
  }
}

function reportHookError(err: unknown) {
  // Mirror Node's behavior of emitting uncaughtException for hook throws.
  process.nextTick(() => {
    throw err;
  });
}

// Known limitation: wrapping is installed on `globalThis` lazily, on the
// first `.enable()`. A caller that captures a reference *before* enabling
// — e.g. `const st = setTimeout; hook.enable(); st(cb, 1);` — keeps a
// pointer to the original native function and bypasses the hook layer.
// Node has the same property because their hooks live in a JS prologue
// around the native call; in practice it matters only for tooling that
// cached references pre-boot. The regression test
// `test/js/node/async_hooks/createHook-timers.test.ts` ("cached timer
// reference captured before .enable()…") pins this behavior so a future
// lower-level interception (e.g. intercepting inside `Bun__Timer__setTimeout`)
// is a conscious opt-in.
function installTimerHooks() {
  if (timerGlobalsPatched) return;
  timerGlobalsPatched = true;

  const g = globalThis as any;
  const origSetTimeout = g.setTimeout;
  const origSetInterval = g.setInterval;
  const origSetImmediate = g.setImmediate;
  const origClearTimeout = g.clearTimeout;
  const origClearInterval = g.clearInterval;
  const origClearImmediate = g.clearImmediate;

  function wrapTimer(type: string, orig: Function, isInterval: boolean) {
    const wrapped = function wrappedTimerCreate(this: any, callback: any, ...rest: any[]) {
      if (!$isCallable(callback) || activeHooks.length === 0) {
        return orig.$apply(this, arguments);
      }
      const asyncId = nextAsyncId++;
      const triggerAsyncId = currentExecutionAsyncId;
      let timer: any;
      const wrappedCallback = function wrappedTimerCallback(this: any, ...args: any[]) {
        const prevExec = currentExecutionAsyncId;
        const prevTrig = currentTriggerAsyncId;
        currentExecutionAsyncId = asyncId;
        currentTriggerAsyncId = triggerAsyncId;
        emitBefore(asyncId);
        try {
          return callback.$apply(this, args);
        } finally {
          emitAfter(asyncId);
          if (!isInterval) {
            // Non-repeating: the resource is done after it fires. Mark
            // destroyed immediately so any later clear is a no-op, then queue
            // the destroy callback to run on nextTick (matches Node's order
            // where `destroy` trails `after` asynchronously).
            if (timer && !timer[kDestroyed]) {
              timer[kDestroyed] = true;
              scheduleDestroy(asyncId);
            }
          }
          currentExecutionAsyncId = prevExec;
          currentTriggerAsyncId = prevTrig;
        }
      };
      timer = orig.$call(this, wrappedCallback, ...rest);
      if (timer && typeof timer === "object") {
        timer[kAsyncId] = asyncId;
        timer[kDestroyed] = false;
        timer[kTimerKind] = type;
        emitInit(asyncId, type, triggerAsyncId, timer);
      }
      return timer;
    };
    // Forward `util.promisify.custom` (and `customPromisifyArgs`, `.name`,
    // `.length`) from the native so `util.promisify(setTimeout)` keeps
    // returning `timers/promises.setTimeout` after hooks are enabled. Without
    // this, promisify's custom-symbol lookup misses and it falls back to the
    // generic errback wrapper, which calls `setTimeout(delay, nodeCallback)`
    // — argument order is wrong and the promise never resolves. See
    // `src/js/internal/promisify.ts` for how the custom symbols are wired.
    const kCustomPromisify = Symbol.for("nodejs.util.promisify.custom");
    const customPromisify = (orig as any)[kCustomPromisify];
    if (customPromisify !== undefined) {
      Object.defineProperty(wrapped, kCustomPromisify, { value: customPromisify, configurable: true });
    }
    return wrapped;
  }

  // `expectedKind` mirrors Node's strict pairing: `clearTimeout`/
  // `clearInterval` operate on `Timeout` handles, `clearImmediate` on
  // `Immediate` handles. Passing a mismatched handle is a no-op in Node
  // (the native clear can't find the handle in its heap), so we must also
  // skip the async-hooks destroy to avoid a spurious event for a timer
  // that's still going to fire.
  function wrapClearTimer(orig: Function, expectedKind: "Timeout" | "Immediate") {
    return function wrappedClear(this: any, timer: any) {
      if (
        timer &&
        typeof timer === "object" &&
        timer[kAsyncId] != null &&
        timer[kTimerKind] === expectedKind &&
        !timer[kDestroyed]
      ) {
        timer[kDestroyed] = true;
        scheduleDestroy(timer[kAsyncId]);
      }
      return orig.$apply(this, arguments);
    };
  }

  g.setTimeout = wrapTimer("Timeout", origSetTimeout, false);
  g.setInterval = wrapTimer("Timeout", origSetInterval, true);
  g.setImmediate = wrapTimer("Immediate", origSetImmediate, false);
  g.clearTimeout = wrapClearTimer(origClearTimeout, "Timeout");
  g.clearInterval = wrapClearTimer(origClearInterval, "Timeout");
  g.clearImmediate = wrapClearTimer(origClearImmediate, "Immediate");

  // `node:timers` snapshots the global timer functions into its default
  // export at evaluation time. If a dependency `require()`d the module
  // before `createHook(...).enable()` — common in the wild since plenty of
  // packages import `timers` at top-level — its exports still point at the
  // unwrapped natives and would bypass hook emission. Overwrite them in
  // place so `require('node:timers').setTimeout(...)` fires hooks regardless
  // of load order. `require()` here reuses the cached module if present
  // and populates it with wrapped globals if it hasn't been loaded yet.
  try {
    const timersMod = require("node:timers");
    timersMod.setTimeout = g.setTimeout;
    timersMod.setInterval = g.setInterval;
    timersMod.setImmediate = g.setImmediate;
    timersMod.clearTimeout = g.clearTimeout;
    timersMod.clearInterval = g.clearInterval;
    timersMod.clearImmediate = g.clearImmediate;
  } catch {
    // Safety net: if requiring `node:timers` during `installTimerHooks()`
    // fails (e.g. initialization ordering corner cases), we still have the
    // globalThis patches — direct `setTimeout(…)` calls continue to work.
    // `node:timers/promises` is not patched here; its module-level `const`
    // captures of `globalThis.setImmediate`/etc. at load time are a known
    // limitation (see warning text).
  }
}

function createHook(hook) {
  validateObject(hook, "hook");
  const { init, before, after, destroy, promiseResolve } = hook;
  if (init !== undefined && typeof init !== "function") throw $ERR_ASYNC_CALLBACK("hook.init");
  if (before !== undefined && typeof before !== "function") throw $ERR_ASYNC_CALLBACK("hook.before");
  if (after !== undefined && typeof after !== "function") throw $ERR_ASYNC_CALLBACK("hook.after");
  if (destroy !== undefined && typeof destroy !== "function") throw $ERR_ASYNC_CALLBACK("hook.destroy");
  if (promiseResolve !== undefined && typeof promiseResolve !== "function")
    throw $ERR_ASYNC_CALLBACK("hook.promiseResolve");

  // Keep a single normalized record so we don't pay re-destructure costs on
  // every emission. The user-facing `enable()`/`disable()` just toggles this
  // record's presence in the `activeHooks` array.
  const record: AsyncHookCallbacks = { init, before, after, destroy, promiseResolve };
  let enabled = false;

  return {
    enable() {
      if (!enabled) {
        enabled = true;
        createHookPartialWarning(hook);
        activeHooks.push(record);
        hasEnabledCreateHook = true;
        installTimerHooks();
      }
      return this;
    },
    disable() {
      if (enabled) {
        enabled = false;
        const idx = activeHooks.indexOf(record);
        if (idx !== -1) activeHooks.splice(idx, 1);
      }
      return this;
    },
  };
}

function executionAsyncId() {
  return currentExecutionAsyncId;
}

function triggerAsyncId() {
  return currentTriggerAsyncId;
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
