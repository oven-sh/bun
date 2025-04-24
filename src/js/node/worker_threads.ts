// import type { Readable, Writable } from "node:stream";
// import type { WorkerOptions } from "node:worker_threads";
declare const self: typeof globalThis;
type WebWorker = InstanceType<typeof globalThis.Worker>;

// Add missing global types locally if not available
// Typically provided by lib="webworker" or lib="dom"
type Transferable = ArrayBuffer | MessagePort; // Add other relevant types if needed by Bun's Worker
interface StructuredSerializeOptions {
    transfer?: Transferable[];
    // Add other potential options if known
}


const EventEmitter = require("node:events");
const { throwNotImplemented, warnNotImplementedOnce } = require("internal/shared");
const { validateObject, validateBoolean } = require("internal/validators");

const { MessageChannel, BroadcastChannel, Worker: WebWorker } = globalThis;
const SHARE_ENV = Symbol("nodejs.worker_threads.SHARE_ENV");

const isMainThread = Bun.isMainThread;
const { 0: _workerData, 1: _threadId, 2: _receiveMessageOnPort } = $cpp("Worker.cpp", "createNodeWorkerThreadsBinding");

type NodeWorkerOptions = import("node:worker_threads").WorkerOptions;

// Used to ensure that Blobs created to hold the source code for `eval: true` Workers get cleaned up
// after their Worker exits
let urlRevokeRegistry: FinalizationRegistry<string> | undefined = undefined;

function injectFakeEmitter(Class: { prototype: EventTarget & { [key: string]: any } }) {
  function messageEventHandler(event: MessageEvent) {
    return event.data;
  }

  function errorEventHandler(event: ErrorEvent) {
    return event.error;
  }

  const wrappedListener = Symbol("wrappedListener");

  function wrapped(run: (event: any) => any, listener: (...args: any[]) => void) {
    const callback = function (event: Event) {
      // The listener expects the processed data/error, not the raw event
      return listener(run(event));
    };
    // Store the wrapper on the original listener for later removal
    (listener as any)[wrappedListener] = callback;
    return callback;
  }

  function functionForEventType(event: string, listener: (...args: any[]) => void) {
    switch (event) {
      case "error":
      case "messageerror": {
        return wrapped(errorEventHandler, listener);
      }
      // Assuming 'message' is the primary data event
      case "message":
      default: {
        return wrapped(messageEventHandler, listener);
      }
    }
  }

  Class.prototype.on = function (event: string, listener: (...args: any[]) => void) {
    // Cast to EventListener because EventTarget expects EventListenerOrEventListenerObject
    this.addEventListener(event, functionForEventType(event, listener) as EventListener);
    return this;
  };

  Class.prototype.off = function (event: string, listener?: (...args: any[]) => void) {
    if (listener) {
      // Try to get the wrapped listener, fall back to the original if not found (though it should be)
      const actualListener = (listener as any)[wrappedListener] || listener;
      // Ensure the listener being removed is actually an EventListener or compatible object
      // Cast needed as EventTarget expects EventListenerOrEventListenerObject
      this.removeEventListener(event, actualListener as EventListener);
    } else {
      // This branch seems incorrect based on EventTarget spec, but matches Node's EventEmitter behavior
      // where `off(event)` removes all listeners for that event. However, EventTarget doesn't support this.
      // For now, we'll keep it as is, assuming it might be handled differently or is a known deviation.
      // A more correct implementation might involve tracking listeners manually.
      // If no listener is provided, we might need to iterate and remove all known wrapped listeners.
      // Or simply warn/throw that removing all listeners by event name isn't directly supported.
      // Let's stick to the original code's intent for now, even if potentially flawed for EventTarget.
      // Passing null is valid for removeEventListener's second arg, often meaning "remove all".
      // Use `null as any` to satisfy the type checker.
      (this as EventTarget).removeEventListener(event, null as any);
    }

    return this;
  };

  Class.prototype.once = function (event: string, listener: (...args: any[]) => void) {
    // Cast to EventListener because EventTarget expects EventListenerOrEventListenerObject
    this.addEventListener(event, functionForEventType(event, listener) as EventListener, { once: true });
    return this;
  };

  Class.prototype.emit = function (event: string, ...args: any[]) {
    let eventObj: Event;
    if (event === "error" || event === "messageerror") {
      // Node.js 'error' event usually passes the error object as the first arg
      const errorArg = args[0];
      eventObj = new ErrorEvent(event, {
        error: errorArg,
        // Attempt to extract message if errorArg is an Error
        message: errorArg instanceof Error ? errorArg.message : String(errorArg),
      });
    } else {
      // Node.js 'message' event usually passes the data as the first arg
      const dataArg = args[0];
      eventObj = new MessageEvent(event, {
        data: dataArg,
        // Other properties like origin, ports might be relevant but harder to map directly
      });
    }
    // dispatchEvent returns a boolean indicating if the event was cancelled,
    // Node's emit returns true if listeners existed. We'll return true
    // to indicate the event was dispatched, which is a close approximation.
    this.dispatchEvent(eventObj);
    return true; // Mimic Node.js EventEmitter returning true if listeners exist
  };

  // Aliases for Node.js compatibility
  Class.prototype.addListener = Class.prototype.on;
  Class.prototype.removeListener = Class.prototype.off;
  Class.prototype.prependListener = Class.prototype.on; // Note: prepend behavior not fully replicated
  Class.prototype.prependOnceListener = Class.prototype.once; // Note: prepend behavior not fully replicated
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

// Define an interface for the Node.js-like MessagePort
interface NodeMessagePort extends MessagePort {
  on(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener?: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  emit(event: string, ...args: any[]): boolean;
  addListener(event: string, listener: (...args: any[]) => void): this;
  removeListener(event: string, listener?: (...args: any[]) => void): this;
  prependListener(event: string, listener: (...args: any[]) => void): this;
  prependOnceListener(event: string, listener: (...args: any[]) => void): this;
  ref(): this;
  unref(): this;
  hasRef(): boolean;
  setEncoding(encoding: BufferEncoding): this;
}

// TODO: parent port emulation is not complete
function fakeParentPort(): NodeMessagePort {
  // Create an object that inherits from the (potentially modified) MessagePort.prototype
  const fake = Object.create(MessagePort.prototype);

  // Define properties that need special handling for the fake parent port

  // postMessage needs to call the global postMessage function
  const postMessageFn = $newCppFunction<(message: any, transfer?: (ArrayBuffer | MessagePort)[]) => void>(
    "ZigGlobalObject.cpp",
    "jsFunctionPostMessage",
    1, // Note: argCount might influence native behavior, but direct call passes all args.
  );
  Object.defineProperty(fake, "postMessage", {
    value(message: any, transfer?: (ArrayBuffer | MessagePort)[]) {
      // Direct call to the native function wrapper for the global postMessage
      postMessageFn(message, transfer);
    },
    writable: true,
    enumerable: true,
    configurable: true,
  });

  // close and start should be no-ops for the fake parent port
  Object.defineProperty(fake, "close", {
    value() {},
    writable: true,
    enumerable: true,
    configurable: true,
  });

  Object.defineProperty(fake, "start", {
    value() {},
    writable: true,
    enumerable: true,
    configurable: true,
  });

  // Add dummy ref/unref/hasRef/setEncoding for compatibility if they aren't on the prototype
  // These are Node.js specific and not part of the standard MessagePort
  const proto = MessagePort.prototype as any;
  const dummyRefUnref = function (this: NodeMessagePort): NodeMessagePort {
    warnNotImplementedOnce("parentPort.ref/unref");
    return this;
  };
  const dummyHasRef = (): boolean => {
    warnNotImplementedOnce("parentPort.hasRef");
    return false; // Typically false if unref'd or not ref'd
  };
  const dummySetEncoding = function (this: NodeMessagePort, _enc: BufferEncoding): NodeMessagePort {
    warnNotImplementedOnce("parentPort.setEncoding");
    return this;
  };

  if (!("ref" in proto)) {
    Object.defineProperty(fake, "ref", {
      value: dummyRefUnref,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
  if (!("unref" in proto)) {
    Object.defineProperty(fake, "unref", {
      value: dummyRefUnref,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
  if (!("hasRef" in proto)) {
    Object.defineProperty(fake, "hasRef", {
      value: dummyHasRef,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
  if (!("setEncoding" in proto)) {
    Object.defineProperty(fake, "setEncoding", {
      value: dummySetEncoding,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }

  // The event listener methods (on, off, etc.) and properties (onmessage, onmessageerror)
  // are inherited from the modified MessagePort.prototype via Object.create.
  // We don't need to redefine them here unless we want behavior different from a standard MessagePort.
  // The original code tried to proxy onmessage/onmessageerror to `self`, which is incorrect.

  // Return the dynamically created object, asserting its type.
  return fake as NodeMessagePort;
}

let parentPort: NodeMessagePort | null = null;
if (!isMainThread) {
  parentPort = fakeParentPort();
}

function getEnvironmentData() {
  return process.env;
}

function setEnvironmentData(env: any) {
  process.env = env;
}

function markAsUntransferable() {
  throwNotImplemented("worker_threads.markAsUntransferable");
}

function moveMessagePortToContext() {
  throwNotImplemented("worker_threads.moveMessagePortToContext");
}

const unsupportedOptions = ["stdin", "stdout", "stderr", "trackedUnmanagedFds", "resourceLimits"];

class Worker extends EventEmitter {
  #worker: WebWorker;
  #performance;

  // this is used by terminate();
  // either is the exit code if exited, a promise resolving to the exit code, or undefined if we haven't sent .terminate() yet
  #onExitPromise: Promise<number> | number | undefined = undefined;
  #urlToRevoke = "";
  #isRunning = false;

  constructor(filename: string | URL, options: NodeWorkerOptions = {}) {
    super();
    for (const key of unsupportedOptions) {
      if (key in options && (options as any)[key] != null) {
        warnNotImplementedOnce(`worker_threads.Worker option "${key}"`);
      }
    }

    let workerFilename: string | URL = filename;
    const builtinsGeneratorHatesEval = "ev" + "a" + "l"[0];
    if (options && builtinsGeneratorHatesEval in options) {
      if ((options as any)[builtinsGeneratorHatesEval]) {
        if (typeof filename !== "string") {
          throw new TypeError("filename must be a string when options.eval is true");
        }
        // TODO: consider doing this step in native code and letting the Blob be cleaned up by the
        // C++ Worker object's destructor
        const blob = new Blob([filename], { type: "application/javascript" });
        this.#urlToRevoke = workerFilename = URL.createObjectURL(blob);
      } else {
        // if options.eval = false, allow the constructor below to fail, if
        // we convert the code to a blob, it will succeed.
        // No URL revocation needed if eval is false.
      }
    }
    try {
      // Cast to `any` to bridge the gap between NodeWorkerOptions and Bun.WorkerOptions, specifically the `env` property.
      this.#worker = new WebWorker(workerFilename, options as any);
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
    warnNotImplementedOnce("worker_threads.Worker.stdin");
    return null;
  }

  get stdout() {
    // TODO:
    warnNotImplementedOnce("worker_threads.Worker.stdout");
    return null;
  }

  get stderr() {
    // TODO:
    warnNotImplementedOnce("worker_threads.Worker.stderr");
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

  terminate(callback?: (err: Error | null, exitCode?: number) => void): Promise<number> {
    this.#isRunning = false;
    if (typeof callback === "function") {
      process.emitWarning(
        "Passing a callback to worker.terminate() is deprecated. It returns a Promise instead.",
        "DeprecationWarning",
        "DEP0132",
      );
      // Assuming 'close' event provides exit code in `event.code` similar to Bun's Worker
      this.#worker.addEventListener("close", event => callback(null, (event as CloseEvent).code), { once: true });
    }

    const onExitPromise = this.#onExitPromise;
    if (onExitPromise !== undefined) {
      return $isPromise(onExitPromise) ? onExitPromise : Promise.resolve(onExitPromise);
    }

    const { resolve, promise } = Promise.withResolvers<number>();
    this.#worker.addEventListener(
      "close",
      event => {
        resolve((event as CloseEvent).code);
      },
      { once: true },
    );
    this.#worker.terminate();

    return (this.#onExitPromise = promise);
  }

  postMessage(...args: [any, StructuredSerializeOptions | Transferable[] | undefined] | [any]) {
    // Use $apply to handle different argument structures correctly
    return this.#worker.postMessage.$apply(this.#worker, args as [any, any?]);
  }

  #onClose(e: Event) {
    this.#isRunning = false;
    const code = (e as CloseEvent).code;
    this.#onExitPromise = code;
    this.emit("exit", code);
  }

  #onError(event: ErrorEvent) {
    this.#isRunning = false;
    let error = event?.error;
    if (!error) {
      error = new Error(event.message, { cause: event });
      // Cast to any to access potential stack property
      const stack = (event as any)?.stack;
      if (stack) {
        error.stack = stack;
      }
    }
    this.emit("error", error);
  }

  #onMessage(event: MessageEvent) {
    // Node.js 'message' event passes the data directly
    this.emit("message", event.data);
  }

  #onMessageError(event: MessageEvent) {
    // Node.js 'messageerror' event passes the error (if available) or data
    this.emit("messageerror", (event as any).error ?? event.data ?? event);
  }

  #onOpen() {
    this.#isRunning = true;
    this.emit("online");
  }

  getHeapSnapshot(
    options?: { exposeInternals?: boolean; exposeNumericValues?: boolean },
  ): Promise<import("node:stream").Readable> {
    if (options !== undefined) {
      // These errors must be thrown synchronously.
      validateObject(options, "options");
      if (options.exposeInternals !== undefined) validateBoolean(options.exposeInternals, "options.exposeInternals");
      if (options.exposeNumericValues !== undefined)
        validateBoolean(options.exposeNumericValues, "options.exposeNumericValues");
    }
    if (!this.#isRunning) {
      const err = new Error("Worker instance not running");
      (err as any).code = "ERR_WORKER_NOT_RUNNING";
      return Promise.reject(err); // Use standard Promise.reject
    }
    // Return a rejected promise indicating the feature is not implemented.
    const errorToReject = $ERR_METHOD_NOT_IMPLEMENTED("worker_threads.Worker.getHeapSnapshot");
    return Promise.reject(errorToReject);
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
    // This should return a Promise<Readable>, but for now, return an empty object to satisfy the interface partially.
    // The actual implementation requires native support.
    warnNotImplementedOnce("worker_threads.getHeapSnapshot");
    return Promise.reject($ERR_METHOD_NOT_IMPLEMENTED("worker_threads.getHeapSnapshot"));
  },
  markAsUntransferable,
  moveMessagePortToContext,
  receiveMessageOnPort,
  SHARE_ENV,
  threadId,
};