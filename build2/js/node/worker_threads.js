(function (){"use strict";// build2/tmp/node/worker_threads.ts
var emitWarning = function(type, message) {
  if (emittedWarnings.has(type))
    return;
  emittedWarnings.add(type);
  console.warn("[bun] Warning:", message);
};
var injectFakeEmitter = function(Class) {
  function messageEventHandler(event) {
    return event.data;
  }
  function errorEventHandler(event) {
    return event.error;
  }
  const wrappedListener = Symbol("wrappedListener");
  function wrapped(run, listener) {
    const callback = function(event) {
      return listener(run(event));
    };
    listener[wrappedListener] = callback;
    return callback;
  }
  function functionForEventType(event, listener) {
    switch (event) {
      case "error":
      case "messageerror": {
        return wrapped(errorEventHandler, listener);
      }
      default: {
        return wrapped(messageEventHandler, listener);
      }
    }
  }
  Class.prototype.on = function(event, listener) {
    this.addEventListener(event, functionForEventType(event, listener));
    return this;
  };
  Class.prototype.off = function(event, listener) {
    if (listener) {
      this.removeEventListener(event, listener[wrappedListener] || listener);
    } else {
      this.removeEventListener(event);
    }
    return this;
  };
  Class.prototype.once = function(event, listener) {
    this.addEventListener(event, functionForEventType(event, listener), { once: true });
    return this;
  };
  function EventClass(eventName) {
    if (eventName === "error" || eventName === "messageerror") {
      return ErrorEvent;
    }
    return MessageEvent;
  }
  Class.prototype.emit = function(event, ...args) {
    this.dispatchEvent(new (EventClass(event))(event, ...args));
    return this;
  };
  Class.prototype.prependListener = Class.prototype.on;
  Class.prototype.prependOnceListener = Class.prototype.once;
};
var receiveMessageOnPort = function(port) {
  let res = _receiveMessageOnPort(port);
  if (!res)
    return @undefined;
  return {
    message: res
  };
};
var fakeParentPort = function() {
  const fake = Object.create(MessagePort.prototype);
  Object.defineProperty(fake, "onmessage", {
    get() {
      return self.onmessage;
    },
    set(value) {
      self.onmessage = value;
    }
  });
  Object.defineProperty(fake, "onmessageerror", {
    get() {
      return self.onmessageerror;
    },
    set(value) {
    }
  });
  Object.defineProperty(fake, "postMessage", {
    value(...args) {
      return self.postMessage(...args);
    }
  });
  Object.defineProperty(fake, "close", {
    value() {
      return process.exit(0);
    }
  });
  Object.defineProperty(fake, "start", {
    value() {
    }
  });
  Object.defineProperty(fake, "unref", {
    value() {
    }
  });
  Object.defineProperty(fake, "ref", {
    value() {
    }
  });
  Object.defineProperty(fake, "hasRef", {
    value() {
      return false;
    }
  });
  Object.defineProperty(fake, "setEncoding", {
    value() {
    }
  });
  Object.defineProperty(fake, "addEventListener", {
    value: self.addEventListener.bind(self)
  });
  Object.defineProperty(fake, "removeEventListener", {
    value: self.removeEventListener.bind(self)
  });
  return fake;
};
var getEnvironmentData = function() {
  return process.env;
};
var setEnvironmentData = function(env) {
  process.env = env;
};
var markAsUntransferable = function() {
  throwNotImplemented("worker_threads.markAsUntransferable");
};
var moveMessagePortToContext = function() {
  throwNotImplemented("worker_threads.moveMessagePortToContext");
};
var $;
var EventEmitter = @getInternalField(@internalModuleRegistry, 20) || @createInternalModuleById(20);
var { throwNotImplemented } = @getInternalField(@internalModuleRegistry, 6) || @createInternalModuleById(6);
var { MessageChannel, BroadcastChannel, Worker: WebWorker } = globalThis;
var SHARE_ENV = Symbol("nodejs.worker_threads.SHARE_ENV");
var isMainThread = Bun.isMainThread;
var [_workerData, _threadId, _receiveMessageOnPort] = @lazy("worker_threads");
var emittedWarnings = new Set;
var _MessagePort = globalThis.MessagePort;
injectFakeEmitter(_MessagePort);
var MessagePort = _MessagePort;
var resourceLimits = {};
var workerData = _workerData;
var threadId = _threadId;
var parentPort = isMainThread ? null : fakeParentPort();
var unsupportedOptions = [
  "eval",
  "argv",
  "execArgv",
  "stdin",
  "stdout",
  "stderr",
  "trackedUnmanagedFds",
  "resourceLimits"
];

class Worker extends EventEmitter {
  #worker;
  #performance;
  #onExitPromise = @undefined;
  constructor(filename, options = {}) {
    super();
    for (const key of unsupportedOptions) {
      if (key in options) {
        emitWarning("option." + key, `worker_threads.Worker option "${key}" is not implemented.`);
      }
    }
    this.#worker = new WebWorker(filename, options);
    this.#worker.addEventListener("close", this.#onClose.bind(this));
    this.#worker.addEventListener("error", this.#onError.bind(this));
    this.#worker.addEventListener("message", this.#onMessage.bind(this));
    this.#worker.addEventListener("messageerror", this.#onMessageError.bind(this));
    this.#worker.addEventListener("open", this.#onOpen.bind(this));
  }
  get threadId() {
    return this.#worker.threadId;
  }
  ref() {
    this.#worker.ref();
  }
  unref() {
    this.#worker.unref();
  }
  get stdin() {
    return null;
  }
  get stdout() {
    return null;
  }
  get stderr() {
    return null;
  }
  get performance() {
    return this.#performance ??= {
      eventLoopUtilization() {
        emitWarning("performance", "worker_threads.Worker.performance is not implemented.");
        return {
          idle: 0,
          active: 0,
          utilization: 0
        };
      }
    };
  }
  terminate() {
    const onExitPromise = this.#onExitPromise;
    if (onExitPromise) {
      return @isPromise(onExitPromise) ? onExitPromise : @Promise.resolve(onExitPromise);
    }
    const { resolve, promise } = @Promise.withResolvers();
    this.#worker.addEventListener("close", (event) => {
      resolve(event.code);
    }, { once: true });
    this.#worker.terminate();
    return this.#onExitPromise = promise;
  }
  postMessage(...args) {
    return this.#worker.postMessage(...args);
  }
  #onClose(e) {
    this.#onExitPromise = e.code;
    this.emit("exit", e.code);
  }
  #onError(error) {
    this.emit("error", error);
  }
  #onMessage(event) {
    this.emit("message", event.data);
  }
  #onMessageError(event) {
    this.emit("messageerror", event.error ?? event.data ?? event);
  }
  #onOpen() {
    this.emit("online");
  }
  async getHeapSnapshot() {
    throwNotImplemented("worker_threads.Worker.getHeapSnapshot");
  }
}
$ = {
  Worker,
  workerData,
  parentPort,
  resourceLimits,
  isMainThread,
  MessageChannel,
  BroadcastChannel,
  MessagePort,
  getEnvironmentData,
  setEnvironmentData,
  getHeapSnapshot() {
    return {};
  },
  markAsUntransferable,
  moveMessagePortToContext,
  receiveMessageOnPort,
  SHARE_ENV,
  threadId
};
return $})
