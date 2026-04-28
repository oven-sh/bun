// import type { Readable, Writable } from "node:stream";
// import type { WorkerOptions } from "node:worker_threads";
declare const self: typeof globalThis;
type WebWorker = InstanceType<typeof globalThis.Worker>;

const EventEmitter = require("node:events");
const Readable = require("internal/streams/readable");
const Writable = require("internal/streams/writable");
const { throwNotImplemented, warnNotImplementedOnce } = require("internal/shared");

const {
  MessageChannel,
  BroadcastChannel,
  Worker: WebWorker,
} = globalThis as typeof globalThis & {
  // The Worker constructor secretly takes extra parameters: the node:worker_threads
  // instance (so the 'worker' event on the process carries the node:worker_threads
  // Worker object instead of the Web Worker), and an internal-data array that is
  // serialized alongside workerData and made available to the worker's binding.
  Worker: new (
    ...args: [...ConstructorParameters<typeof globalThis.Worker>, nodeWorker: Worker, internalData: unknown]
  ) => WebWorker;
};
const SHARE_ENV = Symbol("nodejs.worker_threads.SHARE_ENV");

const isMainThread = Bun.isMainThread;
const {
  0: _workerData,
  1: _threadId,
  2: _receiveMessageOnPort,
  3: environmentData,
  4: _internalData,
} = $cpp("Worker.cpp", "createNodeWorkerThreadsBinding") as [
  unknown,
  number,
  (port: unknown) => unknown,
  Map<unknown, unknown>,
  [MessagePort, boolean] | undefined,
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

// --- Worker stdio streams --------------------------------------------------
// Node.js exposes Readable streams for a worker's stdout/stderr and an
// optional Writable for stdin on the parent side. Inside the worker,
// process.stdout/stderr/stdin are replaced with the counterpart Writable/
// Readable streams. Data is exchanged over an internal MessagePort created by
// the parent and transferred to the worker via the native constructor
// (createNodeWorkerThreadsBinding returns it as index 4 of the binding array).

const STDIO_PAYLOAD = 0;
const STDIO_WANTS_MORE_DATA = 1;

const kPort = Symbol("kPort");
const kName = Symbol("kName");
const kWaitingStreams = Symbol("kWaitingStreams");
const kIncrementsPortRef = Symbol("kIncrementsPortRef");
const kStartedReading = Symbol("kStartedReading");
const kWritableCallback = Symbol("kWritableCallback");
const kStdioWantsMoreDataCallback = Symbol("kStdioWantsMoreDataCallback");

class ReadableWorkerStdio extends Readable {
  constructor(port, name) {
    super();
    this[kPort] = port;
    this[kName] = name;
    this[kIncrementsPortRef] = true;
    this[kStartedReading] = false;
    this.on("end", () => {
      if (this[kStartedReading] && this[kIncrementsPortRef]) {
        if (--this[kPort][kWaitingStreams] === 0) this[kPort].unref();
      }
    });
  }

  _read() {
    if (!this[kStartedReading] && this[kIncrementsPortRef]) {
      this[kStartedReading] = true;
      if (this[kPort][kWaitingStreams]++ === 0) this[kPort].ref();
    }
    this[kPort].postMessage({ type: STDIO_WANTS_MORE_DATA, stream: this[kName] });
  }
}

class WritableWorkerStdio extends Writable {
  constructor(port, name) {
    super({ decodeStrings: false });
    this[kPort] = port;
    this[kName] = name;
    this[kWritableCallback] = null;
  }

  _writev(chunks, cb) {
    const toSend = new Array(chunks.length);
    for (let i = 0; i < chunks.length; i++) {
      const { chunk, encoding } = chunks[i];
      toSend[i] = { chunk, encoding };
    }
    this[kPort].postMessage({
      type: STDIO_PAYLOAD,
      stream: this[kName],
      chunks: toSend,
    });
    if (process._exiting) {
      cb();
    } else {
      this[kWritableCallback] = cb;
      if (this[kPort][kWaitingStreams]++ === 0) this[kPort].ref();
    }
  }

  _final(cb) {
    this[kPort].postMessage({
      type: STDIO_PAYLOAD,
      stream: this[kName],
      chunks: [{ chunk: null, encoding: "" }],
    });
    cb();
  }

  [kStdioWantsMoreDataCallback]() {
    const cb = this[kWritableCallback];
    if (cb) {
      this[kWritableCallback] = null;
      cb();
      if (--this[kPort][kWaitingStreams] === 0) this[kPort].unref();
    }
  }
}

function pipeWithoutWarning(source, dest) {
  const sourceMaxListeners = source._maxListeners;
  const destMaxListeners = dest._maxListeners;
  source.setMaxListeners(Infinity);
  dest.setMaxListeners(Infinity);

  source.pipe(dest);

  source._maxListeners = sourceMaxListeners;
  dest._maxListeners = destMaxListeners;
}

// Worker-side: replace process.stdout/stderr/stdin with port-backed streams
// so the parent's Worker#stdout/#stderr/#stdin see the worker's output/input.
// Only applies when this worker was created via the node:worker_threads
// wrapper (i.e. the internal stdio port was passed through); Web Workers and
// workers that never load this module keep the real-fd-backed streams.
if (!isMainThread && $isJSArray(_internalData)) {
  const port = _internalData[0];
  const hasStdin = _internalData[1];
  if (port) {
    const handleMessage = message => {
      switch (message.type) {
        case STDIO_PAYLOAD: {
          if (message.stream === "stdin") {
            const { chunks } = message;
            for (let i = 0; i < chunks.length; i++) {
              const { chunk, encoding } = chunks[i];
              stdin.push(chunk, encoding);
            }
          }
          return;
        }
        case STDIO_WANTS_MORE_DATA: {
          const target = message.stream === "stdout" ? stdout : message.stream === "stderr" ? stderr : null;
          if (target) target[kStdioWantsMoreDataCallback]();
          return;
        }
      }
    };
    const listener = event => handleMessage((event as MessageEvent).data);

    // A transferred (entangled) MessagePort in Bun refs the event loop while
    // it has any 'message' listener (MessagePort::onDidChangeListenerImpl),
    // independently of jsRef()/jsUnref(). Present the stream classes with a
    // port-like object whose ref()/unref() add/remove that listener so an
    // idle worker can exit. While no listener is attached the port can still
    // postMessage; replies are drained synchronously in the 'exit' handler.
    let listening = false;
    const portWrap = {
      [kWaitingStreams]: 0,
      postMessage(msg) {
        port.postMessage(msg);
      },
      ref() {
        if (!listening) {
          listening = true;
          port.addEventListener("message", listener);
        }
      },
      unref() {
        if (listening) {
          listening = false;
          port.removeEventListener("message", listener);
        }
      },
    };

    const stdout = new WritableWorkerStdio(portWrap, "stdout");
    const stderr = new WritableWorkerStdio(portWrap, "stderr");
    const stdin = new ReadableWorkerStdio(portWrap, "stdin");
    if (!hasStdin) stdin.push(null);

    // Flush any in-flight writes (including ones made from inside 'exit'
    // handlers, where process._exiting is already true and _writev's
    // callback fires synchronously). Drain pending port messages first so
    // buffered writes get posted before the thread tears down.
    process.on("exit", () => {
      let msg;
      while ((msg = _receiveMessageOnPort(port)) !== undefined) {
        handleMessage(msg);
      }
      stdout[kStdioWantsMoreDataCallback]();
      stderr[kStdioWantsMoreDataCallback]();
    });

    const defineStdio = (name, stream) => {
      Object.defineProperty(process, name, {
        configurable: true,
        enumerable: true,
        get: () => stream,
        set: () => {},
      });
    };
    defineStdio("stdout", stdout);
    defineStdio("stderr", stderr);
    defineStdio("stdin", stdin);
  }
}

class Worker extends EventEmitter {
  #worker: WebWorker;
  #performance;

  // this is used by terminate();
  // either is the exit code if exited, a promise resolving to the exit code, or undefined if we haven't sent .terminate() yet
  #onExitPromise: Promise<number> | number | undefined = undefined;
  #urlToRevoke = "";

  #stdioPort: MessagePort;
  #stdin: InstanceType<typeof WritableWorkerStdio> | null;
  #stdout: InstanceType<typeof ReadableWorkerStdio>;
  #stderr: InstanceType<typeof ReadableWorkerStdio>;

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

    // Set up the internal stdio channel. port2 is transferred to the worker
    // via the native constructor's internal-data slot and surfaces as index 4
    // of createNodeWorkerThreadsBinding.
    const { port1, port2 } = new MessageChannel();
    this.#stdioPort = port1;
    port1[kWaitingStreams] = 0;
    const hasStdin = !!(options && options.stdin);

    try {
      this.#worker = new WebWorker(filename, options as Bun.WorkerOptions, this, [port2, hasStdin]);
    } catch (e) {
      if (this.#urlToRevoke) {
        URL.revokeObjectURL(this.#urlToRevoke);
      }
      port1.close();
      throw e;
    }
    this.#worker.addEventListener("close", this.#onClose.bind(this), { once: true });
    this.#worker.addEventListener("error", this.#onError.bind(this));
    this.#worker.addEventListener("message", this.#onMessage.bind(this));
    this.#worker.addEventListener("messageerror", this.#onMessageError.bind(this));
    this.#worker.addEventListener("open", this.#onOpen.bind(this), { once: true });

    this.#stdin = hasStdin ? new WritableWorkerStdio(port1, "stdin") : null;
    this.#stdout = new ReadableWorkerStdio(port1, "stdout");
    this.#stderr = new ReadableWorkerStdio(port1, "stderr");
    if (!(options && options.stdout)) {
      this.#stdout[kIncrementsPortRef] = false;
      pipeWithoutWarning(this.#stdout, process.stdout);
    }
    if (!(options && options.stderr)) {
      this.#stderr[kIncrementsPortRef] = false;
      pipeWithoutWarning(this.#stderr, process.stderr);
    }

    // addEventListener auto-starts the port but does not ref it; the worker
    // lifecycle (not this port) governs whether the parent stays alive.
    port1.addEventListener("message", event => this.#onStdioMessage((event as MessageEvent).data));
    port1.unref();

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
    return this.#stdin;
  }

  get stdout() {
    return this.#stdout;
  }

  get stderr() {
    return this.#stderr;
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

  #onStdioMessage(message) {
    switch (message.type) {
      case STDIO_PAYLOAD: {
        const { stream, chunks } = message;
        const readable = stream === "stdout" ? this.#stdout : stream === "stderr" ? this.#stderr : null;
        // A message event can already be queued when the worker's close
        // event runs #drainStdio() and ends the readables; don't push past
        // EOF if it lands afterwards.
        if (readable && !readable.readableEnded) {
          for (let i = 0; i < chunks.length; i++) {
            const { chunk, encoding } = chunks[i];
            readable.push(chunk, encoding);
          }
        }
        return;
      }
      case STDIO_WANTS_MORE_DATA: {
        if (message.stream === "stdin" && this.#stdin) {
          this.#stdin[kStdioWantsMoreDataCallback]();
        }
        return;
      }
    }
  }

  #drainStdio() {
    // The worker posts stdio messages over a MessagePort; the close event
    // arrives on a different queue (the Worker EventTarget). Drain whatever
    // is still sitting in the port so the caller observes all writes before
    // 'exit', including writes made from the worker's process.on('exit')
    // handler.
    let msg;
    while ((msg = _receiveMessageOnPort(this.#stdioPort)) !== undefined) {
      this.#onStdioMessage(msg);
    }
    if (!this.#stdout.readableEnded) this.#stdout.push(null);
    if (!this.#stderr.readableEnded) this.#stderr.push(null);
    // Release any pending stdin write callback so a write issued just
    // before the worker exited doesn't keep the parent's port reffed.
    // Node.js likewise leaves worker.stdin writable after exit; subsequent
    // writes go to a closed port and their callbacks simply never fire.
    if (this.#stdin) this.#stdin[kStdioWantsMoreDataCallback]();
    // close() removes the listener (no push-after-EOF from queued events)
    // and jsUnref()s the port so it stops contributing to the event loop.
    this.#stdioPort.close();
  }

  #onClose(e) {
    this.#drainStdio();
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
