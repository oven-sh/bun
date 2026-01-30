declare const self: typeof globalThis;
type WebWorker = InstanceType<typeof globalThis.Worker>;

const EventEmitter = require("node:events");
const Readable = require("internal/streams/readable");
const { throwNotImplemented, warnNotImplementedOnce } = require("internal/shared");
const { SafeWeakMap } = require("internal/primordials");

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

// Storage for stdio streams (using SafeWeakMap to avoid userland patching)
const stdioStreams = new SafeWeakMap();

function getOrCreateStdioStream(worker: object, type: string, nativeWorker: WebWorker, options: any) {
  let streams = stdioStreams.get(worker);
  if (!streams) {
    streams = { stdout: null, stderr: null, stdin: null, options };
    stdioStreams.set(worker, streams);
  }

  if (streams[type] !== null) return streams[type];
  if (!options || !options[type]) return null;

  // Use bracket notation to access internal methods safely without TS complaining about the type
  // Check if the method exists using bracket notation (safe for TS)
  if (typeof nativeWorker["$getStdioFds"] !== "function") return null;

  // CALL it using bracket notation.
  // This syntax `obj["method"]()` preserves the 'this' context.
  const fds = nativeWorker["$getStdioFds"].$call(nativeWorker);
  if (!fds) return null;

  const fdIndex = type === "stdout" ? 0 : type === "stderr" ? 1 : 2;
  const fd = fds[fdIndex];

  // Ensure we have a valid file descriptor (assuming -1 is invalid)
  if (typeof fd !== "number" || fd < 0) return null;

  // For stdout/stderr, create a Readable stream from the pipe FD
  if (type === "stdout" || type === "stderr") {
    const file = Bun.file(fd);
    const webStream = file.stream();
    const nodeStream = Readable.fromWeb(webStream);
    streams[type] = nodeStream;
    return nodeStream;
  }

  if (type === "stdin") {
    // Create a Node.js WriteStream from the file descriptor
    // autoClose: false ensures we don't close the FD unexpectedly if the stream ends
    // const nodeStream = fs.createWriteStream(null, { fd, autoClose: false });
    // streams[type] = nodeStream;
    // return nodeStream;

    // TODO: implement worker_threads.stdin, not part of this issue
    throwNotImplemented("worker_threads.stdin", 22585);
  }
  return null;
}

function injectFakeEmitter(Class: any) {
  function messageEventHandler(event: MessageEvent) {
    return event.data;
  }

  function errorEventHandler(event: ErrorEvent) {
    return event.error;
  }

  const wrappedListener = Symbol("wrappedListener");

  function wrapped(run: (e: any) => any, listener: any) {
    const callback = function (event: any) {
      return listener(run(event));
    };
    listener[wrappedListener] = callback;
    return callback;
  }

  function functionForEventType(event: string, listener: any) {
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

  Class.prototype.on = function (this: any, event: string, listener: any) {
    this.addEventListener(event, functionForEventType(event, listener));
    return this;
  };

  Class.prototype.off = function (this: any, event: string, listener: any) {
    if (listener) {
      this.removeEventListener(event, listener[wrappedListener] || listener);
    } else {
      this.removeEventListener(event);
    }
    return this;
  };

  Class.prototype.once = function (this: any, event: string, listener: any) {
    this.addEventListener(event, functionForEventType(event, listener), { once: true });
    return this;
  };

  function EventClass(eventName: string) {
    if (eventName === "error" || eventName === "messageerror") {
      return ErrorEvent;
    }
    return MessageEvent;
  }

  Class.prototype.emit = function (this: any, event: string, ...args: any[]) {
    const EventConstructor = EventClass(event);
    let eventInstance: Event;

    if (EventConstructor === MessageEvent) {
      // Wrap first argument as { data: <arg> } for MessageEvent
      const init = args.length > 0 ? { data: args[0] } : { data: undefined };
      eventInstance = new MessageEvent(event, init);
    } else if (EventConstructor === ErrorEvent) {
      // Wrap first argument as { error: <arg> } for ErrorEvent
      const init = args.length > 0 ? { error: args[0] } : { error: undefined };
      eventInstance = new ErrorEvent(event, init);
    } else {
      // Fallback for other event types
      eventInstance = new (EventConstructor as any)(event, ...args);
    }

    this.dispatchEvent(eventInstance);
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
  #performance: any;

  // this is used by terminate();
  // either is the exit code if exited, a promise resolving to the exit code, or undefined if we haven't sent .terminate() yet
  #onExitPromise: Promise<number> | number | undefined = undefined;
  #urlToRevoke = "";

  constructor(filename: string, options: NodeWorkerOptions = {}) {
    super();

    const builtinsGeneratorHatesEval = "ev" + "a" + "l"[0];
    if (options && builtinsGeneratorHatesEval in options) {
      if ((options as any)[builtinsGeneratorHatesEval]) {
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

    // Initialize stdio stream storage with options
    stdioStreams.set(this, {
      stdout: null,
      stderr: null,
      stdin: null,
      options: { stdout: options.stdout, stderr: options.stderr, stdin: options.stdin },
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
    return this.#worker.threadId;
  }

  ref() {
    this.#worker.ref();
  }

  unref() {
    this.#worker.unref();
  }

  get stdin() {
    const data = stdioStreams.get(this);
    return getOrCreateStdioStream(this, "stdin", this.#worker, data?.options || {});
  }

  get stdout() {
    const data = stdioStreams.get(this);
    return getOrCreateStdioStream(this, "stdout", this.#worker, data?.options || {});
  }

  get stderr() {
    const data = stdioStreams.get(this);
    return getOrCreateStdioStream(this, "stderr", this.#worker, data?.options || {});
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

  terminate(callback?: (err: Error | null, code: number) => void) {
    if (typeof callback === "function") {
      process.emitWarning(
        "Passing a callback to worker.terminate() is deprecated. It returns a Promise instead.",
        "DeprecationWarning",
        "DEP0132",
      );
      this.#worker.addEventListener("close", (event: any) => callback(null, event.code), { once: true });
    }

    const onExitPromise = this.#onExitPromise;
    if (onExitPromise) {
      return $isPromise(onExitPromise) ? onExitPromise : Promise.$resolve(onExitPromise);
    }

    const { resolve, promise } = Promise.withResolvers();
    this.#worker.addEventListener(
      "close",
      (event: any) => {
        resolve(event.code);
      },
      { once: true },
    );
    this.#worker.terminate();

    return (this.#onExitPromise = promise);
  }

  postMessage(...args: [any, any]) {
    // @ts-ignore
    return this.#worker.postMessage.$apply(this.#worker, args);
  }

  getHeapSnapshot(options: unknown) {
    const stringPromise = (this.#worker as any).getHeapSnapshot(options);
    return stringPromise.then((s: string) => new HeapSnapshotStream(s));
  }

  #onClose(e: any) {
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
