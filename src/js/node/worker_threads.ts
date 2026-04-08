// import type { Readable, Writable } from "node:stream";
// import type { WorkerOptions } from "node:worker_threads";
declare const self: typeof globalThis;
type WebWorker = InstanceType<typeof globalThis.Worker>;

const EventEmitter = require("node:events");
const Readable = require("internal/streams/readable");
const { throwNotImplemented, warnNotImplementedOnce } = require("internal/shared");
const { validateNumber } = require("internal/validators");

const {
  MessageChannel,
  BroadcastChannel,
  Worker: WebWorker,
} = globalThis as typeof globalThis & {
  // The Worker constructor secretly takes an extra parameter to provide the node:worker_threads
  // instance. This is so that it can emit the `worker` event on the process with the
  // node:worker_threads instance instead of the Web Worker instance.
  Worker: new (...args: [...ConstructorParameters<typeof globalThis.Worker>, nodeWorker: Worker]) => WebWorker;
};
const SHARE_ENV = Symbol("nodejs.worker_threads.SHARE_ENV");

const isMainThread = Bun.isMainThread;
const {
  0: _workerData,
  1: _threadId,
  2: _receiveMessageOnPort,
  3: environmentData,
} = $cpp("Worker.cpp", "createNodeWorkerThreadsBinding") as [
  unknown,
  number,
  (port: unknown) => unknown,
  Map<unknown, unknown>,
];

type NodeWorkerOptions = import("node:worker_threads").WorkerOptions;

// Used to ensure that Blobs created to hold the source code for `eval: true` Workers get cleaned up
// after their Worker exits
let urlRevokeRegistry: FinalizationRegistry<string> | undefined = undefined;

function injectFakeEmitter(Class) {
  function messageEventHandler(event: MessageEvent) {
    return event.data;
  }

  function errorEventHandler(event: ErrorEvent) {
    return event.error;
  }

  function unwrapFor(event) {
    return event === "error" || event === "messageerror" ? errorEventHandler : messageEventHandler;
  }

  // Per-instance listener tracking: Map<event, Array<{ original, wrapped }>>.
  // Stored via a non-enumerable symbol on the instance so that listenerCount,
  // eventNames, and removeAllListeners work correctly. Matches Node's
  // MessagePort dedup semantics: adding the same (event, listener) pair more
  // than once is a no-op — first registration wins and keeps its once-ness.
  const kListeners = Symbol("bun:worker_threads:listeners");
  const kMaxListeners = Symbol("bun:worker_threads:maxListeners");

  function getListeners(target) {
    let map = target[kListeners];
    if (!map) {
      map = new Map();
      Object.defineProperty(target, kListeners, {
        value: map,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
    return map;
  }

  function hasListener(target, event, original) {
    const map = target[kListeners];
    if (!map) return false;
    const arr = map.$get(event);
    if (!arr) return false;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].original === original) return true;
    }
    return false;
  }

  function trackListener(target, event, original, wrapped) {
    const map = getListeners(target);
    let arr = map.$get(event);
    if (!arr) {
      arr = [];
      map.$set(event, arr);
    }
    arr.push({ original, wrapped });
  }

  function untrackListener(target, event, original) {
    const map = target[kListeners];
    if (!map) return null;
    const arr = map.$get(event);
    if (!arr) return null;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].original === original) {
        const [entry] = arr.splice(i, 1);
        if (arr.length === 0) map.$delete(event);
        return entry.wrapped;
      }
    }
    return null;
  }

  // Node's MessagePort (which is an EventTarget underneath) throws
  // ERR_INVALID_ARG_TYPE for listener arguments that are primitives other
  // than `undefined` / `null`. Functions and EventListener objects (with a
  // `handleEvent` method) pass through.
  function validateListener(listener) {
    const t = typeof listener;
    if (t !== "function" && t !== "object" && t !== "undefined") {
      throw $ERR_INVALID_ARG_TYPE("listener", "function", listener);
    }
  }

  // Build a wrapper that dispatches through either a bare function or the
  // DOM EventListener `handleEvent` method. Matches Node's MessagePort
  // behavior where `port.on('message', { handleEvent(m) { ... } })` is
  // accepted and forwards the unwrapped payload.
  function makeWrapped(listener, unwrap) {
    return function (e) {
      if (typeof listener === "function") {
        return listener.$call(this, unwrap(e));
      }
      if (listener != null && typeof listener.handleEvent === "function") {
        return listener.handleEvent(unwrap(e));
      }
      // Non-function, non-EventListener objects: silently drop (matches
      // EventTarget's behavior of ignoring the dispatch).
    };
  }

  Class.prototype.on = function (event, listener) {
    validateListener(listener);
    // Node's MessagePort dedupes same (event, listener) pairs (see #20169).
    if (hasListener(this, event, listener)) return this;
    const wrapped = makeWrapped(listener, unwrapFor(event));
    this.addEventListener(event, wrapped);
    trackListener(this, event, listener, wrapped);
    return this;
  };

  Class.prototype.off = function (event, listener) {
    validateListener(listener);
    const wrapped = untrackListener(this, event, listener);
    // If the listener was tracked, remove the wrapped version; otherwise
    // fall back to removing whatever matches directly (covers raw
    // addEventListener registrations).
    this.removeEventListener(event, wrapped || listener);
    return this;
  };

  Class.prototype.once = function (event, listener) {
    validateListener(listener);
    // Node's MessagePort dedupes here too — first registration wins.
    if (hasListener(this, event, listener)) return this;
    const unwrap = unwrapFor(event);
    const self = this;
    const wrapped = function (e) {
      // Untrack before invoking so listenerCount inside the handler is accurate.
      untrackListener(self, event, listener);
      if (typeof listener === "function") {
        return listener.$call(this, unwrap(e));
      }
      if (listener != null && typeof listener.handleEvent === "function") {
        return listener.handleEvent(unwrap(e));
      }
    };
    this.addEventListener(event, wrapped, { once: true });
    trackListener(this, event, listener, wrapped);
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

  Class.prototype.addListener = Class.prototype.on;
  Class.prototype.removeListener = Class.prototype.off;
  // Node's MessagePort does not expose prependListener / prependOnceListener,
  // but earlier Bun versions did — keep them as aliases for compatibility.
  Class.prototype.prependListener = Class.prototype.on;
  Class.prototype.prependOnceListener = Class.prototype.once;

  Class.prototype.removeAllListeners = function (event) {
    const map = this[kListeners];
    if (!map) return this;
    if (event === undefined) {
      // Snapshot keys first so we're not iterating a Map we're about to clear.
      const keys = [...map.$keys()];
      for (let i = 0; i < keys.length; i++) {
        const name = keys[i];
        const arr = map.$get(name);
        if (arr) {
          for (let j = 0; j < arr.length; j++) {
            this.removeEventListener(name, arr[j].wrapped);
          }
        }
      }
      map.$clear();
    } else {
      const arr = map.$get(event);
      if (arr) {
        for (let i = 0; i < arr.length; i++) {
          this.removeEventListener(event, arr[i].wrapped);
        }
        map.$delete(event);
      }
    }
    return this;
  };

  Class.prototype.listenerCount = function (event) {
    const map = this[kListeners];
    if (!map) return 0;
    const arr = map.$get(event);
    return arr ? arr.length : 0;
  };

  // Note: Node's MessagePort does NOT expose `listeners` or `rawListeners`,
  // so we don't install them here either — matching the `in`-check surface
  // exactly avoids library code that branches on their presence getting the
  // wrong Node path.

  Class.prototype.eventNames = function () {
    const map = this[kListeners];
    if (!map) return [];
    return [...map.$keys()];
  };

  Class.prototype.setMaxListeners = function (n) {
    validateNumber(n, "setMaxListeners", 0);
    Object.defineProperty(this, kMaxListeners, {
      value: n,
      writable: true,
      configurable: true,
      enumerable: false,
    });
    return this;
  };

  Class.prototype.getMaxListeners = function () {
    return this[kMaxListeners] ?? EventEmitter.defaultMaxListeners;
  };
}

const _MessagePort = globalThis.MessagePort;
injectFakeEmitter(_MessagePort);

const MessagePort = _MessagePort;

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

// TODO: parent port emulation is not complete
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
    set(value) {
      self.onmessageerror = value;
    },
  });

  const postMessage = $newCppFunction("ZigGlobalObject.cpp", "jsFunctionPostMessage", 1);
  Object.defineProperty(fake, "postMessage", {
    value(...args: [any, any]) {
      return postMessage.$apply(null, args);
    },
  });

  Object.defineProperty(fake, "close", {
    value() {},
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

  // NOTE: addListener / removeListener deliberately left off the instance —
  // they're installed on MessagePort.prototype by injectFakeEmitter with
  // per-instance tracking, and go through the own addEventListener /
  // removeEventListener above. Shadowing them with raw bindings would skip
  // tracking and leak wrapped closures on removeListener.

  return fake;
}
let parentPort: MessagePort | null = isMainThread ? null : fakeParentPort();

function getEnvironmentData(key: unknown): unknown {
  return environmentData.get(key);
}

function setEnvironmentData(key: unknown, value: unknown): void {
  if (value === undefined) {
    environmentData.delete(key);
  } else {
    environmentData.set(key, value);
  }
}

function markAsUntransferable() {
  throwNotImplemented("worker_threads.markAsUntransferable");
}

function moveMessagePortToContext() {
  throwNotImplemented("worker_threads.moveMessagePortToContext");
}

class Worker extends EventEmitter {
  #worker: WebWorker;
  #performance;

  // this is used by terminate();
  // either is the exit code if exited, a promise resolving to the exit code, or undefined if we haven't sent .terminate() yet
  #onExitPromise: Promise<number> | number | undefined = undefined;
  #urlToRevoke = "";

  constructor(filename: string, options: NodeWorkerOptions = {}) {
    super();

    const builtinsGeneratorHatesEval = "ev" + "a" + "l"[0];
    if (options && builtinsGeneratorHatesEval in options) {
      if (options[builtinsGeneratorHatesEval]) {
        // TODO: consider doing this step in native code and letting the Blob be cleaned up by the
        // C++ Worker object's destructor
        const blob = new Blob([filename], { type: "" });
        this.#urlToRevoke = filename = URL.createObjectURL(blob);
      } else {
        // if options.eval = false, allow the constructor below to fail, if
        // we convert the code to a blob, it will succeed.
        this.#urlToRevoke = filename;
      }
    }
    try {
      this.#worker = new WebWorker(filename, options as Bun.WorkerOptions, this);
    } catch (e) {
      if (this.#urlToRevoke) {
        URL.revokeObjectURL(this.#urlToRevoke);
      }
      throw e;
    }
    this.#worker.addEventListener("close", this.#onClose.bind(this), { once: true });
    this.#worker.addEventListener("error", this.#onError.bind(this));
    this.#worker.addEventListener("message", this.#onMessage.bind(this));
    this.#worker.addEventListener("messageerror", this.#onMessageError.bind(this));
    this.#worker.addEventListener("open", this.#onOpen.bind(this), { once: true });

    if (this.#urlToRevoke) {
      if (!urlRevokeRegistry) {
        urlRevokeRegistry = new FinalizationRegistry<string>(url => {
          URL.revokeObjectURL(url);
        });
      }
      urlRevokeRegistry.register(this.#worker, this.#urlToRevoke);
    }
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
        warnNotImplementedOnce("worker_threads.Worker.performance");
        return {
          idle: 0,
          active: 0,
          utilization: 0,
        };
      },
    });
  }

  terminate(callback: unknown) {
    if (typeof callback === "function") {
      process.emitWarning(
        "Passing a callback to worker.terminate() is deprecated. It returns a Promise instead.",
        "DeprecationWarning",
        "DEP0132",
      );
      this.#worker.addEventListener("close", event => callback(null, event.code), { once: true });
    }

    const onExitPromise = this.#onExitPromise;
    if (onExitPromise) {
      return $isPromise(onExitPromise) ? onExitPromise : Promise.$resolve(onExitPromise);
    }

    const { resolve, promise } = Promise.withResolvers();
    this.#worker.addEventListener(
      "close",
      event => {
        resolve(event.code);
      },
      { once: true },
    );
    this.#worker.terminate();

    return (this.#onExitPromise = promise);
  }

  postMessage(...args: [any, any]) {
    return this.#worker.postMessage.$apply(this.#worker, args);
  }

  getHeapSnapshot(options: unknown) {
    const stringPromise = this.#worker.getHeapSnapshot(options);
    return stringPromise.then(s => new HeapSnapshotStream(s));
  }

  #onClose(e) {
    this.#onExitPromise = e.code;
    this.emit("exit", e.code);
  }

  #onError(event: ErrorEvent) {
    let error = event?.error;
    // if the thrown value serialized successfully, the message will be empty
    // if not the message is the actual error
    if (event.message !== "") {
      error = new Error(event.message, { cause: event });
      const stack = event?.stack;
      if (stack) {
        error.stack = stack;
      }
    }
    this.emit("error", error);
  }

  #onMessage(event: MessageEvent) {
    // TODO: is this right?
    this.emit("message", event.data);
  }

  #onMessageError(event: MessageEvent) {
    // TODO: is this right?
    this.emit("messageerror", (event as any).error ?? event.data ?? event);
  }

  #onOpen() {
    this.emit("online");
  }

  async [Symbol.asyncDispose]() {
    await this.terminate();
  }
}

class HeapSnapshotStream extends Readable {
  #json: string | undefined;

  constructor(json: string) {
    super();
    this.#json = json;
  }

  _read() {
    if (this.#json !== undefined) {
      this.push(this.#json);
      this.push(null);
      this.#json = undefined;
    }
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
