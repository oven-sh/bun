var createWarning = function(message) {
  let warned = !1;
  return function() {
    if (warned)
      return;
    warned = !0, process.emitWarning(message);
  };
}, createHook = function(callbacks) {
  return {
    enable() {
      createHookNotImpl();
    },
    disable() {
      createHookNotImpl();
    }
  };
}, executionAsyncId = function() {
  return executionAsyncIdNotImpl(), 0;
}, triggerAsyncId = function() {
  return 0;
}, executionAsyncResource = function() {
  return executionAsyncResourceWarning(), stubAsyncResource;
}, { get, set } = globalThis[Symbol.for("Bun.lazy")]("async_hooks");

class AsyncLocalStorage {
  #disableCalled = !1;
  constructor() {
  }
  static bind(fn) {
    return this.snapshot().bind(fn);
  }
  static snapshot() {
    var context = get();
    if (context)
      context = context.slice();
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
  }
  exit(cb, ...args) {
    return this.run(void 0, cb, ...args);
  }
  run(store, callback, ...args) {
    var context = get(), hasPrevious = !1, previous, i, contextWasInit = !context;
    if (contextWasInit)
      i = 0, set(context = [this, store]);
    else {
      context = context.slice();
      var length = context.length;
      for (i = 0;i < length; i += 2)
        if (context[i] === this) {
          hasPrevious = !0, previous = context[i + 1], context[i + 1] = store;
          break;
        }
      if (!hasPrevious)
        context.push(this, store);
      set(context);
    }
    try {
      return callback(...args);
    } catch (e) {
      throw e;
    } finally {
      if (this.#disableCalled)
        this.#disableCalled = !1;
      else {
        var context2 = get();
        if (context2 === context && contextWasInit)
          return set(void 0);
        if (context2 = context2.slice(), hasPrevious)
          context2[i + 1] = previous;
        else
          context2.splice(i, 2);
        set(context2);
      }
    }
  }
  disable() {
  }
  getStore() {
    var context = get();
    if (!context)
      return;
    var { length } = context;
    for (var i = 0;i < length; i += 2)
      if (context[i] === this)
        return context[i + 1];
  }
}
var createHookNotImpl = createWarning("async_hooks.createHook is not implemented in Bun. Hooks can still be created but will never be called."), executionAsyncIdNotImpl = createWarning("async_hooks.executionAsyncId/triggerAsyncId are not implemented in Bun. It returns 0 every time."), executionAsyncResourceWarning = createWarning("async_hooks.executionAsyncResource is not implemented in Bun."), stubAsyncResource = {}, asyncWrapProviders = {
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
var async_hooks_default = {
  AsyncLocalStorage,
  createHook,
  executionAsyncId,
  triggerAsyncId,
  executionAsyncResource,
  asyncWrapProviders,
  [Symbol.for("CommonJS")]: 0
};
export {
  triggerAsyncId,
  executionAsyncResource,
  executionAsyncId,
  async_hooks_default as default,
  createHook,
  asyncWrapProviders,
  AsyncLocalStorage
};
