// import type { Readable, Writable } from "node:stream";
// import type { WorkerOptions } from "node:worker_threads";
declare const self: typeof globalThis;
type WebWorker = InstanceType<typeof globalThis.Worker>;

const EventEmitter = require("node:events");
const Readable = require("internal/streams/readable");
const { throwNotImplemented, warnNotImplementedOnce } = require("internal/shared");
let Writable;

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

// worker.stdin / worker.stdout / worker.stderr are implemented by shipping a
// dedicated MessagePort to the worker through workerData. The worker side of
// node:worker_threads replaces process.stdout/stderr/stdin (and console) with
// port-backed streams; the parent exposes Readable/Writable streams fed by
// that port. A plain string key so it survives structured clone, like
// kJSTransferableMarker above.
const kBunStdioMarker = "__bunNodeWorkerStdio";

const STDIO_PAYLOAD = 0;

const kPort = Symbol("kPort");
const kName = Symbol("kName");
const kIncrementsPortRef = Symbol("kIncrementsPortRef");
const kStartedReading = Symbol("kStartedReading");
const kWaitingStreams = Symbol("kWaitingStreams");
const kOnRead = Symbol("kOnRead");

class ReadableWorkerStdio extends Readable {
  [kPort]: MessagePort;
  [kName]: string;
  [kIncrementsPortRef]: boolean;
  [kStartedReading]: boolean;
  [kOnRead]: (() => void) | undefined;

  constructor(port: MessagePort, name: string) {
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
    this[kOnRead]?.();
  }
}

let _WritableWorkerStdio: any;
function getWritableWorkerStdio() {
  if (_WritableWorkerStdio) return _WritableWorkerStdio;
  Writable ??= require("internal/streams/writable");
  _WritableWorkerStdio = class WritableWorkerStdio extends Writable {
    [kPort]: MessagePort;
    [kName]: string;

    constructor(port: MessagePort, name: string) {
      super({ decodeStrings: false });
      this[kPort] = port;
      this[kName] = name;
    }

    _writev(chunks: Array<{ chunk: unknown; encoding: string }>, cb: (err?: Error | null) => void) {
      const toSend = new Array(chunks.length);
      for (let i = 0; i < chunks.length; i++) {
        const { chunk, encoding } = chunks[i];
        toSend[i] = { chunk, encoding };
      }
      this[kPort].postMessage({ type: STDIO_PAYLOAD, stream: this[kName], chunks: toSend });
      cb();
    }

    _final(cb: () => void) {
      this[kPort].postMessage({ type: STDIO_PAYLOAD, stream: this[kName], chunks: [{ chunk: null, encoding: "" }] });
      cb();
    }
  };
  return _WritableWorkerStdio;
}

function dispatchStdioMessage(streams: Record<string, any>, message: any) {
  if (message?.type === STDIO_PAYLOAD) {
    const readable = streams[message.stream];
    const chunks = message.chunks;
    if (readable) {
      for (let i = 0; i < chunks.length; i++) {
        const { chunk, encoding } = chunks[i];
        readable.push(chunk, encoding);
      }
    }
  }
}

function overrideProcessStdio(name: string, getStream: () => any) {
  let stream;
  Object.defineProperty(process, name, {
    configurable: true,
    enumerable: true,
    get: () => {
      if (!stream) {
        stream = getStream();
        stream._isStdio = true;
      }
      return stream;
    },
    set: () => {},
  });
}

function setupWorkerStdio(info: { port: MessagePort; hasStdin: boolean }) {
  const port = info.port;
  port[kWaitingStreams] = 0;

  overrideProcessStdio("stdout", () => new (getWritableWorkerStdio())(port, "stdout"));
  overrideProcessStdio("stderr", () => new (getWritableWorkerStdio())(port, "stderr"));
  overrideProcessStdio("stdin", () => {
    const stdin = new ReadableWorkerStdio(port, "stdin");
    stdin[kIncrementsPortRef] = false;
    // Transferred MessagePorts take an event-loop ref for every message
    // listener that unref() does not release. Work around that by only
    // listening while stdin is actively being read; stdout/stderr flow in
    // the other direction so no listener is needed for them.
    let listening = false;
    const streams = { __proto__: null, stdin };
    const handler = (ev: MessageEvent) => dispatchStdioMessage(streams, ev.data);
    const stopListening = () => {
      if (listening) {
        listening = false;
        port.removeEventListener("message", handler);
        port.unref();
      }
    };
    if (!info.hasStdin) {
      stdin.push(null);
    } else {
      stdin[kOnRead] = () => {
        if (!listening) {
          listening = true;
          port.addEventListener("message", handler);
          port.start();
        }
      };
      stdin.once("end", stopListening);
      stdin.once("close", stopListening);
    }
    return stdin;
  });

  // Bun's native console writes straight to fd 1/2. Redirect the common
  // console methods to the port-backed streams without building a full
  // Console instance (which binds ~20 methods and costs hundreds of ms in
  // debug builds for every nested worker).
  const nativeConsole = globalThis.console;
  let format: (...args: unknown[]) => string;
  const consoleWriter = (target: "stdout" | "stderr") =>
    function (this: unknown, ...args: unknown[]) {
      format ??= require("node:util").format;
      process[target].write(format.$apply(undefined, args) + "\n");
    };
  const toStdout = consoleWriter("stdout");
  const toStderr = consoleWriter("stderr");
  const workerConsole = Object.create(nativeConsole, {
    log: { value: toStdout, writable: true, configurable: true, enumerable: true },
    info: { value: toStdout, writable: true, configurable: true, enumerable: true },
    debug: { value: toStdout, writable: true, configurable: true, enumerable: true },
    warn: { value: toStderr, writable: true, configurable: true, enumerable: true },
    error: { value: toStderr, writable: true, configurable: true, enumerable: true },
  });
  globalThis.console = workerConsole;
}

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

let workerData = _workerData;
if (
  !isMainThread &&
  workerData !== null &&
  typeof workerData === "object" &&
  Object.prototype.hasOwnProperty.$call(workerData, kBunStdioMarker)
) {
  const info = workerData[kBunStdioMarker];
  workerData = workerData.data;
  if (info && info.port instanceof _MessagePort) {
    setupWorkerStdio(info);
  }
}
workerData = unpackJSTransferables(workerData);
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
  #performance;

  // this is used by terminate();
  // either is the exit code if exited, a promise resolving to the exit code, or undefined if we haven't sent .terminate() yet
  #onExitPromise: Promise<number> | number | undefined = undefined;
  #urlToRevoke = "";

  #stdioPort: MessagePort;
  #stdin: any = null;
  #stdout: ReadableWorkerStdio;
  #stderr: ReadableWorkerStdio;

  constructor(filename: string, options: NodeWorkerOptions = {}) {
    super();

    options = packJSTransferables(options);

    const hasStdin = !!(options && options.stdin);
    const captureStdout = !!(options && options.stdout);
    const captureStderr = !!(options && options.stderr);
    const stdioChannel = new MessageChannel();
    this.#stdioPort = stdioChannel.port1;
    this.#stdioPort[kWaitingStreams] = 0;

    if (hasStdin) this.#stdin = new (getWritableWorkerStdio())(this.#stdioPort, "stdin");
    this.#stdout = new ReadableWorkerStdio(this.#stdioPort, "stdout");
    this.#stderr = new ReadableWorkerStdio(this.#stdioPort, "stderr");
    // Readable.prototype.pipe is significantly slower than a plain data
    // listener and would add three listeners to process.stdout/stderr for
    // every Worker (tripping MaxListenersExceededWarning in pool setups),
    // so forward chunks manually when the user is not capturing.
    if (!captureStdout) {
      this.#stdout[kIncrementsPortRef] = false;
      this.#stdout.on("data", chunk => process.stdout.write(chunk));
    }
    if (!captureStderr) {
      this.#stderr[kIncrementsPortRef] = false;
      this.#stderr.on("data", chunk => process.stderr.write(chunk));
    }
    const parentStreams = { __proto__: null, stdin: this.#stdin, stdout: this.#stdout, stderr: this.#stderr };
    this.#stdioPort.onmessage = ({ data }) => dispatchStdioMessage(parentStreams, data);
    this.#stdioPort.unref();

    options = {
      ...options,
      workerData: {
        [kBunStdioMarker]: { port: stdioChannel.port2, hasStdin },
        data: options?.workerData,
      },
      transferList:
        $isArray(options?.transferList) && options.transferList.length > 0
          ? [...options.transferList, stdioChannel.port2]
          : [stdioChannel.port2],
    };

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
      // Restore any transferList handles that were already neutered by
      // packJSTransferables, so their fds aren't orphaned.
      options[kRestoreJSTransferables]?.();
      if (this.#urlToRevoke) {
        URL.revokeObjectURL(this.#urlToRevoke);
      }
      this.#stdioPort.onmessage = null;
      this.#stdioPort.close();
      stdioChannel.port2.close();
      throw e;
    }
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

  #onClose(e) {
    this.#onExitPromise = e.code;
    if (!this.#stdout.readableEnded) this.#stdout.push(null);
    if (!this.#stderr.readableEnded) this.#stderr.push(null);
    this.#stdioPort.onmessage = null;
    this.#stdioPort.close();
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
  receiveMessageOnPort,
  SHARE_ENV,
  threadId,
};
