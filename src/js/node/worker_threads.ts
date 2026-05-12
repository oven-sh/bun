// import type { Readable, Writable } from "node:stream";
// import type { WorkerOptions } from "node:worker_threads";
declare const self: typeof globalThis;
type WebWorker = InstanceType<typeof globalThis.Worker>;

const EventEmitter = require("node:events");
const Readable = require("internal/streams/readable");
const { throwNotImplemented, warnNotImplementedOnce } = require("internal/shared");

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

  const postMessage = $newCppFunction("ZigGlobalObject.cpp", "jsFunctionPostMessage", 1);
  // Adjust the worker event loop's concurrent ref count by the given delta. Used to implement
  // Node's ref/unref/close semantics on top of the WorkerGlobalScope auto-ref (see
  // BunWorkerGlobalScope.cpp), which takes one ref while any "message" listener is installed on
  // `self` and can't express "deliver messages but don't keep the loop alive".
  const incEventLoopRef = $newCppFunction("Worker.cpp", "jsFunctionNodeWorkerIncRef", 1);

  // Node: parentPort starts unref'd; adding a "message" listener or calling ref() refs it.
  let hasRefFlag = false;
  let closed = false;

  // For each event type parentPort forwards ("message", "messageerror"), we keep our own
  // listener list and install a single forwarder on `self`. Installing a "message" listener on
  // `self` contributes one auto-ref via WorkerGlobalScope; we cancel it out so the ref is purely
  // driven by hasRefFlag/closed below.
  const listeners: { message: Function[]; messageerror: Function[] } = {
    message: [],
    messageerror: [],
  };
  // onmessage/onmessageerror are stored in the same arrays so dispatch preserves registration
  // order relative to addEventListener, matching Node. These point at the current entries (or
  // null) so the setters can replace/remove them.
  const onmessageEntry: { message: Function | null; messageerror: Function | null } = {
    message: null,
    messageerror: null,
  };
  const forwarderInstalled: { message: boolean; messageerror: boolean } = {
    message: false,
    messageerror: false,
  };
  const forwarders = {
    message(event: MessageEvent) {
      dispatch("message", event);
    },
    messageerror(event: MessageEvent) {
      dispatch("messageerror", event);
    },
  };

  // Adjustment we've applied on top of the WorkerGlobalScope auto-ref. In steady state this is
  // (hasRefFlag && !closed ? 1 : 0) - (message forwarder installed ? 1 : 0).
  let refAdjustment = 0;

  function syncRef() {
    const want = hasRefFlag && !closed ? 1 : 0;
    const auto = forwarderInstalled.message ? 1 : 0;
    const target = want - auto;
    const delta = target - refAdjustment;
    if (delta !== 0) {
      incEventLoopRef(delta);
      refAdjustment = target;
    }
  }

  function ensureForwarder(type: "message" | "messageerror") {
    if (closed || forwarderInstalled[type] || listeners[type].length === 0) return;
    // Install first (auto-ref +1 for "message"), then cancel it in syncRef(); the concurrent ref
    // never dips below its prior value.
    self.addEventListener(type, forwarders[type]);
    forwarderInstalled[type] = true;
    syncRef();
  }

  function dropForwarder(type: "message" | "messageerror") {
    if (!forwarderInstalled[type]) return;
    // Undo our -1 adjustment first so removing the listener (auto-ref -1) doesn't momentarily
    // take the concurrent ref negative.
    forwarderInstalled[type] = false;
    syncRef();
    self.removeEventListener(type, forwarders[type]);
  }

  function invoke(entry, event: MessageEvent) {
    if (typeof entry === "function") {
      entry.$call(fake, event);
    } else {
      // { handleEvent } listener-object form.
      entry.handleEvent.$call(entry, event);
    }
  }

  function dispatch(type: "message" | "messageerror", event: MessageEvent) {
    if (closed) return;
    // Copy so listeners added/removed during dispatch don't affect this round.
    const list = listeners[type].slice();
    for (let i = 0; i < list.length; i++) {
      // Isolate exceptions per listener: pre-PR each listener was a separate native
      // EventTarget registration (which does this), and Node's NodeEventTarget does the same.
      // A throw from one handler must not prevent later handlers from running. Re-throw on
      // nextTick so it surfaces as an uncaught exception after the whole batch has run
      // (reportError() inside a worker currently terminates the worker synchronously, so it
      // can't be used here).
      try {
        invoke(list[i], event);
      } catch (e) {
        process.nextTick(err => {
          throw err;
        }, e);
      }
    }
  }

  function addEventListener(type: string, listener, options?) {
    if (type !== "message" && type !== "messageerror") {
      // Non-message events ("close", etc.) go straight to `self`; they don't touch the auto-ref.
      self.addEventListener(type, listener, options);
      return;
    }
    if (closed) return;
    if (typeof listener !== "function") {
      if (listener == null || typeof listener !== "object" || typeof listener.handleEvent !== "function") return;
    }
    let entry = listener;
    if (options && typeof options === "object" && options.once) {
      entry = function (event) {
        removeEventListener(type, entry);
        invoke(listener, event);
      };
      // Remember the wrapper so removeEventListener(listener) before it fires still works.
      listener[kOnceWrapper] = entry;
    } else if (listeners[type].lastIndexOf(entry) !== -1) {
      // DOM EventTarget dedup: a non-once listener already registered is a no-op. (.on() from
      // injectFakeEmitter wraps every call so it never hits this path — Node EventEmitter
      // allows duplicates and that still works.)
      return;
    }
    listeners[type].push(entry);
    // Node: adding a 'message' or 'messageerror' listener refs the port.
    hasRefFlag = true;
    ensureForwarder(type);
    syncRef();
  }

  function removeEventListener(type: string, listener?) {
    if (type !== "message" && type !== "messageerror") {
      self.removeEventListener(type, listener);
      return;
    }
    const list = listeners[type];
    if (listener) {
      const wrapper = listener[kOnceWrapper];
      let idx = wrapper !== undefined ? list.lastIndexOf(wrapper) : -1;
      if (idx === -1) idx = list.lastIndexOf(listener);
      if (idx !== -1) list.splice(idx, 1);
      // Drop the stale wrapper reference so re-adding the same function without {once} and
      // then removing it resolves to the right entry.
      if (wrapper !== undefined) listener[kOnceWrapper] = undefined;
    } else {
      list.length = 0;
    }
    if (list.length === 0) dropForwarder(type);
    afterListenerRemoved();
  }

  function afterListenerRemoved() {
    // Node: once no 'message'/'messageerror' listeners remain, the port is implicitly unref'd
    // (regardless of any prior explicit ref()).
    if (listeners.message.length === 0 && listeners.messageerror.length === 0) hasRefFlag = false;
    syncRef();
  }

  const kOnceWrapper = Symbol("kOnceWrapper");

  function setOnHandler(type: "message" | "messageerror", value) {
    const old = onmessageEntry[type];
    if (old !== null) {
      const idx = listeners[type].lastIndexOf(old);
      if (idx !== -1) listeners[type].splice(idx, 1);
    }
    if (typeof value === "function") {
      onmessageEntry[type] = value;
      if (!closed) {
        listeners[type].push(value);
        hasRefFlag = true;
        ensureForwarder(type);
      }
      syncRef();
    } else {
      onmessageEntry[type] = null;
      if (listeners[type].length === 0) dropForwarder(type);
      afterListenerRemoved();
    }
  }

  Object.defineProperty(fake, "onmessage", {
    get() {
      return onmessageEntry.message;
    },
    set(value) {
      setOnHandler("message", value);
    },
  });

  Object.defineProperty(fake, "onmessageerror", {
    get() {
      return onmessageEntry.messageerror;
    },
    set(value) {
      setOnHandler("messageerror", value);
    },
  });

  Object.defineProperty(fake, "postMessage", {
    value(...args: [any, any]) {
      if (closed) return;
      return postMessage.$apply(null, args);
    },
  });

  Object.defineProperty(fake, "close", {
    value() {
      if (closed) return;
      closed = true;
      // Schedule the 'close' event before tearing down forwarders so it runs on this tick's
      // nextTick queue even if removing the "message" forwarder drops the last loop ref.
      process.nextTick(() => {
        self.dispatchEvent(new Event("close"));
      });
      listeners.message.length = 0;
      listeners.messageerror.length = 0;
      onmessageEntry.message = null;
      onmessageEntry.messageerror = null;
      dropForwarder("message");
      dropForwarder("messageerror");
      syncRef();
    },
  });

  Object.defineProperty(fake, "start", {
    value() {},
  });

  Object.defineProperty(fake, "ref", {
    value() {
      if (hasRefFlag) return;
      hasRefFlag = true;
      syncRef();
    },
  });

  Object.defineProperty(fake, "unref", {
    value() {
      if (!hasRefFlag) return;
      hasRefFlag = false;
      syncRef();
    },
  });

  Object.defineProperty(fake, "hasRef", {
    value() {
      return hasRefFlag;
    },
  });

  Object.defineProperty(fake, "setEncoding", {
    value() {},
  });

  Object.defineProperty(fake, "addEventListener", {
    value: addEventListener,
  });

  Object.defineProperty(fake, "removeEventListener", {
    value: removeEventListener,
  });

  Object.defineProperty(fake, "addListener", {
    value: addEventListener,
    enumerable: false,
  });

  Object.defineProperty(fake, "removeListener", {
    value: removeEventListener,
    enumerable: false,
  });

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
