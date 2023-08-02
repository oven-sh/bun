export const { MessageChannel, MessagePort } = globalThis;

import EventEmitter from "node:events";
export const isMainThread = Bun.isMainThread;
export let [workerData, threadId] = $lazy("worker_threads");
export let parentPort: MessagePort | null = isMainThread ? null : fakeParentPort();
export let resourceLimits = {};

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

export function getEnvironmentData() {
  return process.env;
}

export function setEnvironmentData(env: any) {
  process.env = env;
}

const WebWorker = globalThis.Worker;
export class Worker extends EventEmitter {
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
  MessagePort,
  getEnvironmentData,
  setEnvironmentData,
  getHeapSnapshot() {
    return {};
  },

  threadId,
};
