const warnOnce = fn => {
  let warned = false;
  return (...args) => {
    if (!warned) {
      warned = true;
      fn(...args);
    }
  };
};

const notImplemented = warnOnce(() => console.warn("[bun]: async_hooks has not been implemented yet :("));

class AsyncLocalStorage {
  #store;
  _enabled;

  constructor() {
    this._enabled = false;
  }

  enterWith(store) {
    this.#store = store;
    notImplemented();

    return this;
  }

  exit(cb, ...args) {
    this.#store = null;
    notImplemented();
    cb(...args);
  }

  run(store, callback, ...args) {
    if (typeof callback !== "function") throw new TypeError("ERR_INVALID_CALLBACK");
    const prev = this.#store;
    this.enterWith(store);

    try {
      return callback(...args);
    } finally {
      this.#store = prev;
    }
  }

  getStore() {
    return this.#store;
  }
}

function createHook() {
  return {
    enable() {
      notImplemented();
    },
    disable() {
      notImplemented();
    },
  };
}

function executionAsyncId() {
  return 0;
}

function triggerAsyncId() {
  return 0;
}

function executionAsyncResource() {
  return null;
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

class AsyncResource {
  constructor(type, triggerAsyncId) {
    this.type = type;
    this.triggerAsyncId = triggerAsyncId;
  }

  type;
  triggerAsyncId;

  emitBefore() {
    return true;
  }

  emitAfter() {
    return true;
  }

  emitDestroy() {}

  runInAsyncScope(fn, ...args) {
    notImplemented();
    process.nextTick(fn, ...args);
  }

  asyncId() {
    return 0;
  }
}

export {
  AsyncLocalStorage,
  createHook,
  executionAsyncId,
  triggerAsyncId,
  executionAsyncResource,
  asyncWrapProviders,
  AsyncResource,
};

export default {
  AsyncLocalStorage,
  createHook,
  executionAsyncId,
  triggerAsyncId,
  executionAsyncResource,
  asyncWrapProviders,
  AsyncResource,
  [Symbol.toStringTag]: "Module (not implemented yet)",
  [Symbol.for("CommonJS")]: 0,
};
