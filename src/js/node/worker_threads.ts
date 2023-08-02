const { MessageChannel, BroadcastChannel } = globalThis;

function injectFakeEmitter(Class) {
  function messageEventHandler(event: MessageEvent) {
    return event.data;
  }

  function errorEventHandler(event: ErrorEvent) {
    return event.error;
  }

  const wrappedListener = Symbol("wrappedListener");

  function wrapped(run, listener) {
    const callback = function (event) {
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

  Class.prototype.on = function (event, listener) {
    this.addEventListener(event, functionForEventType(event, listener));

    return this;
  };

  Class.prototype.off = function (event, listener) {
    if (listener) {
      this.removeEventListener(event, listener[wrappedListener] || listener);
    } else {
      this.removeEventListener(event);
    }

    return this;
  };

  Class.prototype.once = function (event, listener) {
    this.addEventListener(event, functionForEventType(event, listener), { once: true });

    return this;
  };

  function EventClass(eventName) {
    if (eventName === "error" || eventName === "messageerror") {
      return ErrorEvent;
    }

    return MessageEvent;
  }

  Class.prototype.emit = function (event, ...args) {
    this.dispatchEvent(new (EventClass(event))(event, ...args));
    return this;
  };

  Class.prototype.prependListener = Class.prototype.on;
  Class.prototype.prependOnceListener = Class.prototype.once;
}

const _MessagePort = globalThis.MessagePort;
injectFakeEmitter(_MessagePort);

const MessagePort = _MessagePort;

const EventEmitter = require("node:events");
const isMainThread = Bun.isMainThread;
let [_workerData, _threadId, _receiveMessageOnPort] = $lazy("worker_threads");
let parentPort: MessagePort | null = isMainThread ? null : fakeParentPort();
let resourceLimits = {};

let workerData = _workerData;
let threadId = _threadId;
function receiveMessageOnPort(port: MessagePort) {
  let res = _receiveMessageOnPort(port);
  if (!res) return undefined;
  return {
    message: res,
  };
}

function fakeParentPort() {
  const fake = Object.create(MessagePort.prototype);
  Object.defineProperty(fake, "onmessage", {
    get() {
      return self.onmessage;
    },
    set(value) {
      self.onmessage = value;
    },
  });

  Object.defineProperty(fake, "onmessageerror", {
    get() {
      return self.onmessageerror;
    },
    set(value) {},
  });

  Object.defineProperty(fake, "postMessage", {
    value(...args: any[]) {
      return self.postMessage(...args);
    },
  });

  Object.defineProperty(fake, "close", {
    value() {
      return process.exit(0);
    },
  });

  Object.defineProperty(fake, "start", {
    value() {},
  });

  Object.defineProperty(fake, "unref", {
    value() {},
  });

  Object.defineProperty(fake, "ref", {
    value() {},
  });

  Object.defineProperty(fake, "hasRef", {
    value() {
      return false;
    },
  });

  Object.defineProperty(fake, "setEncoding", {
    value() {},
  });

  Object.defineProperty(fake, "addEventListener", {
    value: self.addEventListener.bind(self),
  });

  Object.defineProperty(fake, "removeEventListener", {
    value: self.removeEventListener.bind(self),
  });

  return fake;
}

function getEnvironmentData() {
  return process.env;
}

function setEnvironmentData(env: any) {
  process.env = env;
}

function markAsUntransferable() {
  throw new Error("markAsUntransferable is not implemented");
}

function moveMessagePortToContext() {
  throw new Error("moveMessagePortToContext is not implemented");
}

const SHARE_ENV = Symbol("nodejs.worker_threads.SHARE_ENV");

const WebWorker = globalThis.Worker;
class Worker extends EventEmitter {
  #worker: globalThis.Worker;
  #performance;
  #onExitPromise = undefined;

  constructor(filename: string, options: any = {}) {
    super();

    this.#worker = new WebWorker(filename, {
      ...options,
    });
    this.#worker.addEventListener("close", this.#onClose.bind(this));
    this.#worker.addEventListener("error", this.#onError.bind(this));
    this.#worker.addEventListener("message", this.#onMessage.bind(this));
    this.#worker.addEventListener("messageerror", this.#onMessageError.bind(this));
    this.#worker.addEventListener("open", this.#onOpen.bind(this));
  }

  ref() {
    this.#worker.ref();
  }

  unref() {
    this.#worker.unref();
  }

  get stdin() {
    // TODO:
    return null;
  }

  get stdout() {
    // TODO:
    return null;
  }

  get stderr() {
    // TODO:
    return null;
  }

  get performance() {
    return (this.#performance ??= {
      eventLoopUtilization() {
        return {};
      },
    });
  }

  terminate() {
    if (this.#onExitPromise) {
      return this.#onExitPromise;
    }

    const { resolve, promise } = Promise.withResolvers();
    this.#worker.addEventListener(
      "close",
      event => {
        // TODO: exit code
        resolve(0);
      },
      { once: true },
    );

    return (this.#onExitPromise = promise);
  }

  postMessage(...args: any[]) {
    return this.#worker.postMessage(...args);
  }

  #onClose() {
    this.emit("exit");
  }

  #onError(event: ErrorEvent) {
    // TODO: is this right?
    this.emit("error", event);
  }

  #onMessage(event: MessageEvent) {
    // TODO: is this right?
    this.emit("message", event.data);
  }

  #onMessageError(event: Event) {
    // TODO: is this right?
    this.emit("messageerror", event.error || event);
  }

  #onOpen() {
    // TODO: is this right?
    this.emit("online");
  }

  getHeapSnapshot() {
    return {};
  }
}
export default {
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

  threadId,
};
