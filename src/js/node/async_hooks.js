// Hardcoded module "node:async_hooks"
const { inject } = globalThis[Symbol.for("Bun.lazy")]("async_hooks");

let current = undefined;
function getAsyncContextFrame(jscContext) {
  return current ? [jscContext, new Map(current)] : jscContext;
}

function pushAsyncContextFrame(param) {
  let last = current;
  current = param;
  return last;
}

function popAsyncContextFrame(param) {
  current = param;
}

inject(pushAsyncContextFrame, popAsyncContextFrame, getAsyncContextFrame);

class AsyncLocalStorage {
  #disableCalled = false;

  constructor() {}

  static bind(fn) {
    return this.snapshot().bind(fn);
  }

  static snapshot() {
    // const context = copyContext();
    // return (fn, ...args) => runWithContext(context, fn, ...args);
  }

  enterWith(store) {
    // this.#disableCalled = false;
    // getContextInit().set(this, store);
  }

  exit(cb, ...args) {
    return this.run(undefined, cb, ...args);
  }

  run(store, callback, ...args) {
    if (!current) current = new Map();
    var hasPrevious = current.has(this);
    var previous = hasPrevious ? current.get(this) : undefined;
    current.set(this, store);
    try {
      return callback(...args);
    } catch (e) {
      throw e;
    } finally {
      if (this.#disableCalled) {
        this.#disableCalled = false;
        // was already deleted
      } else {
        if (hasPrevious) {
          current.set(this, previous);
        } else {
          current.delete(this);
          if (current.size === 0) current = undefined;
        }
      }
    }
  }

  disable() {
    // TODO: i dont think this will work correctly
    this.#disableCalled = true;
    if (current) {
      current.delete(this);
      if (current.size === 0) current = undefined;
    }
  }

  getStore() {
    return current ? current.get(this) : undefined;
  }
}

// class AsyncResource {
//   type;
//   #ctx;

//   constructor(type, options) {
//     if (typeof type !== "string") {
//       throw new TypeError('The "type" argument must be of type string. Received type ' + typeof type);
//     }
//     this.type = type;
//     this.#ctx = copyContext();
//   }

//   emitBefore() {
//     return true;
//   }

//   emitAfter() {
//     return true;
//   }

//   asyncId() {
//     return 0;
//   }

//   triggerAsyncId() {
//     return 0;
//   }

//   emitDestroy() {}

//   runInAsyncScope(fn, ...args) {
//     runWithContext(this.#ctx, fn, ...args);
//   }
// }

// todo move this into global scope/native code
// stage 2 proposal: https://github.com/tc39/proposal-async-context
// export class AsyncContext {
//   static wrap(fn) {
//     const ctx = copyContext();
//     return (...args) => runWithContext(ctx, fn, ...args);
//   }

//   constructor(options) {
//     var { name = "AsyncContext", defaultValue } = options || {};
//     this.#name = String(name);
//     this.#defaultValue = defaultValue;
//   }

//   get name() {
//     return this.#name;
//   }

//   run(fn, ...args) {
//     var context = getContextInit();
//     var hasPrevious = context.has(this);
//     var previous = hasPrevious ? context.get(this) : undefined;
//     context.set(this, store);
//     try {
//       return fn(...args);
//     } catch (e) {
//       throw e;
//     } finally {
//       if (hasPrevious) {
//         context.set(this, previous);
//       } else {
//         context.delete(this);
//       }
//     }
//   }

//   get() {
//     const context = getContext();
//     if (!context) return this.#defaultValue;
//     return context.has(this) ? context.get(this) : this.#defaultValue;
//   }
// }

// todo move this into events
// class EventEmitterAsyncResource extends EventEmitter {
//   triggerAsyncId;
//   asyncResource;

//   constructor(options) {
//     var { captureRejections = false, triggerAsyncId, name = new.target.name, requireManualDestroy } = options || {};
//     super({ captureRejections });
//     this.triggerAsyncId = triggerAsyncId ?? 0;
//     this.asyncResource = new AsyncResource(name, { triggerAsyncId, requireManualDestroy });
//   }

//   emit(...args) {
//     this.asyncResource.runInAsyncScope(() => super.emit(...args));
//   }

//   emitDestroy() {
//     this.asyncResource.emitDestroy();
//   }
// }

// The rest of async_hooks is not implemented and is stubbed with no-ops and warnings.

function createWarning(message) {
  let warned = false;
  return function () {
    if (warned) return;
    warned = true;
    process.emitWarning(message);
  };
}

const createHookNotImpl = createWarning(
  "async_hooks.createHook is not implemented in Bun. Hooks can still be created but will never be called.",
);

function createHook(callbacks) {
  return {
    enable() {
      createHookNotImpl();
    },
    disable() {
      createHookNotImpl();
    },
  };
}

const executionAsyncIdNotImpl = createWarning(
  "async_hooks.executionAsyncId/triggerAsyncId are not implemented in Bun. It returns 0 every time.",
);
function executionAsyncId() {
  executionAsyncIdNotImpl();
  return 0;
}

function triggerAsyncId() {
  return 0;
}

const executionAsyncResourceWarning = createWarning("async_hooks.executionAsyncResource is not implemented in Bun.");
const stubAsyncResource = {};
function executionAsyncResource() {
  executionAsyncResourceWarning();
  return stubAsyncResource;
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

export {
  AsyncLocalStorage,
  createHook,
  executionAsyncId,
  triggerAsyncId,
  executionAsyncResource,
  asyncWrapProviders,
  // AsyncResource,
  // TODO: move to node:events
  // EventEmitterAsyncResource,
};

export default {
  AsyncLocalStorage,
  createHook,
  executionAsyncId,
  triggerAsyncId,
  executionAsyncResource,
  asyncWrapProviders,
  // AsyncResource,
  // TODO: move to node:events
  // EventEmitterAsyncResource,
  [Symbol.for("CommonJS")]: 0,
};
