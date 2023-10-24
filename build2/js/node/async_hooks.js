(function (){"use strict";
let $debug_log_enabled = ((env) => (
  // The rationale for checking all these variables is just so you don't have to exactly remember which one you set.
  (env.BUN_DEBUG_ALL && env.BUN_DEBUG_ALL !== '0')
  || (env.BUN_DEBUG_JS && env.BUN_DEBUG_JS !== '0')
  || (env.BUN_DEBUG_NODE_ASYNC_HOOKS)
  || (env.DEBUG_NODE_ASYNC_HOOKS)
))(Bun.env);
let $debug_pid_prefix = Bun.env.SHOW_PID === '1';
let $debug_log = $debug_log_enabled ? (...args) => {
  // warn goes to stderr without colorizing
  console.warn(($debug_pid_prefix ? `[${process.pid}] ` : '') + (Bun.enableANSIColors ? '\x1b[90m[async_hooks]\x1b[0m' : '[async_hooks]'), ...args);
} : () => {};

let $assert = function(check, sourceString, ...message) {
  if (!check) {
    const prevPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = (e, stack) => {
      return e.name + ': ' + e.message + '\n' + stack.slice(1).map(x => '  at ' + x.toString()).join('\n');
    };
    const e = new Error(sourceString);
    e.stack; // materialize stack
    e.name = 'AssertionError';
    Error.prepareStackTrace = prevPrepareStackTrace;
    console.error('[async_hooks] ASSERTION FAILED: ' + sourceString);
    if (message.length) console.warn(...message);
    console.warn(e.stack.split('\n')[1] + '\n');
    if (Bun.env.ASSERT === 'CRASH') process.exit(0xAA);
    throw e;
  }
}
// build2/tmp/node/async_hooks.ts
var assertValidAsyncContextArray = function(array) {
  if (array === @undefined)
    return true;
  $assert(@Array.isArray(array), "Array.isArray(array)", "AsyncContextData must be an array or undefined, got", Bun.inspect(array, { depth: 1 }));
  $assert(array.length % 2 === 0, "array.length % 2 === 0", "AsyncContextData should be even-length, got", Bun.inspect(array, { depth: 1 }));
  $assert(array.length > 0, "array.length > 0", "AsyncContextData should be undefined if empty, got", Bun.inspect(array, { depth: 1 }));
  for (var i = 0;i < array.length; i += 2) {
    $assert(array[i] instanceof AsyncLocalStorage, "array[i] instanceof AsyncLocalStorage", `Odd indexes in AsyncContextData should be an array of AsyncLocalStorage\nIndex %s was %s`, i, array[i]);
  }
  return true;
};
var debugFormatContextValue = function(value) {
  if (value === @undefined)
    return "undefined";
  let str = "{\n";
  for (var i = 0;i < value.length; i += 2) {
    str += `  ${value[i].__id__}: typeof = ${typeof value[i + 1]}\n`;
  }
  str += "}";
  return str;
};
var get = function() {
  $debug_log("get", debugFormatContextValue(@getInternalField(@asyncContext, 0)));
  return @getInternalField(@asyncContext, 0);
};
var set = function(contextValue) {
  $assert(assertValidAsyncContextArray(contextValue), "assertValidAsyncContextArray(contextValue)");
  $debug_log("set", debugFormatContextValue(contextValue));
  return @putInternalField(@asyncContext, 0, contextValue);
};
var createWarning = function(message) {
  let warned = false;
  var wrapped = function() {
    if (warned)
      return;
    const isFromZX = new Error().stack.includes("zx/build/core.js");
    if (isFromZX)
      return;
    warned = true;
    console.warn("[bun] Warning:", message);
  };
  return wrapped;
};
var createHook = function(callbacks) {
  return {
    enable: createHookNotImpl,
    disable: createHookNotImpl
  };
};
var executionAsyncId = function() {
  executionAsyncIdNotImpl();
  return 0;
};
var triggerAsyncId = function() {
  return 0;
};
var executionAsyncResource = function() {
  executionAsyncResourceWarning();
  return process.stdin;
};
var $;
var { cleanupLater, setAsyncHooksEnabled } = @lazy("async_hooks");

class AsyncLocalStorage {
  #disableCalled = false;
  constructor() {
    setAsyncHooksEnabled(true);
    if (true) {
      const uid = Math.random().toString(36).slice(2, 8);
      const source = @requireNativeModule("bun:jsc").callerSourceOrigin();
      this.__id__ = uid + "@" + (@getInternalField(@internalModuleRegistry, 30) || @createInternalModuleById(30)).basename(source);
      $debug_log("new AsyncLocalStorage uid=", this.__id__, source);
    }
  }
  static bind(fn, ...args) {
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
    $assert(length > 0, "length > 0");
    $assert(length % 2 === 0, "length % 2 === 0");
    for (var i = 0;i < length; i += 2) {
      if (context[i] === this) {
        $assert(length > i + 1, "length > i + 1");
        const clone = context.slice();
        clone[i + 1] = store;
        set(clone);
        return;
      }
    }
    set(context.concat(this, store));
    $assert(this.getStore() === store, "this.getStore() === store");
  }
  exit(cb, ...args) {
    return this.run(@undefined, cb, ...args);
  }
  run(store_value, callback, ...args) {
    $debug_log("run " + this.__id__);
    var context = get();
    var hasPrevious = false;
    var previous_value;
    var i = 0;
    var contextWasAlreadyInit = !context;
    if (contextWasAlreadyInit) {
      set(context = [this, store_value]);
    } else {
      context = context.slice();
      i = context.indexOf(this);
      if (i > -1) {
        $assert(i % 2 === 0, "i % 2 === 0");
        hasPrevious = true;
        previous_value = context[i + 1];
        context[i + 1] = store_value;
      } else {
        i = context.length;
        context.push(this, store_value);
        $assert(i % 2 === 0, "i % 2 === 0");
        $assert(context.length % 2 === 0, "context.length % 2 === 0");
      }
      set(context);
    }
    $assert(i > -1, "i > -1", "i was not set");
    $assert(this.getStore() === store_value, "this.getStore() === store_value", "run: store_value was not set");
    try {
      return callback(...args);
    } catch (e) {
      throw e;
    } finally {
      if (!this.#disableCalled) {
        var context2 = get();
        if (context2 === context && contextWasAlreadyInit) {
          $assert(context2.length === 2, "context2.length === 2", "context was mutated without copy");
          set(@undefined);
        } else {
          context2 = context2.slice();
          $assert(context2[i] === this, "context2[i] === this");
          if (hasPrevious) {
            context2[i + 1] = previous_value;
            set(context2);
          } else {
            context2.splice(i, 2);
            $assert(context2.length % 2 === 0, "context2.length % 2 === 0");
            set(context2.length ? context2 : @undefined);
          }
        }
        $assert(this.getStore() === previous_value, "this.getStore() === previous_value", "run: previous_value", Bun.inspect(previous_value), "was not restored, i see", this.getStore());
      }
    }
  }
  disable() {
    $debug_log("disable " + this.__id__);
    if (!this.#disableCalled) {
      var context = get();
      if (context) {
        var { length } = context;
        for (var i = 0;i < length; i += 2) {
          if (context[i] === this) {
            context.splice(i, 2);
            set(context.length ? context : @undefined);
            break;
          }
        }
      }
      this.#disableCalled = true;
    }
  }
  getStore() {
    $debug_log("getStore " + this.__id__);
    var context = get();
    if (!context)
      return;
    var { length } = context;
    for (var i = 0;i < length; i += 2) {
      if (context[i] === this)
        return context[i + 1];
    }
  }
}
if (true) {
  AsyncLocalStorage.prototype[Bun.inspect.custom] = function(depth, options) {
    if (depth < 0)
      return `AsyncLocalStorage { ${Bun.inspect(this.__id__, options)} }`;
    return `AsyncLocalStorage { [${options.stylize("debug id", "special")}]: ${Bun.inspect(this.__id__, options)} }`;
  };
}

class AsyncResource {
  type;
  #snapshot;
  constructor(type, options) {
    if (typeof type !== "string") {
      @throwTypeError('The "type" argument must be of type string. Received type ' + typeof type);
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
  }
  runInAsyncScope(fn, thisArg, ...args) {
    var prev = get();
    set(this.#snapshot);
    try {
      return fn.@apply(thisArg, args);
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
var createHookNotImpl = createWarning("async_hooks.createHook is not implemented in Bun. Hooks can still be created but will never be called.");
var executionAsyncIdNotImpl = createWarning("async_hooks.executionAsyncId/triggerAsyncId are not implemented in Bun. It will return 0 every time.");
var executionAsyncResourceWarning = createWarning("async_hooks.executionAsyncResource is not implemented in Bun. It returns a reference to process.stdin every time.");
var asyncWrapProviders = {
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
  INSPECTORJSBINDING: 57
};
$ = {
  AsyncLocalStorage,
  createHook,
  executionAsyncId,
  triggerAsyncId,
  executionAsyncResource,
  asyncWrapProviders,
  AsyncResource
};
return $})
