import EventEmitter from "node:events";
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
var { MessageChannel, MessagePort } = globalThis, isMainThread = Bun.isMainThread, [workerData, threadId] = globalThis[Symbol.for("Bun.lazy")]("worker_threads"), parentPort = isMainThread ? null : fakeParentPort(), resourceLimits = {}, WebWorker = globalThis.Worker;

class Worker extends EventEmitter {
  #worker;
  #performance;
  #onExitPromise = void 0;
  constructor(filename, options = {}) {
    super();
    this.#worker = new WebWorker(filename, options), this.#worker.addEventListener("close", this.#onClose.bind(this)), this.#worker.addEventListener("error", this.#onError.bind(this)), this.#worker.addEventListener("message", this.#onMessage.bind(this)), this.#worker.addEventListener("messageerror", this.#onMessageError.bind(this)), this.#worker.addEventListener("open", this.#onOpen.bind(this));
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
  parentPort,
  isMainThread,
  getEnvironmentData,
  worker_threads_default as default,
  Worker,
  MessagePort,
  MessageChannel
};
