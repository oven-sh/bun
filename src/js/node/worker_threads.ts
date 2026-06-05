// import type { Readable, Writable } from "node:stream";
// import type { WorkerOptions } from "node:worker_threads";
declare const self: typeof globalThis;
type WebWorker = InstanceType<typeof globalThis.Worker>;

const EventEmitter = require("node:events");
const Readable = require("internal/streams/readable");
const Writable = require("internal/streams/writable");
const { throwNotImplemented, warnNotImplementedOnce } = require("internal/shared");
const {
  validateString,
  validateObject,
  validateInteger,
  validateNumber,
  validateBoolean,
} = require("internal/validators");

// node's name handling (lib/internal/worker.js): default "WorkerThread", validate + trim when provided.
function normalizeWorkerName(rawName) {
  // node gates on `!== undefined`, not truthiness: {name: 0|null|false} must
  // throw ERR_INVALID_ARG_TYPE (via validateString) and {name: ""} stays "".
  if (rawName !== undefined) {
    validateString(rawName, "options.name");
    return rawName.trim();
  }
  return "WorkerThread";
}

const { isAbsolute: pathIsAbsolute } = require("node:path");

// node's filename validation for non-eval workers: absolute or "./"/"../"-relative
// paths and file: URL objects; bare specifiers and string URLs are rejected.
function validateWorkerFilename(filename) {
  if (filename instanceof URL) {
    if (filename.protocol === "data:") return `${filename}`;
    // throws ERR_INVALID_URL_SCHEME (TypeError) for non-file: URLs
    return Bun.fileURLToPath(filename);
  }
  if (typeof filename !== "string") {
    // Not a string or URL: defer to the native Worker constructor, which
    // throws the canonical ERR_INVALID_ARG_TYPE with the exact node message.
    return filename;
  }
  const sep = String.fromCharCode(92); // backslash, avoids builtin-bundler escape handling
  if (
    pathIsAbsolute(filename) ||
    filename.startsWith("./") ||
    filename.startsWith("../") ||
    filename.startsWith("." + sep) ||
    filename.startsWith(".." + sep)
  ) {
    return filename;
  }
  let message =
    "The worker script or module filename must be an absolute path or a relative path starting with './' or '../'.";
  if (filename.startsWith("file://")) {
    message += " Wrap file:// URLs with `new URL`.";
  }
  if (filename.startsWith("data:text/javascript")) {
    message += " Wrap data: URLs with `new URL`.";
  }
  message += ` Received "${filename}"`;
  const err = new TypeError(message);
  err.code = "ERR_WORKER_PATH";
  throw err;
}

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
const SHARE_ENV = Symbol.for("nodejs.worker_threads.SHARE_ENV");

const isMainThread = Bun.isMainThread;
const {
  0: _workerData,
  1: _threadId,
  2: _receiveMessageOnPort,
  3: environmentData,
  4: _threadName,
  5: _isMessagePortActive,
} = $cpp("Worker.cpp", "createNodeWorkerThreadsBinding") as [
  unknown,
  number,
  (port: unknown) => unknown,
  Map<unknown, unknown>,
  string,
  (port: unknown) => boolean,
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

  function customEventHandler(event) {
    return event.detail;
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

      case "message": {
        return wrapped(messageEventHandler, listener);
      }

      default: {
        return wrapped(customEventHandler, listener);
      }
    }
  }

  function EventClass(eventName) {
    if (eventName === "error" || eventName === "messageerror") {
      return ErrorEvent;
    }

    return MessageEvent;
  }

  function on(event, listener) {
    this.addEventListener(event, functionForEventType(event, listener));
    return this;
  }

  function off(event, listener) {
    if (listener) {
      this.removeEventListener(event, listener[wrappedListener] || listener);
    } else {
      this.removeEventListener(event);
    }
    return this;
  }

  function once(event, listener) {
    this.addEventListener(event, functionForEventType(event, listener), { once: true });
    return this;
  }

  function emit(event, ...args) {
    switch (event) {
      case "error":
      case "messageerror":
      case "message":
        this.dispatchEvent(new (EventClass(event))(event, ...args));
        break;
      default:
        // Non-standard events surface as CustomEvent (detail = first arg) to
        // addEventListener and as the raw argument to .on(), matching node.
        this.dispatchEvent(new CustomEvent(event, { detail: args[0] }));
        break;
    }
    return this;
  }

  // node inherits these from EventEmitter.prototype; use an intermediate prototype
  // so Object.getOwnPropertyNames(MessagePort.prototype) matches node.
  const proto = Class.prototype;
  const inherited = Object.create(Object.getPrototypeOf(proto));
  // node aliases: prepend* and addListener/removeListener map onto on/once/off.
  const emitterMethods: [string, Function][] = [
    ["on", on],
    ["off", off],
    ["once", once],
    ["emit", emit],
    ["prependListener", on],
    ["prependOnceListener", once],
    ["addListener", on],
    ["removeListener", off],
  ];
  for (const [methodName, value] of emitterMethods) {
    Object.defineProperty(inherited, methodName, { value, writable: true, enumerable: false, configurable: true });
  }
  Object.setPrototypeOf(proto, inherited);
}

const _MessagePort = globalThis.MessagePort;
injectFakeEmitter(_MessagePort);

const MessagePort = _MessagePort;

// node's close(cb) registers cb as a one-time "close" listener before the native close.
// closedMessagePorts lets moveMessagePortToContext report ERR_CLOSED_MESSAGE_PORT.
const closedMessagePorts = new WeakSet();
const nativeMessagePortClose = MessagePort.prototype.close;
Object.defineProperty(MessagePort.prototype, "close", {
  value: function close(cb) {
    closedMessagePorts.add(this);
    // Native close() now dispatches the "close" event (after delivering any
    // queued messages). node invokes the optional callback asynchronously.
    const result = nativeMessagePortClose.$call(this);
    if (typeof cb === "function") {
      queueMicrotask(cb);
    }
    return result;
  },
  writable: true,
  enumerable: true,
  configurable: true,
});

// node-style util.inspect output for MessagePort (shows whether the channel is
// still active). Symbol-keyed so it does not appear in getOwnPropertyNames.
const kInspectCustom = Symbol.for("nodejs.util.inspect.custom");
Object.defineProperty(MessagePort.prototype, kInspectCustom, {
  value: function (_depth, _options) {
    return `MessagePort [EventTarget] { active: ${_isMessagePortActive(this)}, refed: ${this.hasRef()} }`;
  },
  writable: true,
  enumerable: false,
  configurable: true,
});

let resourceLimits = {};

const BUN_WORKER_STDIO_KEY = "@@bunWorkerThreadsStdio";
const BUN_WORKER_MESSAGING_KEY = "@@bunWorkerThreadsMessaging";

// Captured stdio rides a dedicated MessageChannel per stream with node's flow
// control (lib/internal/worker/io.js): the writer posts an array of chunks
// (STDIO_PAYLOAD) and withholds the writev callback until the reader posts an
// ack (STDIO_WANTS_MORE_DATA) from _read(). One batch is in flight at a time;
// further writes buffer in the Writable, so write() returns false and 'drain'
// fires only when the consumer catches up — end-to-end backpressure. Since
// each stream has its own port (node multiplexes one env port), the payload is
// the bare chunk array, EOF is null, and any other message is the ack.

// Readable fed by a control MessagePort (worker.stdout/stderr on the parent,
// process.stdin in the worker). The peer posts arrays of Buffers; null signals EOF.
function makePortReadable(port) {
  let attached = false;
  let ended = false;
  function onMessage(payload) {
    if (payload === null) {
      if (ended === false) {
        ended = true;
        stream.push(null);
      }
      // Drop the listener so the control port stops holding the event loop
      // open once the stream has ended.
      port.off("message", onMessage);
    } else if (ended === false) {
      for (let i = 0; i < payload.length; i++) {
        stream.push(Buffer.from(payload[i]));
      }
    }
  }
  // Attach the 'message' listener lazily on first read(): a listener refs the event
  // loop, which would keep a { stdin: true } worker alive even if stdin is never read.
  const stream = new Readable({
    read() {
      if (attached === false && ended === false) {
        attached = true;
        port.on("message", onMessage);
      }
      // Tell the writer we want more data; it completes its in-flight writev
      // on receipt (node's STDIO_WANTS_MORE_DATA).
      if (ended === false) port.postMessage(true);
    },
  });
  // Lets the parent end worker.stdout/stderr when the worker exits abruptly.
  stream.endFromOwner = function () {
    if (ended === false) {
      ended = true;
      stream.push(null);
      // Drop the listener so the port stops holding the event loop open once
      // the owner (worker exit) has ended the stream.
      port.off("message", onMessage);
    }
  };
  return stream;
}

// Writable that forwards chunks over a control MessagePort (worker.stdin on the
// parent, process.stdout/stderr in the worker). final() posts null as EOF.
function makePortWritable(port) {
  // Reader-side acks complete the in-flight writev. The listener refs the
  // event loop; release that immediately — the port is re-ref'd only while a
  // batch is awaiting its ack, so unflushed data keeps the writer alive
  // (node's kWaitingStreams) but an idle stream never pins the loop.
  let pendingWriteCallback: (() => void) | null = null;
  function onAck() {
    const cb = pendingWriteCallback;
    if (cb !== null) {
      pendingWriteCallback = null;
      port.unref();
      cb();
    }
  }
  port.on("message", onAck);
  port.unref();
  return new Writable({
    decodeStrings: false,
    writev(chunks, cb) {
      const payload = new Array(chunks.length);
      for (let i = 0; i < chunks.length; i++) {
        const { chunk, encoding } = chunks[i];
        payload[i] = typeof chunk === "string" ? Buffer.from(chunk, encoding) : chunk;
      }
      port.postMessage(payload);
      if (process._exiting) {
        // No event loop turns remain to deliver an ack; complete synchronously
        // so exit-time writes are not lost (node does the same).
        cb();
      } else {
        // Only one writev is in flight at a time, so the slot can't be occupied.
        pendingWriteCallback = cb;
        port.ref();
      }
    },
    final(cb) {
      port.postMessage(null);
      cb();
    },
  });
}

function setupWorkerStdio(stdio) {
  if (stdio.stdout) {
    Object.defineProperty(process, "stdout", {
      value: makePortWritable(stdio.stdout),
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
  if (stdio.stderr) {
    Object.defineProperty(process, "stderr", {
      value: makePortWritable(stdio.stderr),
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
  // node always replaces a worker's process.stdin: port-backed when { stdin: true },
  // otherwise an immediately-EOF'd stream — never the process-wide fd 0, which
  // would race the main thread (and hang on a TTY).
  Object.defineProperty(process, "stdin", {
    value: stdio.stdin
      ? makePortReadable(stdio.stdin)
      : new Readable({
          read() {
            this.push(null);
          },
        }),
    writable: true,
    configurable: true,
    enumerable: true,
  });
  // node routes console.log through process.stdout/stderr; Bun's global console
  // writes the fd directly, so rebind it to the captured streams when present.
  if (stdio.stdout || stdio.stderr) {
    const { Console } = require("node:console");
    globalThis.console = new Console(process.stdout, process.stderr);
  }
}

let workerData = _workerData;
let threadId = _threadId;
// node: main thread name is "", worker default is "WorkerThread" (trimmed).
const threadName = isMainThread ? "" : (_threadName ?? "WorkerThread");
// postMessageToThread (Node 22+): the Worker ctor always smuggles a control
// MessagePort to the worker by wrapping workerData; unwrap it here.
const messaging = require("internal/worker/messaging");
messaging.initThreadInfo(threadId, isMainThread);
// Captured stdio + the messaging control port ride inside workerData (wrapped;
// ports transferred). Unwrap and bind the worker's stdio / messaging hub.
if (
  workerData &&
  typeof workerData === "object" &&
  (BUN_WORKER_STDIO_KEY in workerData || BUN_WORKER_MESSAGING_KEY in workerData)
) {
  const stdioPorts = workerData[BUN_WORKER_STDIO_KEY];
  const controlPort = workerData[BUN_WORKER_MESSAGING_KEY];
  workerData = workerData.data;
  if (stdioPorts) setupWorkerStdio(stdioPorts);
  if (controlPort) messaging.setupMainThreadPort(controlPort);
}
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

// In a worker, several process operations are unsupported (node disables them).
if (!isMainThread) {
  applyWorkerProcessOverrides();
}
function applyWorkerProcessOverrides() {
  const proc: any = process;
  // node defaults debugPort to 9229 in workers (still settable). Per-object property:
  // the static accessor's setter writes a process-global shared across threads.
  try {
    Object.defineProperty(proc, "debugPort", { value: 9229, writable: true, configurable: true, enumerable: true });
  } catch {}
  // These main-only internals are absent on a worker's process.
  for (const k of ["_startProfilerIdleNotifier", "_stopProfilerIdleNotifier", "_debugProcess", "_debugEnd"]) {
    try {
      delete proc[k];
    } catch {}
  }
  // process.umask(setMask) is unsupported in workers; the getter still works.
  const realUmask = proc.umask;
  function umask(mask?: unknown) {
    if (mask === undefined) return realUmask.$call(proc);
    throw $ERR_WORKER_UNSUPPORTED_OPERATION("Setting process.umask() is not supported in workers");
  }
  proc.umask = umask;
  // Disabled, throwing stubs (each carries `.disabled === true`, like node).
  const disabled = ["abort", "chdir"];
  if (process.platform !== "win32") {
    disabled.push("setuid", "seteuid", "setgid", "setegid", "setgroups", "initgroups");
  }
  // node only disables send/disconnect/channel/connected in workers that inherited an
  // IPC channel (NODE_CHANNEL_FD); otherwise they stay absent so `if (process.send)` works.
  const hasIpc = !!process.env.NODE_CHANNEL_FD;
  if (hasIpc) {
    disabled.push("send", "disconnect");
  }
  for (const name of disabled) {
    const stub: any = function () {
      throw $ERR_WORKER_UNSUPPORTED_OPERATION(`process.${name}() is not supported in workers`);
    };
    stub.disabled = true;
    Object.defineProperty(proc, name, { configurable: true, writable: true, enumerable: true, value: stub });
  }
  // IPC accessors throw on access only in a worker that inherited an IPC channel.
  if (hasIpc) {
    for (const name of ["channel", "connected"]) {
      Object.defineProperty(proc, name, {
        configurable: true,
        enumerable: false,
        get() {
          throw $ERR_WORKER_UNSUPPORTED_OPERATION(`process.${name} is not supported in workers`);
        },
      });
    }
  }
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

const kUntransferable = Symbol.for("nodejs.worker_threads.untransferable");
const kUncloneable = Symbol.for("nodejs.worker_threads.uncloneable");

function markAsUntransferable(obj) {
  if ((typeof obj !== "object" && typeof obj !== "function") || obj === null) return;
  Object.defineProperty(obj, kUntransferable, { value: true, enumerable: false, configurable: true, writable: true });
}

function isMarkedAsUntransferable(obj) {
  if (obj == null) return false;
  return Object.hasOwn(obj, kUntransferable);
}

function markAsUncloneable(obj) {
  if ((typeof obj !== "object" && typeof obj !== "function") || obj === null) return;
  Object.defineProperty(obj, kUncloneable, { value: true, enumerable: false, configurable: true, writable: true });
}

function moveMessagePortToContext(port, _context) {
  if (port instanceof MessagePort) {
    if (closedMessagePorts.has(port)) {
      throw $ERR_CLOSED_MESSAGE_PORT("Cannot send data on closed MessagePort");
    }
  } else {
    throw $ERR_INVALID_ARG_TYPE("port", "MessagePort", port);
  }
  throwNotImplemented("worker_threads.moveMessagePortToContext");
}

class Worker extends EventEmitter {
  #worker: WebWorker;
  #performance;
  #name: string;
  #exited = false;
  #stdinPort;
  #stdoutPort;
  #stderrPort;
  #stdin;
  #stdout;
  #stderr;
  #stdoutAutoPipe = false;
  #stderrAutoPipe = false;

  // this is used by terminate();
  // either is the exit code if exited, a promise resolving to the exit code, or undefined if we haven't sent .terminate() yet
  #onExitPromise: Promise<number> | number | undefined = undefined;
  #urlToRevoke = "";
  // threadId captured for cleaning up the messaging control port on close.
  #messagingThreadId: number | undefined = undefined;

  constructor(filename: string, options: NodeWorkerOptions = {}) {
    super();

    // The `= {}` default only covers undefined; normalize null too so the
    // option accesses below don't throw on `new Worker(file, null)`.
    options ??= {};

    this.#name = normalizeWorkerName(options.name);

    const builtinsGeneratorHatesEval = "ev" + "a" + "l"[0];
    if (options[builtinsGeneratorHatesEval]) {
      // node requires the source to be a string when eval is set, rather than
      // letting Blob coerce a URL/object to a confusing SyntaxError later.
      if (typeof filename !== "string")
        throw $ERR_INVALID_ARG_VALUE(
          "options.eval",
          options[builtinsGeneratorHatesEval],
          "must be false when 'filename' is not a string",
        );
      // eval: the source becomes a blob: URL the worker imports as its entry point.
      // The URL must outlive the worker: revoked on constructor failure (catch below),
      // on exit (#onClose), and via urlRevokeRegistry as a GC safety net.
      const blob = new Blob([filename], { type: "" });
      this.#urlToRevoke = filename = URL.createObjectURL(blob);
    } else {
      // node validates the worker path when not running eval'd code (eval:false
      // is equivalent to omitting eval).
      filename = validateWorkerFilename(filename);
    }

    // Captured stdio: one control MessageChannel per requested stream; the parent keeps
    // one end, the other rides in workerData and the worker rebinds its stdio to it.
    const stdioForWorker: any = {};
    const stdioTransfer: any[] = [];
    if (options.stdin) {
      const channel = new MessageChannel();
      this.#stdinPort = channel.port1;
      stdioForWorker.stdin = channel.port2;
      stdioTransfer.push(channel.port2);
    }
    // worker.stdout/stderr are always Readables fed by the worker; without capture
    // they auto-pipe to the parent's stdio so output still surfaces.
    {
      const channel = new MessageChannel();
      this.#stdoutPort = channel.port1;
      stdioForWorker.stdout = channel.port2;
      stdioTransfer.push(channel.port2);
      if (!options.stdout) this.#stdoutAutoPipe = true;
    }
    {
      const channel = new MessageChannel();
      this.#stderrPort = channel.port1;
      stdioForWorker.stderr = channel.port2;
      stdioTransfer.push(channel.port2);
      if (!options.stderr) this.#stderrAutoPipe = true;
    }
    // Control channel for postMessageToThread; wrap workerData so the control and
    // stdio ports ride along transferred.
    const { portToMain, portToWorker } = messaging.createMessagingChannel();
    const workerDataWrapper: any = { [BUN_WORKER_MESSAGING_KEY]: portToWorker, data: options.workerData };
    // stdout/stderr always create channels (stdin only when requested), so the
    // worker always receives a stdio control object.
    workerDataWrapper[BUN_WORKER_STDIO_KEY] = stdioForWorker;
    options = {
      ...options,
      // Pass the parent's already-normalized/validated name so the worker can
      // use it verbatim (native cannot distinguish omitted from explicit "").
      name: this.#name,
      workerData: workerDataWrapper,
      transferList: options.transferList
        ? [...options.transferList, portToWorker, ...stdioTransfer]
        : [portToWorker, ...stdioTransfer],
    };

    // env: SHARE_ENV becomes a native boolean flag so it passes native option
    // validation and the native side skips the env snapshot and shares the store.
    if ((options as any).env === SHARE_ENV) {
      options = { ...options, env: undefined, shareEnv: true } as NodeWorkerOptions;
    } else if ((options as any).shareEnv !== undefined) {
      // shareEnv is internal — only `env: SHARE_ENV` may enable it. Strip a
      // user-supplied value so it can't trigger env sharing on its own.
      options = { ...options, shareEnv: undefined } as NodeWorkerOptions;
    }
    try {
      // node runs its worker bootstrap before user code; preload the
      // worker_threads module so process.stdin/stdout/stderr are always rebound,
      // even when the worker never requires it.
      const userPreload = (options as any).preload;
      options = {
        ...options,
        preload: [
          "node:worker_threads",
          ...(Array.isArray(userPreload) ? userPreload : userPreload ? [userPreload] : []),
        ],
      } as NodeWorkerOptions;
      this.#worker = new WebWorker(filename, options as Bun.WorkerOptions, this);
      // Uncaptured stdio forwards to the parent's stdio. Keep these ports unref'd:
      // the worker's own ref keeps the parent alive, and unref() must still let it exit.
      if (this.#stdoutAutoPipe) {
        // 'data' instead of pipe(): pipe() adds an error listener on the shared
        // process.stdout per worker, tripping MaxListenersExceededWarning.
        this.stdout.on("data", chunk => process.stdout.write(chunk));
        this.#stdoutPort.unref();
      }
      if (this.#stderrAutoPipe) {
        this.stderr.on("data", chunk => process.stderr.write(chunk));
        this.#stderrPort.unref();
      }
    } catch (e) {
      if (this.#urlToRevoke) {
        URL.revokeObjectURL(this.#urlToRevoke);
      }
      throw e;
    }
    // threadId is only assigned once the WebWorker exists; register the hub-side
    // control port with the messaging hub now.
    this.#messagingThreadId = this.#worker.threadId;
    messaging.registerMainThreadPort(this.#messagingThreadId, portToMain);
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

  get threadName() {
    return this.#exited ? null : this.#name;
  }

  ref() {
    this.#worker.ref();
    // Captured stdio ports follow the worker's ref state; auto-piped ports stay
    // unref'd (the worker's own ref governs them).
    if (!this.#stdoutAutoPipe) this.#stdoutPort?.ref();
    if (!this.#stderrAutoPipe) this.#stderrPort?.ref();
    this.#stdinPort?.ref();
  }

  unref() {
    this.#worker.unref();
    if (!this.#stdoutAutoPipe) this.#stdoutPort?.unref();
    if (!this.#stderrAutoPipe) this.#stderrPort?.unref();
    this.#stdinPort?.unref();
  }

  get stdin() {
    if (this.#stdinPort === undefined) return null;
    if (this.#stdin === undefined) {
      this.#stdin = makePortWritable(this.#stdinPort);
      // If the worker already exited, destroy immediately so writes fail with
      // ERR_STREAM_DESTROYED instead of silently no-oping into a closed peer.
      if (this.#exited) this.#stdin.destroy();
    }
    return this.#stdin;
  }

  get stdout() {
    if (this.#stdoutPort === undefined) return null;
    if (this.#stdout === undefined) {
      this.#stdout = makePortReadable(this.#stdoutPort);
      // If the worker already exited, end immediately: a late first access
      // would otherwise ref the parent loop with no release (peer gone) -> hang.
      if (this.#exited) this.#stdout.endFromOwner();
    }
    return this.#stdout;
  }

  get stderr() {
    if (this.#stderrPort === undefined) return null;
    if (this.#stderr === undefined) {
      this.#stderr = makePortReadable(this.#stderrPort);
      if (this.#exited) this.#stderr.endFromOwner();
    }
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
    // Not a truthy test: after exit #onExitPromise is the exit code, which can be 0;
    // falling through would wait on a 'close' event that never fires again.
    if (onExitPromise !== undefined) {
      // node: terminate() on an already-exited worker resolves with undefined;
      // an in-progress terminate (a promise) resolves with the exit code below.
      return $isPromise(onExitPromise) ? onExitPromise : Promise.$resolve(undefined);
    }

    const { resolve, promise } = Promise.withResolvers();
    this.#worker.addEventListener(
      "close",
      event => {
        resolve(event.code);
      },
      { once: true },
    );
    // Keep the event loop alive until termination completes so the returned
    // promise still resolves even if the worker was unref()'ed.
    this.#worker.ref();
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

  getHeapStatistics() {
    return this.#worker.getHeapStatistics();
  }

  startCpuProfile(options?: { sampleInterval?: number; maxBufferSize?: number }) {
    // node validates synchronously before starting; the underlying JSC sampler
    // ignores these knobs but the range checks must still match.
    if (options !== undefined && options !== null) {
      validateObject(options, "options");
      if (options.maxBufferSize !== undefined) validateInteger(options.maxBufferSize, "options.maxBufferSize", 1);
      if (options.sampleInterval !== undefined) validateNumber(options.sampleInterval, "options.sampleInterval");
    }
    return this.#worker.startCpuProfileInternal().then(() => {
      // Cache so a second stop() returns the first call's profile (node caches
      // on the handle) instead of the canned empty profile.
      let stopped;
      return { stop: () => (stopped ??= this.#worker.stopCpuProfileInternal()) };
    });
  }

  cpuUsage(prevValue?: { user: number; system: number }) {
    if (prevValue) {
      validateObject(prevValue, "prevValue");
      validateNumber(prevValue.user, "prevValue.user");
      if (prevValue.user < 0 || !Number.isFinite(prevValue.user))
        throw $ERR_OUT_OF_RANGE("prevValue.user", ">= 0 and a finite number", prevValue.user);
      validateNumber(prevValue.system, "prevValue.system");
      if (prevValue.system < 0 || !Number.isFinite(prevValue.system))
        throw $ERR_OUT_OF_RANGE("prevValue.system", ">= 0 and a finite number", prevValue.system);
    }
    return this.#worker
      .cpuUsageInternal()
      .then((abs: { user: number; system: number }) =>
        prevValue ? { user: abs.user - prevValue.user, system: abs.system - prevValue.system } : abs,
      );
  }

  startHeapProfile(options?: object) {
    if (options !== undefined && options !== null) {
      validateObject(options, "options");
      const o = options as any;
      if (o.sampleInterval !== undefined) validateInteger(o.sampleInterval, "options.sampleInterval", 1);
      if (o.stackDepth !== undefined) validateInteger(o.stackDepth, "options.stackDepth", 0);
      if (o.forceGC !== undefined) validateBoolean(o.forceGC, "options.forceGC");
      if (o.includeObjectsCollectedByMajorGC !== undefined)
        validateBoolean(o.includeObjectsCollectedByMajorGC, "options.includeObjectsCollectedByMajorGC");
      if (o.includeObjectsCollectedByMinorGC !== undefined)
        validateBoolean(o.includeObjectsCollectedByMinorGC, "options.includeObjectsCollectedByMinorGC");
    }
    if (this.#exited) {
      return Promise.$reject($ERR_WORKER_NOT_RUNNING("Worker instance not running"));
    }
    // Bun has no allocation-sampling heap profiler; yield a valid but empty
    // v8 sampling-heap-profile so the handle/stop() shape matches node.
    const empty =
      '{"head":{"callFrame":{"functionName":"(root)","scriptId":"0","url":"","lineNumber":-1,"columnNumber":-1},"selfSize":0,"id":1,"children":[]},"samples":[]}';
    return Promise.$resolve({ stop: () => Promise.$resolve(empty) });
  }

  #onClose(e) {
    this.#exited = true;
    // Revoke the eval blob: URL now that the worker has exited; the
    // FinalizationRegistry remains only as a GC safety net.
    if (this.#urlToRevoke) {
      URL.revokeObjectURL(this.#urlToRevoke);
      this.#urlToRevoke = "";
    }
    if (this.#messagingThreadId !== undefined) {
      messaging.destroyMainThreadPort(this.#messagingThreadId);
      this.#messagingThreadId = undefined;
    }
    // End captured stdio readables when the worker exits, even if it was
    // terminated before its own streams finished.
    if (this.#stdout) {
      this.#stdout.endFromOwner();
    }
    if (this.#stderr) {
      this.#stderr.endFromOwner();
    }
    // Close the captured stdout/stderr control ports so worker.ref() can't pin the
    // parent loop after exit (mirrors #stdinPort below).
    this.#stdoutPort?.close();
    this.#stderrPort?.close();
    // Tear down the parent-side stdin Writable + port so post-exit writes fail
    // (ERR_STREAM_DESTROYED) instead of silently no-oping into a closed peer.
    if (this.#stdin) {
      this.#stdin.destroy();
    }
    this.#stdinPort?.close();
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
    // Reshape the native 'ModuleNotFound ... (entry point)' error into node's
    // "Cannot find module '<path>'" (MODULE_NOT_FOUND).
    if (typeof error?.message === "string" && error.message.includes("(entry point)")) {
      const m = /ModuleNotFound resolving "(.+?)"/.exec(error.message);
      if (m) {
        error = new Error(`Cannot find module '${m[1]}'`, { cause: error });
        (error as any).code = "MODULE_NOT_FOUND";
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
  // No bun thread is a node-internal (loader-hook) thread.
  isInternalThread: false,
  MessageChannel,
  BroadcastChannel,
  MessagePort,
  getEnvironmentData,
  setEnvironmentData,
  markAsUntransferable,
  markAsUncloneable,
  isMarkedAsUntransferable,
  moveMessagePortToContext,
  postMessageToThread: messaging.postMessageToThread,
  receiveMessageOnPort,
  SHARE_ENV,
  threadId,
  threadName,
  // Worker title for node:inspector's NodeWorker.attachedToWorker, exposed via a
  // well-known symbol so inspector.ts can read it without a public export.
  [Symbol.for("nodejs.worker_threads.inspectorTitle")]: isMainThread ? undefined : `[worker ${threadId}] ${threadName}`,
};
