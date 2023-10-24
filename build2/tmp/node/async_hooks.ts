var $;// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from src/js/node/async_hooks.ts


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
// This means context tracking is *kind-of* manual. If we recieve a callback in native code
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
const { cleanupLater, setAsyncHooksEnabled } = __intrinsic__lazy("async_hooks");

// Only run during debug
function assertValidAsyncContextArray(array: unknown): array is ReadonlyArray<any> | undefined {
  // undefined is OK
  if (array === undefined) return true;
  // Otherwise, it must be an array
  (IS_BUN_DEVELOPMENT?$assert(
    Array.isArray(array),"Array.isArray(array)",     "AsyncContextData must be an array or undefined, got",
    Bun.inspect(array, { depth: 1 }),
  ):void 0);
  // the array has to be even
  (IS_BUN_DEVELOPMENT?$assert(array.length % 2 === 0,"array.length % 2 === 0", "AsyncContextData should be even-length, got", Bun.inspect(array, { depth: 1 })):void 0);
  // if it is zero-length, use undefined instead
  (IS_BUN_DEVELOPMENT?$assert(array.length > 0,"array.length > 0", "AsyncContextData should be undefined if empty, got", Bun.inspect(array, { depth: 1 })):void 0);
  for (var i = 0; i < array.length; i += 2) {
    (IS_BUN_DEVELOPMENT?$assert(
      array[i] instanceof AsyncLocalStorage,"array[i] instanceof AsyncLocalStorage",       `Odd indexes in AsyncContextData should be an array of AsyncLocalStorage\nIndex %s was %s`,
      i,
      array[i],
    ):void 0);
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
  (IS_BUN_DEVELOPMENT?$debug_log("get", debugFormatContextValue(__intrinsic__getInternalField(__intrinsic__asyncContext, 0))):void 0);
  return __intrinsic__getInternalField(__intrinsic__asyncContext, 0);
}

function set(contextValue: ReadonlyArray<any> | undefined) {
  (IS_BUN_DEVELOPMENT?$assert(assertValidAsyncContextArray(contextValue),"assertValidAsyncContextArray(contextValue)"):void 0);
  (IS_BUN_DEVELOPMENT?$debug_log("set", debugFormatContextValue(contextValue)):void 0);
  return __intrinsic__putInternalField(__intrinsic__asyncContext, 0, contextValue);
}

class AsyncLocalStorage {
  #disableCalled = false;

  constructor() {
    setAsyncHooksEnabled(true);

    // In debug mode assign every AsyncLocalStorage a unique ID
    if (IS_BUN_DEVELOPMENT) {
      const uid = Math.random().toString(36).slice(2, 8);
      const source = (__intrinsic__requireNativeModule("bun:jsc")).callerSourceOrigin();

      (this as any).__id__ = uid + "@" + (__intrinsic__getInternalField(__intrinsic__internalModuleRegistry, 30/*node:path*/) || __intrinsic__createInternalModuleById(30/*node:path*/)).basename(source);

      (IS_BUN_DEVELOPMENT?$debug_log("new AsyncLocalStorage uid=", (this as any).__id__, source):void 0);
    }
  }

  static bind(fn, ...args: any) {
    return this.snapshot().bind(null, fn, ...args);
  }

  static snapshot() {
    var context = get();
    return (fn, ...args) => {
      var prev = get();
      set(context);
      try {
        return fn(...args);
      } catch (error) {
        throw error;
      } finally {
        set(prev);
      }
    };
  }

  enterWith(store) {
    cleanupLater();
    var context = get();
    if (!context) {
      set([this, store]);
      return;
    }
    var { length } = context;
    (IS_BUN_DEVELOPMENT?$assert(length > 0,"length > 0"):void 0);
    (IS_BUN_DEVELOPMENT?$assert(length % 2 === 0,"length % 2 === 0"):void 0);
    for (var i = 0; i < length; i += 2) {
      if (context[i] === this) {
        (IS_BUN_DEVELOPMENT?$assert(length > i + 1,"length > i + 1"):void 0);
        const clone = context.slice();
        clone[i + 1] = store;
        set(clone);
        return;
      }
    }
    set(context.concat(this, store));
    (IS_BUN_DEVELOPMENT?$assert(this.getStore() === store,"this.getStore() === store"):void 0);
  }

  exit(cb, ...args) {
    return this.run(undefined, cb, ...args);
  }

  // This function is literred with $asserts to ensure that everything that
  // is assumed to be true is *actually* true.
  run(store_value, callback, ...args) {
    (IS_BUN_DEVELOPMENT?$debug_log("run " + (this as any).__id__):void 0);
    var context = get() as any[]; // we make sure to .slice() before mutating
    var hasPrevious = false;
    var previous_value;
    var i = 0;
    var contextWasAlreadyInit = !context;
    if (contextWasAlreadyInit) {
      set((context = [this, store_value]));
    } else {
      // it's safe to mutate context now that it was cloned
      context = context!.slice();
      i = context.indexOf(this);
      if (i > -1) {
        (IS_BUN_DEVELOPMENT?$assert(i % 2 === 0,"i % 2 === 0"):void 0);
        hasPrevious = true;
        previous_value = context[i + 1];
        context[i + 1] = store_value;
      } else {
        i = context.length;
        context.push(this, store_value);
        (IS_BUN_DEVELOPMENT?$assert(i % 2 === 0,"i % 2 === 0"):void 0);
        (IS_BUN_DEVELOPMENT?$assert(context.length % 2 === 0,"context.length % 2 === 0"):void 0);
      }
      set(context);
    }
    (IS_BUN_DEVELOPMENT?$assert(i > -1,"i > -1", "i was not set"):void 0);
    (IS_BUN_DEVELOPMENT?$assert(this.getStore() === store_value,"this.getStore() === store_value", "run: store_value was not set"):void 0);
    try {
      return callback(...args);
    } catch (e) {
      throw e;
    } finally {
      // Note: early `return` will prevent `throw` above from working. I think...
      // Set AsyncContextFrame to undefined if we are out of context values
      if (!this.#disableCalled) {
        var context2 = get()! as any[]; // we make sure to .slice() before mutating
        if (context2 === context && contextWasAlreadyInit) {
          (IS_BUN_DEVELOPMENT?$assert(context2.length === 2,"context2.length === 2", "context was mutated without copy"):void 0);
          set(undefined);
        } else {
          context2 = context2.slice(); // array is cloned here
          (IS_BUN_DEVELOPMENT?$assert(context2[i] === this,"context2[i] === this"):void 0);
          if (hasPrevious) {
            context2[i + 1] = previous_value;
            set(context2);
          } else {
            // i wonder if this is a fair assert to make
            context2.splice(i, 2);
            (IS_BUN_DEVELOPMENT?$assert(context2.length % 2 === 0,"context2.length % 2 === 0"):void 0);
            set(context2.length ? context2 : undefined);
          }
        }
        (IS_BUN_DEVELOPMENT?$assert(
          this.getStore() === previous_value,"this.getStore() === previous_value",           "run: previous_value",
          Bun.inspect(previous_value),
          "was not restored, i see",
          this.getStore(),
        ):void 0);
      }
    }
  }

  disable() {
    (IS_BUN_DEVELOPMENT?$debug_log("disable " + (this as any).__id__):void 0);
    // In this case, we actually do want to mutate the context state
    if (!this.#disableCalled) {
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
      this.#disableCalled = true;
    }
  }

  getStore() {
    (IS_BUN_DEVELOPMENT?$debug_log("getStore " + (this as any).__id__):void 0);
    var context = get();
    if (!context) return;
    var { length } = context;
    for (var i = 0; i < length; i += 2) {
      if (context[i] === this) return context[i + 1];
    }
  }
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

  constructor(type, options?) {
    if (typeof type !== "string") {
      __intrinsic__throwTypeError('The "type" argument must be of type string. Received type ' + typeof type);
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
      return fn.__intrinsic__apply(thisArg, args);
    } catch (error) {
      throw error;
    } finally {
      set(prev);
    }
  }

  bind(fn, thisArg) {
    return this.runInAsyncScope.bind(this, fn, thisArg ?? this);
  }

  static bind(fn, type, thisArg) {
    type = type || fn.name;
    return new AsyncResource(type || "bound-anonymous-fn").bind(fn, thisArg);
  }
}

// The rest of async_hooks is not implemented and is stubbed with no-ops and warnings.

function createWarning(message) {
  let warned = false;
  var wrapped = function () {
    if (warned) return;

    // zx does not need createHook to function
    const isFromZX = new Error().stack!.includes("zx/build/core.js");
    if (isFromZX) return;

    warned = true;
    console.warn("[bun] Warning:", message);
  };
  return wrapped;
}

const createHookNotImpl = createWarning(
  "async_hooks.createHook is not implemented in Bun. Hooks can still be created but will never be called.",
);

function createHook(callbacks) {
  return {
    enable: createHookNotImpl,
    disable: createHookNotImpl,
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

$ = {
  AsyncLocalStorage,
  createHook,
  executionAsyncId,
  triggerAsyncId,
  executionAsyncResource,
  asyncWrapProviders,
  AsyncResource,
};
$$EXPORT$$($).$$EXPORT_END$$;
