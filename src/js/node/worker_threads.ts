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
      if (this.#urlToRevoke) {
        URL.revokeObjectURL(this.#urlToRevoke);
      }
      throw e;
    }
    this.#threadId = this.#worker.threadId;
    createMainThreadPort(this.#threadId, mainThreadPortToMain);
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
  postMessageToThread,
  receiveMessageOnPort,
  SHARE_ENV,
  threadId,
};
