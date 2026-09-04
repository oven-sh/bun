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
  readonly storage: AsyncLocalStorage;
  readonly value: unknown;
  readonly prev: Frame | undefined;
  // Storages that disable() exited while this frame was current. A lookup that
  // *starts* here (or at a frame later pushed on top, which inherits the mask)
  // sees no binding for them; lookups that merely pass through from an older
  // frame above are unaffected. This is Node deleting the key from the current
  // frame object: holders of that exact frame and copies made from it later lose
  // the binding, earlier copies keep it. Usually undefined.
  masked: AsyncLocalStorage[] | undefined;
  constructor(
    storage: AsyncLocalStorage,
    value: unknown,
    prev: Frame | undefined,
    masked: AsyncLocalStorage[] | undefined,
  ) {
    this.storage = storage;
    this.value = value;
    this.prev = prev;
    this.masked = masked;
  }
}

// Only run during debug
function assertValidFrame(frame: unknown): boolean {
  for (var f = frame, n = 0; f !== undefined; f = (f as Frame).prev, n++) {
    $assert(f instanceof Frame, "AsyncContextData must be a Frame chain or undefined, got", f);
    $assert((f as Frame).storage instanceof AsyncLocalStorage, "Frame.storage must be an AsyncLocalStorage");
    $assert((f as Frame).masked === undefined || $isJSArray((f as Frame).masked), "Frame.masked must be an array");
    $assert(n < 10000, "AsyncContextData chain is unreasonably long (cycle?)");
  }
  return true;
}

// Only run during debug
function debugFormatContextValue(frame: Frame | undefined) {
  if (frame === undefined) return "undefined";
  let str = "{";
  for (var f: Frame | undefined = frame; f !== undefined; f = f.prev) {
    str += ` ${(f.storage as any).__id__}: ${typeof f.value};`;
  }
  return str + " }";
}

// Bumped whenever disable() masks a frame in place, so run() can tell that the
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

function isMasked(frame: Frame | undefined, storage: AsyncLocalStorage): boolean {
  if (frame === undefined || frame.masked === undefined) return false;
  var masked = frame.masked;
  for (var i = 0, n = masked.length; i < n; i++) {
    if (masked[i] === storage) return true;
  }
  return false;
}

function unmask(masked: AsyncLocalStorage[] | undefined, storage: AsyncLocalStorage): AsyncLocalStorage[] | undefined {
  if (masked === undefined) return undefined;
  var rest: AsyncLocalStorage[] = [];
  for (var i = 0, n = masked.length; i < n; i++) {
    if (masked[i] !== storage) $arrayPush(rest, masked[i]);
  }
  return rest.length === 0 ? undefined : rest.length === masked.length ? masked : rest;
}

// The binding of `storage` visible from `start`, or undefined.
function lookup(start: Frame | undefined, storage: AsyncLocalStorage): Frame | undefined {
  if (isMasked(start, storage)) return undefined;
  return find(start, storage);
}

// The innermost frame binding `storage` at or below `frame`, ignoring masks.
function find(frame: Frame | undefined, storage: AsyncLocalStorage): Frame | undefined {
  for (var f = frame; f !== undefined; f = f.prev) {
    if (f.storage === storage) return f;
  }
  return undefined;
}

// A new binding on top of `head`; what was visible from `head` stays visible.
function push(head: Frame | undefined, storage: AsyncLocalStorage, value: unknown): Frame {
  return new Frame(storage, value, head, head === undefined ? undefined : unmask(head.masked, storage));
}

// `frame` with the innermost binding of `storage` removed. Frames above it are
// copied (they may be shared with other captures); the tail below it is shared.
// The view from the result is the view from `frame` minus that binding, masks
// included.
function without(frame: Frame | undefined, storage: AsyncLocalStorage): Frame | undefined {
  var found = find(frame, storage);
  if (found === undefined) return frame;
  return copyUntil(frame!, found, found.prev);
}

// `frame` with every binding of `storage` removed (nested run() of one storage
// stacks shadowed bindings).
function withoutAll(frame: Frame | undefined, storage: AsyncLocalStorage): Frame | undefined {
  var found = find(frame, storage);
  if (found === undefined) return frame;
  return copyUntil(frame!, found, withoutAll(found.prev, storage));
}

// Copies [from, stop) onto tail so that the view from the result is the view
// from `from` minus what was cut out: the new head carries `from`'s mask (a
// deeper frame's own mask describes lookups that start *there* and is not
// inherited), interior copies keep theirs.
function copyUntil(from: Frame, stop: Frame, tail: Frame | undefined): Frame | undefined {
  if (from === stop) {
    if (tail === undefined || tail.masked === from.masked) return tail;
    return new Frame(tail.storage, tail.value, tail.prev, from.masked);
  }
  var copied: Frame[] = [];
  for (var f = from; f !== stop; f = f.prev!) {
    $arrayPush(copied, f);
  }
  for (var i = copied.length - 1; i >= 0; i--) {
    tail = new Frame(copied[i].storage, copied[i].value, tail, copied[i].masked);
  }
  return tail;
}

function mergeMasks(a: AsyncLocalStorage[] | undefined, b: AsyncLocalStorage[]): AsyncLocalStorage[] {
  if (a === undefined) return b;
  var merged: AsyncLocalStorage[] = [];
  for (var i = 0, n = a.length; i < n; i++) $arrayPush(merged, a[i]);
  for (var i = 0, n = b.length; i < n; i++) $arrayPush(merged, b[i]);
  return merged;
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
    // Replace rather than shadow an existing binding so repeated enterWith() calls
    // keep the chain bounded by the number of storages.
    set(push(without(get(), this), this, store));
    $assert(sameValue(this.getStore(), store));
  }

  exit(cb, ...args) {
    return this.run(undefined, cb, ...args);
  }

  run(store_value, callback, ...args) {
    $debug("run " + (this as any).__id__);
    var prior = get();
    var before = lookup(prior, this);
    var beforeValue = before !== undefined ? before.value : this.#defaultValue;
    // Node short-circuits when the value is unchanged: no enterWith, no
    // finally-restore. Observable when the callback calls enterWith() —
    // the new value survives past run() (verified against Node v22/v26).
    if (sameValue(beforeValue, store_value)) {
      return callback.$apply(undefined, args);
    }
    var mutations = frameMutations;
    // Shadows any outer binding of this storage: lookups stop at the innermost.
    var frame = push(prior, this, store_value);
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
        // enterWith(prior store): keep whatever else the callback installed and
        // rebind this storage to what getStore() returned on entry. Frames may
        // have been copied since (enterWith() of a storage bound further down
        // copies everything above it), so go by value, not identity: drop every
        // binding of this storage and put the prior one back on top. Enclosing
        // run()s of the same storage restore their own value likewise.
        set(push(withoutAll(get(), this), this, beforeValue));
      }
      $assert(sameValue(this.getStore(), beforeValue), "run: previous value was not restored");
    }
  }

  disable() {
    $debug("disable " + (this as any).__id__);
    // Node deletes the key from the current frame object: continuations holding
    // that exact frame (and frames later pushed onto it) lose the binding, older
    // ones keep it. Mask it on the current frame rather than unlinking shared
    // nodes; see Frame.masked.
    var top = get();
    if (top !== undefined && lookup(top, this) !== undefined) {
      top.masked = mergeMasks(top.masked, [this]);
      frameMutations++;
    }
  }

  get name() {
    return this.#name || "";
  }

  getStore() {
    $debug("getStore " + (this as any).__id__);
    var start = get();
    if (start === undefined || isMasked(start, this)) return this.#defaultValue;
    for (var f: Frame | undefined = start; f !== undefined; f = f.prev) {
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

// NODE_ASYNC_PROVIDER_TYPES in declaration order (the numbers are enum positions):
// https://github.com/nodejs/node/blob/v26.3.0/src/async_wrap.h#L34-L112
// Node publishes it frozen with a null prototype:
// https://github.com/nodejs/node/blob/v26.3.0/lib/async_hooks.js#L293
const asyncWrapProviders = Object.freeze({
  __proto__: null,
  NONE: 0,
  DIRHANDLE: 1,
  DNSCHANNEL: 2,
  ELDHISTOGRAM: 3,
  FILEHANDLE: 4,
  FILEHANDLECLOSEREQ: 5,
  BLOBREADER: 6,
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
  LOCKS: 19,
  JSSTREAM: 20,
  JSUDPWRAP: 21,
  MESSAGEPORT: 22,
  PIPECONNECTWRAP: 23,
  PIPESERVERWRAP: 24,
  PIPEWRAP: 25,
  PROCESSWRAP: 26,
  PROMISE: 27,
  QUERYWRAP: 28,
  QUIC_ENDPOINT: 29,
  QUIC_LOGSTREAM: 30,
  QUIC_SESSION: 31,
  QUIC_STREAM: 32,
  QUIC_UDP: 33,
  SHUTDOWNWRAP: 34,
  SIGNALWRAP: 35,
  STATWATCHER: 36,
  STREAMPIPE: 37,
  TCPCONNECTWRAP: 38,
  TCPSERVERWRAP: 39,
  TCPWRAP: 40,
  TTYWRAP: 41,
  UDPSENDWRAP: 42,
  UDPWRAP: 43,
  SIGINTWATCHDOG: 44,
  WORKER: 45,
  WORKERCPUPROFILE: 46,
  WORKERCPUUSAGE: 47,
  WORKERHEAPPROFILE: 48,
  WORKERHEAPSNAPSHOT: 49,
  WORKERHEAPSTATISTICS: 50,
  WRITEWRAP: 51,
  ZLIB: 52,
  CHECKPRIMEREQUEST: 53,
  PBKDF2REQUEST: 54,
  KEYPAIRGENREQUEST: 55,
  KEYGENREQUEST: 56,
  KEYEXPORTREQUEST: 57,
  ARGON2REQUEST: 58,
  CIPHERREQUEST: 59,
  DERIVEBITSREQUEST: 60,
  HASHREQUEST: 61,
  RANDOMBYTESREQUEST: 62,
  RANDOMPRIMEREQUEST: 63,
  SCRYPTREQUEST: 64,
  SIGNREQUEST: 65,
  TLSWRAP: 66,
  VERIFYREQUEST: 67,
});

export default {
  AsyncLocalStorage,
  createHook,
  executionAsyncId,
  triggerAsyncId,
  executionAsyncResource,
  asyncWrapProviders,
  AsyncResource,
};
