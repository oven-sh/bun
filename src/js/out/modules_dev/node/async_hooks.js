var createHook = function() {
  return {
    enable() {
      notImplemented();
    },
    disable() {
      notImplemented();
    }
  };
}, executionAsyncId = function() {
  return 0;
}, triggerAsyncId = function() {
  return 0;
}, executionAsyncResource = function() {
  return null;
}, drainMicrotasks = () => {
  ({ drainMicrotasks } = import.meta.require("bun:jsc")), drainMicrotasks();
}, notImplemented = () => {
  console.warn("[bun]: async_hooks has not been implemented yet. See https://github.com/oven-sh/bun/issues/1832"), notImplemented = () => {
  };
};

class AsyncLocalStorage {
  #store;
  _enabled;
  constructor() {
    this._enabled = !1, this.#store = null;
  }
  enterWith(store) {
    return this.#store = store, notImplemented(), this;
  }
  exit(cb, ...args) {
    this.#store = null, notImplemented(), typeof cb === "function" && cb(...args);
  }
  run(store, callback, ...args) {
    if (typeof callback !== "function")
      throw new TypeError("ERR_INVALID_CALLBACK");
    var result, err;
    if (process.nextTick((store2) => {
      const prev = this.#store;
      this.enterWith(store2);
      try {
        result = callback(...args);
      } catch (e) {
        err = e;
      } finally {
        this.#store = prev;
      }
    }, store), drainMicrotasks(), typeof err !== "undefined")
      throw err;
    return result;
  }
  getStore() {
    return this.#store;
  }
}
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

class AsyncResource {
  constructor(type, triggerAsyncId2) {
    if (this.type = type, this.triggerAsyncId = triggerAsyncId2, AsyncResource.allowedRunInAsyncScope.has(type))
      this.runInAsyncScope = this.#runInAsyncScope;
  }
  type;
  triggerAsyncId;
  static allowedRunInAsyncScope = new Set(["prisma-client-request"]);
  emitBefore() {
    return !0;
  }
  emitAfter() {
    return !0;
  }
  emitDestroy() {
  }
  runInAsyncScope;
  #runInAsyncScope(fn, ...args) {
    notImplemented();
    var result, err;
    if (process.nextTick((fn2) => {
      try {
        result = fn2(...args);
      } catch (err2) {
        err = err2;
      }
    }, fn), drainMicrotasks(), err)
      throw err;
    return result;
  }
  asyncId() {
    return 0;
  }
}
var async_hooks_default = {
  AsyncLocalStorage,
  createHook,
  executionAsyncId,
  triggerAsyncId,
  executionAsyncResource,
  asyncWrapProviders,
  AsyncResource,
  [Symbol.toStringTag]: "Module (not implemented yet)",
  [Symbol.for("CommonJS")]: 0
};
export {
  triggerAsyncId,
  executionAsyncResource,
  executionAsyncId,
  async_hooks_default as default,
  createHook,
  asyncWrapProviders,
  AsyncResource,
  AsyncLocalStorage
};

//# debugId=248E760CBB05B0E264756e2164756e21
