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
  // The Worker constructor secretly takes two extra parameters: the node:worker_threads instance
  // (so the `worker` event on process emits the node instance instead of the Web Worker), and the
  // worker's end of the MessagePort connecting it to the main thread for postMessageToThread.
  Worker: new (
    ...args: [...ConstructorParameters<typeof globalThis.Worker>, nodeWorker: Worker, mainThreadPort: MessagePort]
  ) => WebWorker;
};
const SHARE_ENV = Symbol("nodejs.worker_threads.SHARE_ENV");

const isMainThread = Bun.isMainThread;
const {
  0: _workerData,
  1: _threadId,
  2: _receiveMessageOnPort,
  3: environmentData,
  4: _mainThreadPort,
} = $cpp("Worker.cpp", "createNodeWorkerThreadsBinding") as [
  unknown,
  number,
  (port: unknown) => unknown,
  Map<unknown, unknown>,
  MessagePort | undefined,
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
    this.addEventListener(event, functionForEventType(event, listener), {
      once: true,
    });

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

// Emulation of Node's JSTransferable protocol (kTransfer/kTransferList/kDeserialize) for
// objects like FileHandle that are not natively transferable in Bun. On send, each such
// object in the transferList is replaced inside workerData by a serializable marker object;
// on receive, markers are swapped back for reconstructed instances.
// A plain string key on purpose: Symbols don't survive structured clone, and
// Bun has no native HostObject hook, so the marker must ride along inside the
// cloned graph (including Map/Set entries). This is in-band signaling: a user
// object that fabricates the key in workerData will deserialize on the worker
// side where node would deliver it unchanged. That's accepted - it is not a
// privilege boundary (worker threads share the parent's fd table anyway).
const kJSTransferableMarker = "__bunNodeWorkerJSTransferable";

function isJSTransferableMarker(value: object): boolean {
  return (
    typeof (value as Record<string, unknown>)[kJSTransferableMarker] === "string" &&
    Object.prototype.hasOwnProperty.$call(value, kJSTransferableMarker)
  );
}

function deserializeJSTransferable(marker: Record<string, any>): unknown {
  const deserializeInfo = marker[kJSTransferableMarker];
  switch (deserializeInfo) {
    case "internal/fs/promises:FileHandle": {
      const { FileHandle, kDeserialize } = require("node:fs").promises.$data;
      const handle = new FileHandle(-1);
      handle[kDeserialize](marker.data);
      return handle;
    }
    default:
      return marker;
  }
}

function unpackJSTransferables(value: unknown, memo?: Map<object, unknown>): unknown {
  if (value === null || typeof value !== "object") return value;
  memo ??= new Map();
  // The memo both breaks cycles (containers map to themselves) and preserves
  // reference identity for markers: structured clone keeps a marker shared
  // between graph positions as one object, so the same marker must
  // deserialize to the same instance (one FileHandle per transferred fd,
  // like node's host-object back-references).
  const cached = memo.get(value);
  if (cached !== undefined) return cached;
  if (isJSTransferableMarker(value)) {
    const instance = deserializeJSTransferable(value as Record<string, any>);
    memo.set(value, instance);
    return instance;
  }
  memo.set(value, value);
  if ($isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      // skip holes so sparse arrays stay sparse, like structured clone
      if (i in value) value[i] = unpackJSTransferables(value[i], memo);
    }
    return value;
  }
  // Structured clone walks Map/Set entries (keys included), so markers can
  // arrive inside them; rebuild the entries with deserialized instances.
  if (value instanceof Map) {
    const entries: Array<[unknown, unknown]> = [];
    for (const { 0: k, 1: v } of value) {
      entries.push([unpackJSTransferables(k, memo), unpackJSTransferables(v, memo)]);
    }
    value.clear();
    for (const { 0: k, 1: v } of entries) value.set(k, v);
    return value;
  }
  if (value instanceof Set) {
    const items: unknown[] = [];
    for (const v of value) items.push(unpackJSTransferables(v, memo));
    value.clear();
    for (const v of items) value.add(v);
    return value;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto === Object.prototype || proto === null) {
    for (const key of Object.keys(value)) {
      (value as Record<string, unknown>)[key] = unpackJSTransferables((value as Record<string, unknown>)[key], memo);
    }
  }
  return value;
}

const kRestoreJSTransferables = Symbol("kRestoreJSTransferables");
const kFinalizeJSTransferables = Symbol("kFinalizeJSTransferables");

function packJSTransferables(options: NodeWorkerOptions): NodeWorkerOptions {
  const transferList = options?.transferList;
  if (!transferList || !$isArray(transferList) || transferList.length === 0) return options;
  // Avoid loading node:fs for transfer lists that only contain native transferables.
  let hasCandidate = false;
  for (const item of transferList) {
    if (
      item !== null &&
      typeof item === "object" &&
      !(item instanceof ArrayBuffer) &&
      !(item instanceof _MessagePort) &&
      !$isTypedArrayView(item)
    ) {
      hasCandidate = true;
      break;
    }
  }
  if (!hasCandidate) return options;

  const { kTransfer, kTransferList, kDeserialize } = require("node:fs").promises.$data;
  let replacements: Map<object, object> | undefined;
  const nativeTransferList: unknown[] = [];
  // kTransfer() neuters the handle (extracts the bare fd); if anything later
  // in the pack/construct sequence throws, restore the already-neutered
  // handles so their fds aren't orphaned.
  const neutered: Array<[item: any, data: unknown]> = [];
  function restoreNeutered() {
    for (const { 0: item, 1: data } of neutered) {
      try {
        item[kDeserialize](data);
      } catch {
        // best effort - the handle may have been closed concurrently
      }
    }
  }
  try {
    for (const item of transferList) {
      if (item !== null && typeof item === "object" && typeof item[kTransfer] === "function") {
        if (replacements?.has(item)) {
          // node (and the HTML spec) reject duplicate transferList entries;
          // without this the second kTransfer() would read the already
          // neutered fd (-1) and clobber the real marker.
          throw new DOMException(
            `Transfer list contains duplicate ${item.constructor?.name ?? "entry"}`,
            "DataCloneError",
          );
        }
        const extraTransfers = item[kTransferList]?.();
        // May throw DataCloneError (e.g. FileHandle in use); propagate synchronously like Node.
        const { data, deserializeInfo } = item[kTransfer]();
        neutered.push([item, data]);
        (replacements ??= new Map()).set(item, {
          [kJSTransferableMarker]: deserializeInfo,
          data,
        });
        if ($isArray(extraTransfers)) nativeTransferList.push(...extraTransfers);
      } else {
        nativeTransferList.push(item);
      }
    }
  } catch (e) {
    restoreNeutered();
    throw e;
  }
  if (!replacements) return options;

  const seen = new Map<object, unknown>();
  const usedMarkers = new Set<object>();
  function replace(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    const replacement = replacements!.get(value);
    if (replacement !== undefined) {
      usedMarkers.add(value);
      return replacement;
    }
    const cached = seen.get(value);
    if (cached !== undefined) return cached;
    if ($isArray(value)) {
      const out = new Array(value.length);
      seen.set(value, out);
      // skip holes so sparse arrays stay sparse, like structured clone
      for (let i = 0; i < value.length; i++) {
        if (i in value) out[i] = replace(value[i]);
      }
      return out;
    }
    // Mirror structured clone: Map/Set entries (keys included) participate
    // in the graph, so a transferred handle inside them must become its
    // marker rather than being orphaned.
    if (value instanceof Map) {
      const out = new Map();
      seen.set(value, out);
      for (const { 0: k, 1: v } of value) out.set(replace(k), replace(v));
      return out;
    }
    if (value instanceof Set) {
      const out = new Set();
      seen.set(value, out);
      for (const v of value) out.add(replace(v));
      return out;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      const out: Record<string, unknown> = {};
      seen.set(value, out);
      for (const key of Object.keys(value)) out[key] = replace((value as Record<string, unknown>)[key]);
      return out;
    }
    return value;
  }
  // replace() reads property getters and Proxy traps (Object.keys,
  // Object.getPrototypeOf, value[key]), and the options spread reads
  // getters on the user's options object — any of which can throw after
  // handles are already neutered. Roll back here too so a throwing
  // workerData graph doesn't orphan the fds it transferred.
  let packed;
  try {
    packed = {
      ...options,
      workerData: replace(options.workerData),
      transferList: nativeTransferList,
    };
  } catch (e) {
    restoreNeutered();
    throw e;
  }
  packed[kRestoreJSTransferables] = restoreNeutered;
  // A handle in transferList but never referenced from workerData is still
  // detached from this thread (fd === -1, like node), but no marker will
  // deserialize it on the worker side - close the orphaned fd instead of
  // leaking it (node's worker-side instance is reclaimed by GC). This runs
  // only after WebWorker construction succeeds: if construction throws, the
  // rollback above must still find the fd open to restore the handle (node
  // leaves the handle fully usable in that case).
  packed[kFinalizeJSTransferables] = function finalizeJSTransferables() {
    for (const { 0: item, 1: data } of neutered) {
      if (!usedMarkers.has(item) && typeof (data as any)?.fd === "number" && (data as any).fd >= 0) {
        try {
          require("node:fs").closeSync((data as any).fd);
        } catch {
          // already closed
        }
      }
    }
  };
  return packed;
}

let workerData = unpackJSTransferables(_workerData);
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

  Object.defineProperty(fake, "removeListener", {
    value: self.removeEventListener.bind(self),
    enumerable: false,
  });

  Object.defineProperty(fake, "addListener", {
    value: self.addEventListener.bind(self),
    enumerable: false,
  });

  return fake;
}
let parentPort: MessagePort | null = isMainThread ? null : fakeParentPort();

// --- postMessageToThread ---
//
// Every worker gets a direct MessageChannel to the main thread (mainThreadPort). The main thread
// keeps a Map of threadId -> port. postMessageToThread always routes through the main thread, and
// a SharedArrayBuffer carries the ack so the sender can await delivery with Atomics.waitAsync.
//
// Known limitation: the worker side of the channel is only set up the first time the worker
// evaluates node:worker_threads (see setupMainThreadPort below). Node.js wires it during worker
// bootstrap unconditionally, so postMessageToThread(id, value) with no timeout to a worker that
// never imports worker_threads rejects with ERR_WORKER_MESSAGING_FAILED there, whereas here the
// promise stays pending indefinitely unless a timeout is supplied (worker exit closes the port
// but does not notify already-pending waiters). In practice a node:worker_threads Worker almost
// always imports the module for parentPort/workerData.
//
// Unregistration is driven from the parent's #onClose (matching Node's kOnExit), so terminating
// an intermediate worker orphans its live grandchildren in the root's threadsPorts map; sending
// to such a threadId without a timeout likewise stays pending. This matches Node.js behaviour.

const kRegisterMainThreadPort = 0;
const kUnregisterMainThreadPort = 1;
const kSendMessageToWorker = 2;
const kReceiveMessageFromWorker = 3;

// SharedArrayBuffer must always be Int32, so it's * 4.
// We need one for the operation status (performing / performed) and one for the result (success / failure).
const WORKER_MESSAGING_SHARED_DATA = 2 * 4;
const WORKER_MESSAGING_STATUS_INDEX = 0;
const WORKER_MESSAGING_RESULT_INDEX = 1;

// Response codes
const WORKER_MESSAGING_RESULT_DELIVERED = 0;
const WORKER_MESSAGING_RESULT_NO_LISTENERS = 1;
const WORKER_MESSAGING_RESULT_LISTENER_ERROR = 2;

// This is only populated by the main thread and always empty in other threads.
let threadsPorts: Map<number, MessagePort> | undefined;
// This is only populated in child threads and always undefined in the main thread.
let mainThreadPort: MessagePort | undefined;

function ensureThreadsPorts() {
  return (threadsPorts ??= new Map());
}

// This event handler is always executed on the main thread only.
function handleMessageFromThread(message) {
  switch (message.type) {
    case kRegisterMainThreadPort: {
      const { threadId, port } = message;
      // Register the port
      ensureThreadsPorts().$set(threadId, port);
      // Handle messages on this port. When a new thread wants to register a child this takes care
      // of doing that. This way any thread can be linked to the main one.
      port.addEventListener("message", event => handleMessageFromThread(event.data));
      // Never block the thread on this port
      port.unref();
      break;
    }
    case kUnregisterMainThreadPort: {
      const ports = ensureThreadsPorts();
      const port = ports.$get(message.threadId);
      if (port) {
        port.close();
        ports.$delete(message.threadId);
      }
      break;
    }
    case kSendMessageToWorker: {
      // Send the message to the target thread
      const { source, destination, value, transferList, memory } = message;
      sendMessageToWorker(source, destination, value, transferList, memory);
      break;
    }
  }
}

function handleMessageFromMainThread(message) {
  if (message.type === kReceiveMessageFromWorker) {
    receiveMessageFromWorker(message.source, message.value, message.memory);
  }
}

function sendMessageToWorker(source, destination, value, transferList, memory) {
  // We are on the main thread, we can directly process the message
  if (destination === threadId) {
    receiveMessageFromWorker(source, value, memory);
    return;
  }

  // Search the port to the target thread
  const port = ensureThreadsPorts().$get(destination);

  if (!port) {
    const status = new Int32Array(memory);
    Atomics.store(status, WORKER_MESSAGING_RESULT_INDEX, WORKER_MESSAGING_RESULT_NO_LISTENERS);
    Atomics.store(status, WORKER_MESSAGING_STATUS_INDEX, 1);
    Atomics.notify(status, WORKER_MESSAGING_STATUS_INDEX, 1);
    return;
  }

  port.postMessage(
    {
      type: kReceiveMessageFromWorker,
      source,
      destination,
      value,
      memory,
    },
    transferList,
  );
}

function receiveMessageFromWorker(source, value, memory) {
  let response = WORKER_MESSAGING_RESULT_NO_LISTENERS;

  // We need an exception in a listener to propagate here, but the native process.emit swallows
  // listener exceptions and reports them as uncaught. Invoke the listeners directly instead.
  try {
    const listeners = process.listeners("workerMessage");
    for (let i = 0; i < listeners.length; i++) {
      listeners[i].$call(process, value, source);
      response = WORKER_MESSAGING_RESULT_DELIVERED;
    }
  } catch {
    response = WORKER_MESSAGING_RESULT_LISTENER_ERROR;
  }

  // Populate the result
  const status = new Int32Array(memory);
  Atomics.store(status, WORKER_MESSAGING_RESULT_INDEX, response);
  Atomics.store(status, WORKER_MESSAGING_STATUS_INDEX, 1);
  Atomics.notify(status, WORKER_MESSAGING_STATUS_INDEX, 1);
}

function createMainThreadPort(childThreadId, port) {
  const registrationMessage = {
    type: kRegisterMainThreadPort,
    threadId: childThreadId,
    port,
  };

  if (mainThreadPort) {
    mainThreadPort.postMessage(registrationMessage, [port]);
  } else {
    // Either we are the main thread, or we were created without the node:worker_threads plumbing
    // (e.g. via the Web Worker constructor). Act as the local root for messaging.
    handleMessageFromThread(registrationMessage);
  }
}

function destroyMainThreadPort(childThreadId) {
  const unregistrationMessage = {
    type: kUnregisterMainThreadPort,
    threadId: childThreadId,
  };

  if (mainThreadPort) {
    mainThreadPort.postMessage(unregistrationMessage);
  } else {
    handleMessageFromThread(unregistrationMessage);
  }
}

function setupMainThreadPort(port) {
  mainThreadPort = port;
  port.addEventListener("message", event => handleMessageFromMainThread(event.data));
  // Never block the process on this port
  port.unref();
}

async function postMessageToThread(destination, value, transferList, timeout) {
  if (typeof transferList === "number" && typeof timeout === "undefined") {
    timeout = transferList;
    transferList = [];
  }

  if (typeof timeout !== "undefined") {
    validateNumber(timeout, "timeout", 0);
  }

  if (destination === threadId) {
    throw $ERR_WORKER_MESSAGING_SAME_THREAD();
  }

  const memory = new SharedArrayBuffer(WORKER_MESSAGING_SHARED_DATA);
  const status = new Int32Array(memory);
  const promise = Atomics.waitAsync(status, WORKER_MESSAGING_STATUS_INDEX, 0, timeout).value;

  const message = {
    type: kSendMessageToWorker,
    source: threadId,
    destination,
    value,
    memory,
    transferList,
  };

  if (mainThreadPort) {
    mainThreadPort.postMessage(message, transferList);
  } else {
    handleMessageFromThread(message);
  }

  // Wait for the response
  const response = await promise;

  if (response === "timed-out") {
    throw $ERR_WORKER_MESSAGING_TIMEOUT();
  } else if (status[WORKER_MESSAGING_RESULT_INDEX] === WORKER_MESSAGING_RESULT_NO_LISTENERS) {
    throw $ERR_WORKER_MESSAGING_FAILED();
  } else if (status[WORKER_MESSAGING_RESULT_INDEX] === WORKER_MESSAGING_RESULT_LISTENER_ERROR) {
    throw $ERR_WORKER_MESSAGING_ERRORED();
  }
}

if (!isMainThread && _mainThreadPort) {
  setupMainThreadPort(_mainThreadPort);
}

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
  // Cached at construction. The native threadId getter returns -1 once the
  // worker is closing; we need the real id in #onClose to unregister the
  // postMessageToThread port, and for get threadId() to keep returning the
  // id after terminate() (Node's getter also does this until [kDispose] nulls
  // the handle, which happens after its [kOnExit] equivalent).
  #threadId: number;

  // this is used by terminate();
  // either is the exit code if exited, a promise resolving to the exit code, or undefined if we haven't sent .terminate() yet
  #onExitPromise: Promise<number> | number | undefined = undefined;
  #urlToRevoke = "";

  constructor(filename: string, options: NodeWorkerOptions = {}) {
    super();

    options = packJSTransferables(options);

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
    // Create a channel that links the new thread to the main thread for postMessageToThread.
    const { port1: mainThreadPortToMain, port2: mainThreadPortToThread } = new MessageChannel();
    try {
      this.#worker = new WebWorker(filename, options as Bun.WorkerOptions, this, mainThreadPortToThread);
    } catch (e) {
      mainThreadPortToMain.close();
      // Restore any transferList handles that were already neutered by
      // packJSTransferables, so their fds aren't orphaned.
      options[kRestoreJSTransferables]?.();
      if (this.#urlToRevoke) {
        URL.revokeObjectURL(this.#urlToRevoke);
      }
      throw e;
    }
    this.#threadId = this.#worker.threadId;
    createMainThreadPort(this.#threadId, mainThreadPortToMain);
    // The transfer is committed - release fds that were transferred but are
    // not referenced from workerData (nothing will deserialize them).
    options[kFinalizeJSTransferables]?.();
    this.#worker.addEventListener("close", this.#onClose.bind(this), {
      once: true,
    });
    this.#worker.addEventListener("error", this.#onError.bind(this));
    this.#worker.addEventListener("message", this.#onMessage.bind(this));
    this.#worker.addEventListener("messageerror", this.#onMessageError.bind(this));
    this.#worker.addEventListener("open", this.#onOpen.bind(this), {
      once: true,
    });

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
    return this.#threadId;
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
    destroyMainThreadPort(this.#threadId);
    this.#threadId = -1;
    this.#onExitPromise = e.code;
    this.emit("exit", e.code);
  }

  #onError(event: ErrorEvent) {
    let error = event?.error;
    // if the thrown value serialized successfully, the message will be empty
    // if not the message is the actual error
    const message = event.message;
    if (message !== "") {
      error = new Error(message, { cause: event });
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
  postMessageToThread,
  receiveMessageOnPort,
  SHARE_ENV,
  threadId,
};
