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

// TODO: parent port emulation is not complete
function fakeParentPort() {
  // Node's `parentPort` has its own message dispatch that is independent of the
  // worker's global scope. Bun's native worker runtime dispatches parent messages
  // onto the global scope (`self.onmessage` / `self.addEventListener('message')`),
  // which matches web-worker semantics but not Node's — and it means emscripten-
  // style code that does
  //
  //   parentPort.on('message', (m) => onmessage({ data: m }));
  //   self.onmessage = handleMessage;
  //
  // sees every message delivered TWICE: once by the automatic `self.onmessage`
  // dispatch and once by the explicit forwarding inside the `parentPort.on`
  // listener. See https://github.com/oven-sh/bun/issues/29211.
  //
  // Fix: give `parentPort` its own `EventTarget`, re-dispatch incoming messages
  // on it, and stop the native dispatch from reaching `self.onmessage` /
  // `self.addEventListener('message', …)` so it matches Node semantics.
  const fake = Object.create(MessagePort.prototype);
  const parentPortTarget = new EventTarget();

  // Forwarders: installed lazily on `self` only while at least one user
  // listener is registered on the parentPort. They intercept the native
  // parent-message dispatch, stop immediate propagation (so `self.onmessage`
  // and `self.addEventListener('message', …)` handlers on the global scope
  // never see parent messages — matching Node), and re-dispatch on
  // `parentPortTarget`. Installing a `message` listener on `self` keeps the
  // event loop alive via `onDidChangeListenerImpl` in
  // `BunWorkerGlobalScope.cpp`, so we only install while parentPort is
  // actually being used — that way a worker that never touches `parentPort`
  // exits cleanly when its module finishes executing.
  //
  // `onmessage` / `onmessageerror` are spec'd as implicit event listeners: the
  // setter replaces at most one listener, firing in the order it was first
  // assigned relative to other listeners on the same target.
  let parentPortOnMessageWrapper: ((event: Event) => void) | null = null;
  let parentPortOnMessageHandler: ((event: MessageEvent) => unknown) | null = null;
  let parentPortOnMessageErrorWrapper: ((event: Event) => void) | null = null;
  let parentPortOnMessageErrorHandler: ((event: MessageEvent) => unknown) | null = null;

  let listenerCount = 0;
  let messageForwarder: ((event: Event) => void) | null = null;
  let messageErrorForwarder: ((event: Event) => void) | null = null;

  function installForwarders() {
    if (messageForwarder !== null) return;
    const makeForwarder = (type: "message" | "messageerror") => (event: Event) => {
      // Stop the native dispatch from reaching `self.onmessage` and any
      // `self.addEventListener('message', …)` handlers — in Node parent
      // messages are only visible through `parentPort`, not through the
      // global scope.
      event.stopImmediatePropagation();
      const messageEvent = event as MessageEvent;
      // Preserve `ports` so `worker.postMessage(data, [port])` still surfaces
      // the transferred MessagePort(s) to `parentPort` listeners.
      const nativePorts = messageEvent.ports;
      const clone = new MessageEvent(type, {
        data: messageEvent.data,
        ports: nativePorts && nativePorts.length > 0 ? $Array.from(nativePorts) : undefined,
      });
      parentPortTarget.dispatchEvent(clone);
    };
    messageForwarder = makeForwarder("message");
    messageErrorForwarder = makeForwarder("messageerror");
    // Capture phase so we run before any user-installed bubbling listener
    // on the global scope (if any).
    self.addEventListener("message", messageForwarder, { capture: true });
    self.addEventListener("messageerror", messageErrorForwarder, { capture: true });
  }

  function uninstallForwarders() {
    if (messageForwarder === null) return;
    self.removeEventListener("message", messageForwarder, { capture: true } as any);
    self.removeEventListener("messageerror", messageErrorForwarder!, { capture: true } as any);
    messageForwarder = null;
    messageErrorForwarder = null;
  }

  function acquireListener() {
    if (listenerCount++ === 0) {
      installForwarders();
    }
  }

  function releaseListener() {
    if (listenerCount > 0 && --listenerCount === 0) {
      uninstallForwarders();
    }
  }

  // Wrap `addEventListener` / `removeEventListener` so we can track user
  // listener lifetime on `parentPortTarget` and install / uninstall the
  // forwarders on the global scope accordingly. Each (listener, type, capture)
  // triple gets wrapped exactly once — duplicate adds are no-ops per the DOM
  // spec — and the original listener object is the map key so that a
  // `remove(type, original, {capture})` call finds the wrapped copy.
  type TrackEntry = { wrapped: EventListener; once: boolean };
  // `${type}:${capture ? 1 : 0}` — a listener registered with different
  // (type, capture) combinations lives in separate slots, matching spec.
  const trackedByListener = new WeakMap<object, Map<string, TrackEntry>>();

  function listenerSlot(type: string, capture: boolean): string {
    return capture ? type + ":1" : type + ":0";
  }

  function invokeListener(listener: EventListener | EventListenerObject, event: Event): void {
    // DOM EventTarget accepts either a bare function or an object with a
    // `handleEvent` method. Dispatch correctly for both forms.
    if (typeof listener === "function") {
      (listener as any).$call(fake, event);
    } else if (listener !== null && typeof listener === "object" && typeof (listener as any).handleEvent === "function") {
      (listener as any).handleEvent.$call(listener, event);
    }
  }

  function parentPortAddEventListener(
    type: string,
    listener: EventListener | EventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (listener === null || listener === undefined) return;
    const capture = typeof options === "boolean" ? options : !!options?.capture;
    const once = typeof options === "object" && options !== null && !!options.once;
    // `AbortSignal` auto-removal is driven from the native EventTarget in C++,
    // so it would bypass our JS `parentPortRemoveEventListener` wrapper and
    // leak the event-loop refcount our capture forwarder holds on `self`.
    // Strip the signal from the options we pass inward and re-implement abort
    // ourselves via an abort listener that routes through the JS remove path.
    const signal =
      typeof options === "object" && options !== null ? ((options as AddEventListenerOptions).signal ?? null) : null;
    if (signal && signal.aborted) return;
    // Only `message` / `messageerror` events are dispatched on `self` by the
    // native worker runtime — all other event types (`close`, `error`, …)
    // live purely on `parentPortTarget` and don't need the capture forwarder
    // at all. Gating on `tracksForwarder` stops us from installing the
    // forwarder (and leaking `listenerCount`) for unrelated event types.
    const tracksForwarder = type === "message" || type === "messageerror";
    const slot = listenerSlot(type, capture);
    let bucket = trackedByListener.get(listener as object);
    if (bucket?.$has(slot)) {
      // Duplicate add — EventTarget already dedupes, so no-op.
      return;
    }
    // Wrap so we can release the loop ref when the listener is removed,
    // including the implicit removal done by `{ once: true }` after firing.
    const wrapped: EventListener = function (event) {
      if (once) {
        const bucketNow = trackedByListener.get(listener as object);
        if (bucketNow?.$get(slot) === entry) {
          bucketNow.$delete(slot);
          if (bucketNow.$size === 0) trackedByListener.delete(listener as object);
          if (tracksForwarder) releaseListener();
        }
      }
      invokeListener(listener, event);
    };
    const entry: TrackEntry = { wrapped, once };
    if (!bucket) {
      bucket = new Map();
      trackedByListener.set(listener as object, bucket);
    }
    bucket.$set(slot, entry);
    const innerOptions: boolean | AddEventListenerOptions =
      typeof options === "object" && options !== null ? { ...options, signal: undefined } : (options ?? false);
    parentPortTarget.addEventListener(type, wrapped, innerOptions);
    if (tracksForwarder) acquireListener();
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          parentPortRemoveEventListener(type, listener, { capture });
        },
        { once: true },
      );
    }
  }

  function parentPortRemoveEventListener(
    type: string,
    listener: EventListener | EventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    if (listener === null || listener === undefined) return;
    const capture = typeof options === "boolean" ? options : !!options?.capture;
    const bucket = trackedByListener.get(listener as object);
    if (!bucket) return;
    const slot = listenerSlot(type, capture);
    const entry = bucket.$get(slot);
    if (!entry) return;
    bucket.$delete(slot);
    if (bucket.$size === 0) trackedByListener.delete(listener as object);
    parentPortTarget.removeEventListener(type, entry.wrapped, options);
    if (type === "message" || type === "messageerror") releaseListener();
  }

  Object.defineProperty(fake, "onmessage", {
    get() {
      return parentPortOnMessageHandler;
    },
    set(value) {
      // Replace the previously-installed wrapper, if any.
      if (parentPortOnMessageWrapper !== null) {
        parentPortTarget.removeEventListener("message", parentPortOnMessageWrapper);
        parentPortOnMessageWrapper = null;
        releaseListener();
      }
      parentPortOnMessageHandler = typeof value === "function" ? value : null;
      if (parentPortOnMessageHandler !== null) {
        const handler = parentPortOnMessageHandler;
        parentPortOnMessageWrapper = (event: Event) => {
          try {
            handler.$call(fake, event as MessageEvent);
          } catch (err) {
            queueMicrotask(() => {
              throw err;
            });
          }
        };
        parentPortTarget.addEventListener("message", parentPortOnMessageWrapper);
        acquireListener();
      }
    },
  });

  Object.defineProperty(fake, "onmessageerror", {
    get() {
      return parentPortOnMessageErrorHandler;
    },
    set(value) {
      if (parentPortOnMessageErrorWrapper !== null) {
        parentPortTarget.removeEventListener("messageerror", parentPortOnMessageErrorWrapper);
        parentPortOnMessageErrorWrapper = null;
        releaseListener();
      }
      parentPortOnMessageErrorHandler = typeof value === "function" ? value : null;
      if (parentPortOnMessageErrorHandler !== null) {
        const handler = parentPortOnMessageErrorHandler;
        parentPortOnMessageErrorWrapper = (event: Event) => {
          try {
            handler.$call(fake, event as MessageEvent);
          } catch (err) {
            queueMicrotask(() => {
              throw err;
            });
          }
        };
        parentPortTarget.addEventListener("messageerror", parentPortOnMessageErrorWrapper);
        acquireListener();
      }
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
    value: parentPortAddEventListener,
  });

  Object.defineProperty(fake, "removeEventListener", {
    value: parentPortRemoveEventListener,
  });

  Object.defineProperty(fake, "dispatchEvent", {
    value: parentPortTarget.dispatchEvent.bind(parentPortTarget),
  });

  Object.defineProperty(fake, "removeListener", {
    value: parentPortRemoveEventListener,
    enumerable: false,
  });

  Object.defineProperty(fake, "addListener", {
    value: parentPortAddEventListener,
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
