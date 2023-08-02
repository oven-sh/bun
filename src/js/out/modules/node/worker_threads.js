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
    return listener[wrappedListener] = callback, callback;
  }
  function functionForEventType(event, listener) {
    switch (event) {
      case "error":
      case "messageerror":
        return wrapped(errorEventHandler, listener);
      default:
        return wrapped(messageEventHandler, listener);
    }
  }
  Class.prototype.on = function(event, listener) {
    return this.addEventListener(event, functionForEventType(event, listener)), this;
  }, Class.prototype.off = function(event, listener) {
    if (listener)
      this.removeEventListener(event, listener[wrappedListener] || listener);
    else
      this.removeEventListener(event);
    return this;
  }, Class.prototype.once = function(event, listener) {
    return this.addEventListener(event, functionForEventType(event, listener), { once: !0 }), this;
  };
  function EventClass(eventName) {
    if (eventName === "error" || eventName === "messageerror")
      return ErrorEvent;
    return MessageEvent;
  }
  Class.prototype.emit = function(event, ...args) {
    return this.dispatchEvent(new (EventClass(event))(event, ...args)), this;
  }, Class.prototype.prependListener = Class.prototype.on, Class.prototype.prependOnceListener = Class.prototype.once;
};
import EventEmitter from "node:events";
function receiveMessageOnPort(port) {
  let res = _receiveMessageOnPort(port);
  if (!res)
    return;
  return {
    message: res
  };
}
var fakeParentPort = function() {
  const fake = Object.create(MessagePort.prototype);
  return Object.defineProperty(fake, "onmessage", {
    get() {
      return self.onmessage;
    },
    set(value) {
      self.onmessage = value;
    }
  }), Object.defineProperty(fake, "onmessageerror", {
    get() {
      return self.onmessageerror;
    },
    set(value) {
    }
  }), Object.defineProperty(fake, "postMessage", {
    value(...args) {
      return self.postMessage(...args);
    }
  }), Object.defineProperty(fake, "close", {
    value() {
      return process.exit(0);
    }
  }), Object.defineProperty(fake, "start", {
    value() {
    }
  }), Object.defineProperty(fake, "unref", {
    value() {
    }
  }), Object.defineProperty(fake, "ref", {
    value() {
    }
  }), Object.defineProperty(fake, "hasRef", {
    value() {
      return !1;
    }
  }), Object.defineProperty(fake, "setEncoding", {
    value() {
    }
  }), Object.defineProperty(fake, "addEventListener", {
    value: self.addEventListener.bind(self)
  }), Object.defineProperty(fake, "removeEventListener", {
    value: self.removeEventListener.bind(self)
  }), fake;
};
function getEnvironmentData() {
  return process.env;
}
function setEnvironmentData(env) {
  process.env = env;
}
var { MessageChannel } = globalThis, _MessagePort = globalThis.MessagePort;
injectFakeEmitter(_MessagePort);
var MessagePort = _MessagePort, isMainThread = Bun.isMainThread, [_workerData, _threadId, _receiveMessageOnPort] = globalThis[Symbol.for("Bun.lazy")]("worker_threads"), parentPort = isMainThread ? null : fakeParentPort(), resourceLimits = {}, workerData = _workerData, threadId = _threadId, WebWorker = globalThis.Worker;

class Worker extends EventEmitter {
  #worker;
  #performance;
  #onExitPromise = void 0;
  constructor(filename, options = {}) {
    super();
    this.#worker = new WebWorker(filename, {
      ...options
    }), this.#worker.addEventListener("close", this.#onClose.bind(this)), this.#worker.addEventListener("error", this.#onError.bind(this)), this.#worker.addEventListener("message", this.#onMessage.bind(this)), this.#worker.addEventListener("messageerror", this.#onMessageError.bind(this)), this.#worker.addEventListener("open", this.#onOpen.bind(this));
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
        return {};
      }
    };
  }
  terminate() {
    if (this.#onExitPromise)
      return this.#onExitPromise;
    const { resolve, promise } = Promise.withResolvers();
    return this.#worker.addEventListener("close", (event) => {
      resolve(0);
    }, { once: !0 }), this.#onExitPromise = promise;
  }
  postMessage(...args) {
    return this.#worker.postMessage(...args);
  }
  #onClose() {
    this.emit("exit");
  }
  #onError(event) {
    this.emit("error", event);
  }
  #onMessage(event) {
    this.emit("message", event.data);
  }
  #onMessageError(event) {
    this.emit("messageerror", event.error || event);
  }
  #onOpen() {
    this.emit("online");
  }
  getHeapSnapshot() {
    return {};
  }
}
var worker_threads_default = {
  Worker,
  workerData,
  parentPort,
  resourceLimits,
  isMainThread,
  MessageChannel,
  MessagePort,
  getEnvironmentData,
  setEnvironmentData,
  getHeapSnapshot() {
    return {};
  },
  threadId
};
export {
  workerData,
  threadId,
  setEnvironmentData,
  resourceLimits,
  receiveMessageOnPort,
  parentPort,
  isMainThread,
  getEnvironmentData,
  worker_threads_default as default,
  Worker,
  MessagePort,
  MessageChannel
};
