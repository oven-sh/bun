import EventEmitter from "node:events";
function getEnvironmentData() {
  return process.env;
}
function setEnvironmentData(env) {
  process.env = env;
}
var [workerData, threadId] = globalThis[Symbol.for("Bun.lazy")]("worker_threads"), parentPort = null, resourceLimits = {}, isMainThread = Bun.isMainThread, WebWorker = globalThis.Worker;

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
  Worker
};
