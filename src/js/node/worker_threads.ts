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

  // Separate counters per event type — installing a `message` listener on
  // `self` keeps the event loop alive (via `onDidChangeListenerImpl` in
  // `BunWorkerGlobalScope.cpp`, which only tracks `messageEvent`), so a
  // worker that only registers a `messageerror` handler must NOT pull in the
  // `message` forwarder.
  let messageListenerCount = 0;
  let messageErrorListenerCount = 0;
  let messageForwarder: ((event: Event) => void) | null = null;
  let messageErrorForwarder: ((event: Event) => void) | null = null;

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

  function installMessageForwarder() {
    if (messageForwarder !== null) return;
    messageForwarder = makeForwarder("message");
    // Capture phase so we run before any user-installed bubbling listener
    // on the global scope (if any).
    self.addEventListener("message", messageForwarder, { capture: true });
  }
  function uninstallMessageForwarder() {
    if (messageForwarder === null) return;
    self.removeEventListener("message", messageForwarder, { capture: true } as any);
    messageForwarder = null;
  }
  function installMessageErrorForwarder() {
    if (messageErrorForwarder !== null) return;
    messageErrorForwarder = makeForwarder("messageerror");
    self.addEventListener("messageerror", messageErrorForwarder, { capture: true });
  }
  function uninstallMessageErrorForwarder() {
    if (messageErrorForwarder === null) return;
    self.removeEventListener("messageerror", messageErrorForwarder, { capture: true } as any);
    messageErrorForwarder = null;
  }

  function acquireListener(type: "message" | "messageerror") {
    if (type === "message") {
      if (messageListenerCount++ === 0) installMessageForwarder();
    } else {
      if (messageErrorListenerCount++ === 0) installMessageErrorForwarder();
    }
  }

  function releaseListener(type: "message" | "messageerror") {
    if (type === "message") {
      if (messageListenerCount > 0 && --messageListenerCount === 0) uninstallMessageForwarder();
    } else {
      if (messageErrorListenerCount > 0 && --messageErrorListenerCount === 0) uninstallMessageErrorForwarder();
    }
  }

  // Listener tracking.
  //
  // Every user-registered listener is wrapped before it's handed to
  // `parentPortTarget.addEventListener`, so we can (a) release the
  // event-loop ref held by our capture forwarder when the listener is
  // removed — including the implicit removal done by `{ once: true }`
  // after firing — and (b) pre-transform the event for Node-style
  // emitter listeners (`on`/`once`/`addListener`) which receive
  // `event.data` / `event.error` rather than the raw `MessageEvent`.
  //
  // Entries are grouped by the ORIGINAL user listener (the function or
  // handleEvent-bearing object the user handed us). Keying by the
  // wrapped callback would break `off(type, fn)`: the removal path only
  // sees the original `fn`, not the wrapper we internally created.
  //
  // `on` / `addEventListener` share a single registration list per
  // `(listener, type, capture)` triple, matching Node's behavior where
  // `removeListener` and `removeEventListener` are aliases operating on
  // the same underlying list. A registration records the "style" used at
  // register time so the right calling convention is used when it fires.
  // Node's EventEmitter-style `on` allows duplicate registrations of the
  // same `fn` — each `removeListener` call removes at most one (LIFO).
  type EntryStyle = "dom" | "emitter";
  type TrackEntry = {
    wrapped: EventListener;
    style: EntryStyle;
    once: boolean;
    forwarderType: "message" | "messageerror" | null;
    // Set to `true` once the entry has been evicted, so the wrapper is
    // a no-op if it's scheduled to fire after eviction and the
    // forwarder-release bookkeeping is idempotent against repeat calls.
    removed: boolean;
  };
  // slot key: `${type}:${capture ? 1 : 0}`
  const trackedByListener = new WeakMap<object, Map<string, TrackEntry[]>>();

  function listenerSlot(type: string, capture: boolean): string {
    return type + ":" + (capture ? "1" : "0");
  }

  function invokeDomListener(listener: EventListener | EventListenerObject, event: Event): void {
    // DOM EventTarget accepts either a bare function or an object with a
    // `handleEvent` method. Dispatch correctly for both forms.
    if (typeof listener === "function") {
      (listener as any).$call(fake, event);
    } else if (listener !== null && typeof listener === "object" && typeof (listener as any).handleEvent === "function") {
      (listener as any).handleEvent.$call(listener, event);
    }
  }

  // `on`/`once`/`addListener`-registered listeners receive the unwrapped
  // payload (`event.data` for message events, `event.error` for error
  // events) instead of the raw Event — emulating Node's EventEmitter
  // calling convention on a MessagePort-like object.
  function invokeEmitterListener(
    type: string,
    listener: EventListener | EventListenerObject,
    event: Event,
  ): void {
    let payload: unknown;
    if (type === "error" || type === "messageerror") {
      payload = (event as ErrorEvent).error;
    } else {
      payload = (event as MessageEvent).data;
    }
    if (typeof listener === "function") {
      (listener as any).$call(fake, payload);
    } else if (listener !== null && typeof listener === "object" && typeof (listener as any).handleEvent === "function") {
      (listener as any).handleEvent.$call(listener, payload);
    }
  }

  function getBucket(listener: object): Map<string, TrackEntry[]> | undefined {
    return trackedByListener.get(listener);
  }

  function getOrCreateBucket(listener: object): Map<string, TrackEntry[]> {
    let bucket = trackedByListener.get(listener);
    if (!bucket) {
      bucket = new Map<string, TrackEntry[]>();
      trackedByListener.set(listener, bucket);
    }
    return bucket;
  }

  // Remove exactly the entry `target` from `listener`'s bucket at `slot`,
  // release the forwarder, and clean up the bucket if it becomes empty.
  // Idempotent — a no-op if the entry is already gone.
  function evictEntry(
    listener: object,
    slot: string,
    target: TrackEntry,
  ): boolean {
    if (target.removed) return false;
    const bucket = trackedByListener.get(listener);
    if (!bucket) return false;
    const list = bucket.$get(slot);
    if (!list) return false;
    const idx = list.indexOf(target);
    if (idx < 0) return false;
    list.splice(idx, 1);
    if (list.length === 0) {
      bucket.$delete(slot);
      if (bucket.$size === 0) trackedByListener.delete(listener);
    }
    target.removed = true;
    if (target.forwarderType !== null) releaseListener(target.forwarderType);
    return true;
  }

  function addListenerGeneric(
    style: EntryStyle,
    type: string,
    listener: EventListener | EventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (listener === null || listener === undefined) return;
    const capture = typeof options === "boolean" ? options : !!options?.capture;
    const once = typeof options === "object" && options !== null && !!options.once;
    // `AbortSignal` auto-removal is driven from the native EventTarget in C++,
    // so it would bypass our JS remove wrapper and leak the event-loop
    // refcount our capture forwarder holds on `self`. Strip the signal from
    // the options we pass inward and re-implement abort ourselves via an
    // abort listener that routes through the JS remove path.
    const signal =
      typeof options === "object" && options !== null ? ((options as AddEventListenerOptions).signal ?? null) : null;
    if (signal && signal.aborted) return;
    // Only `message` / `messageerror` events are dispatched on `self` by the
    // native worker runtime — all other event types (`close`, `error`, …)
    // live purely on `parentPortTarget` and don't need the capture forwarder
    // at all.
    const forwarderType: "message" | "messageerror" | null =
      type === "message" ? "message" : type === "messageerror" ? "messageerror" : null;

    const slot = listenerSlot(type, capture);
    const bucket = getOrCreateBucket(listener as object);
    let list = bucket.$get(slot);
    if (style === "dom" && list && list.length > 0) {
      // DOM `addEventListener` dedupes (type, listener, capture) triples —
      // matching WHATWG spec. Emitter-style `on` allows duplicates.
      return;
    }
    // `entry` is referenced by `wrapped` below via closure; the assignment
    // happens after `wrapped` is defined.
    let entry: TrackEntry;
    const wrapped: EventListener = function (event) {
      if (entry.removed) return;
      if (once) {
        evictEntry(listener as object, slot, entry);
      }
      if (entry.style === "emitter") {
        invokeEmitterListener(type, listener, event);
      } else {
        invokeDomListener(listener, event);
      }
    };
    entry = { wrapped, style, once, forwarderType, removed: false };
    if (!list) {
      list = [];
      bucket.$set(slot, list);
    }
    list.push(entry);
    const innerOptions: boolean | AddEventListenerOptions =
      typeof options === "object" && options !== null ? { ...options, signal: undefined } : (options ?? false);
    parentPortTarget.addEventListener(type, wrapped, innerOptions);
    if (forwarderType !== null) acquireListener(forwarderType);
    if (signal) {
      // Capture THIS entry, not just the (listener, slot) pair — so that
      // `remove` → `add-with-no-signal` → abort doesn't silently evict the
      // new registration.
      const capturedEntry = entry;
      signal.addEventListener(
        "abort",
        () => {
          if (capturedEntry.removed) return;
          parentPortTarget.removeEventListener(type, capturedEntry.wrapped, innerOptions);
          evictEntry(listener as object, slot, capturedEntry);
        },
        { once: true },
      );
    }
  }

  function removeListenerGeneric(
    type: string,
    listener: EventListener | EventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    if (listener === null || listener === undefined) return;
    const capture = typeof options === "boolean" ? options : !!options?.capture;
    const bucket = getBucket(listener as object);
    if (!bucket) return;
    const slot = listenerSlot(type, capture);
    const list = bucket.$get(slot);
    if (!list || list.length === 0) return;
    // Remove the most-recently-added entry for this listener (LIFO),
    // matching Node's `removeListener`. `removeEventListener` hits the
    // same path: since DOM adds dedupe, at most one entry is ever present
    // via `addEventListener`, and Node's `removeEventListener` and
    // `removeListener` are aliases operating on the shared list.
    const entry = list[list.length - 1];
    parentPortTarget.removeEventListener(type, entry.wrapped, options);
    evictEntry(listener as object, slot, entry);
  }

  function parentPortAddEventListener(
    type: string,
    listener: EventListener | EventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    addListenerGeneric("dom", type, listener, options);
  }

  function parentPortRemoveEventListener(
    type: string,
    listener: EventListener | EventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    removeListenerGeneric(type, listener, options);
  }

  function parentPortOn(type: string, listener: EventListener) {
    addListenerGeneric("emitter", type, listener);
    return fake;
  }

  function parentPortOnce(type: string, listener: EventListener) {
    addListenerGeneric("emitter", type, listener, { once: true });
    return fake;
  }

  function parentPortOff(type: string, listener: EventListener) {
    removeListenerGeneric(type, listener);
    return fake;
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
        releaseListener("message");
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
        acquireListener("message");
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
        releaseListener("messageerror");
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
        acquireListener("messageerror");
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

  // Node-style emitter methods. These OVERRIDE the inherited
  // `MessagePort.prototype.{on,off,once,...}` methods installed by
  // `injectFakeEmitter`, because those:
  //
  // - store their per-registration wrapper on the user listener itself
  //   (`listener[wrappedListener] = cb`), which gets clobbered when the
  //   same listener is registered twice — leaking the earlier entries
  //   and pinning the forwarder-held event-loop ref forever, and
  // - can't coordinate with the forwarder / abort-signal bookkeeping
  //   that parentPort needs to exit cleanly.
  //
  // The overrides route through `addListenerGeneric` / `removeListenerGeneric`
  // which handle duplicates, Node-style `removeListener` semantics (LIFO
  // removal), and forwarder refcounting in one place.
  Object.defineProperty(fake, "on", {
    value: parentPortOn,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(fake, "addListener", {
    value: parentPortOn,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(fake, "prependListener", {
    value: parentPortOn,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(fake, "once", {
    value: parentPortOnce,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(fake, "prependOnceListener", {
    value: parentPortOnce,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(fake, "off", {
    value: parentPortOff,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(fake, "removeListener", {
    value: parentPortOff,
    writable: true,
    configurable: true,
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
