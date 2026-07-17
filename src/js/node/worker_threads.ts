// import type { Readable, Writable } from "node:stream";
// import type { WorkerOptions } from "node:worker_threads";
declare const self: typeof globalThis;
type WebWorker = InstanceType<typeof globalThis.Worker>;

const EventEmitter = require("node:events");
const { SafeMap } = require("internal/primordials");
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

// node's name handling (lib/internal/worker.js): truthy → validateString + trim,
// falsy (undefined/null/0/"") → default "". So {name: 0|null} is silently ignored.
function normalizeWorkerName(rawName) {
  if (rawName) {
    validateString(rawName, "options.name");
    return rawName.trim();
  }
  return "";
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
  if (pathIsAbsolute(filename) || /^\.\.?[\\/]/.test(filename)) {
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
  throw $ERR_WORKER_PATH(message);
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
  6: _markAsUntransferable,
  7: _isMarkedAsUntransferable,
  8: _markAsUncloneable,
  9: _setEntryEvaluatedHook,
  10: _isNodeWorker,
} = $cpp("Worker.cpp", "createNodeWorkerThreadsBinding") as [
  unknown,
  number,
  (port: unknown) => unknown,
  Map<unknown, unknown>,
  string,
  (port: unknown) => boolean,
  (value: unknown) => void,
  (value: unknown) => boolean,
  (value: unknown) => void,
  (hook: () => void) => void,
  boolean,
];

type NodeWorkerOptions = import("node:worker_threads").WorkerOptions;

// Used to ensure that Blobs created to hold the source code for `eval: true` Workers get cleaned up
// after their Worker exits
let urlRevokeRegistry: FinalizationRegistry<string> | undefined = undefined;

function injectFakeEmitter(Class) {
  // Per-instance registry mapping each event to (user listener -> wrapper), so
  // listenerCount/eventNames/removeAllListeners work over EventTarget's opaque
  // internal map and off() can find the wrapper a given listener registered.
  // SafeMap: its prototype is a frozen, null-proto snapshot of Map.prototype, so
  // .get/.set/.size/.values()/iteration all bypass a user-replaced Map.prototype.
  // (It has no @get/@set private names, so the $-intrinsics don't apply to it.)
  // Keyed by a module-local symbol, not a WeakMap — WeakMap has neither defence.
  const kListenerRegistry = Symbol("listenerRegistry");
  function registryFor(target, create) {
    let map = target[kListenerRegistry];
    if (!map && create) target[kListenerRegistry] = map = new SafeMap();
    return map;
  }

  function messageEventHandler(event: MessageEvent) {
    return event.data;
  }

  function errorEventHandler(event: ErrorEvent) {
    return event.error;
  }

  function customEventHandler(event) {
    return event.detail;
  }

  function wrapped(run, listener) {
    return function (event) {
      return listener(run(event));
    };
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

  // EventTarget dedupes on (type, callback), so in node the FIRST registration of
  // a listener wins outright -- including its once-ness -- and later adds of the
  // same function are no-ops. Keying wrappers per listener reproduces that.
  function register(target, event, listener, wrapper, options) {
    const map = registryFor(target, true)!;
    let byListener = map.get(event);
    if (!byListener) map.set(event, (byListener = new SafeMap()));
    if (byListener.has(listener)) return false;
    target.addEventListener(event, wrapper, options);
    byListener.set(listener, wrapper);
    return true;
  }

  function on(event, listener) {
    register(this, event, listener, functionForEventType(event, listener), undefined);
    return this;
  }

  function off(event, listener) {
    if (listener) {
      const byListener = registryFor(this, false)?.get(event);
      const wrapper = byListener?.get(listener) ?? listener;
      this.removeEventListener(event, wrapper);
      byListener?.delete(listener);
    } else {
      this.removeEventListener(event);
    }
    return this;
  }

  function once(event, listener) {
    const wrapper = functionForEventType(event, listener);
    const target = this;
    // EventTarget drops a {once:true} listener natively, without telling the
    // registry — so purge it here or listenerCount()/eventNames() keep counting
    // a listener that already fired.
    function onceWrapper(ev) {
      registryFor(target, false)?.get(event)?.delete(listener);
      return wrapper(ev);
    }
    register(this, event, listener, onceWrapper, { once: true });
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

  const kMaxListeners = Symbol("kMaxListeners");
  function setMaxListeners(n) {
    this[kMaxListeners] = n;
    return this;
  }
  function getMaxListeners() {
    return this[kMaxListeners] ?? 10;
  }
  function listenerCount(type) {
    return registryFor(this, false)?.get(type)?.size ?? 0;
  }
  function eventNames() {
    const map = registryFor(this, false);
    if (!map) return [];
    const out: string[] = [];
    for (const [k, v] of map) if (v.size > 0) out.push(k);
    return out;
  }
  function removeAllListeners(type) {
    const map = registryFor(this, false);
    if (!map) return this;
    const removeType = t => {
      const byListener = map.get(t);
      if (byListener) {
        for (const w of byListener.values()) this.removeEventListener(t, w);
        map.delete(t);
      }
    };
    if (arguments.length === 0) {
      // removeType only deletes `t`, and a Map iterator tolerates deleting the
      // entry it just yielded — so no snapshot copy is needed here.
      for (const t of map.keys()) removeType(t);
    } else {
      removeType(type);
    }
    return this;
  }

  // node inherits these from NodeEventTarget.prototype (a curated subset of
  // EventEmitter, not EventEmitter itself); use an intermediate prototype so
  // Object.getOwnPropertyNames(MessagePort.prototype) matches node.
  const proto = Class.prototype;
  const inherited = Object.create(Object.getPrototypeOf(proto));
  const emitterMethods: [string, Function][] = [
    ["on", on],
    ["off", off],
    ["once", once],
    ["emit", emit],
    ["addListener", on],
    ["removeListener", off],
    ["listenerCount", listenerCount],
    ["eventNames", eventNames],
    ["removeAllListeners", removeAllListeners],
    ["setMaxListeners", setMaxListeners],
    ["getMaxListeners", getMaxListeners],
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
    // node's mechanism is literally `this.once('close', cb)`, so cb interleaves
    // with other close listeners in registration order. The close event fires at
    // task-queue timing (before setImmediate) rather than node's close-callbacks
    // phase (after) — a known Bun divergence that would need a native fix.
    if (typeof cb === "function") this.once("close", cb);
    return nativeMessagePortClose.$call(this);
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
function makePortReadable(port, incrementsPortRef) {
  let ended = false;
  let startedReading = false;
  function onMessage(payload) {
    if (payload === null) {
      if (ended === false) {
        ended = true;
        stream.push(null);
      }
      port.off("message", onMessage);
    } else if (ended === false) {
      for (let i = 0; i < payload.length; i++) {
        stream.push(Buffer.from(payload[i]));
      }
    }
  }
  const stream = new Readable({
    read() {
      if (startedReading === false && incrementsPortRef) {
        startedReading = true;
        port.ref();
      }
      // Tell the writer we want more data; it completes its in-flight writev
      // on receipt (node's STDIO_WANTS_MORE_DATA).
      if (ended === false) port.postMessage(true);
    },
  });
  // Attach eagerly so the peer's writev is ack'd (via push -> maybeReadMore ->
  // _read) even when no one consumes this stream; unref immediately so an
  // unconsumed captured stream never pins the loop on its own (node's model).
  port.on("message", onMessage);
  port.unref();
  // 'close' covers natural EOF and destroy(); release the read-time ref and
  // drop the listener so a destroyed captured stream can't pin an unref'd worker.
  stream.on("close", () => {
    ended = true;
    port.off("message", onMessage);
    if (startedReading && incrementsPortRef) {
      startedReading = false;
      port.unref();
    }
  });
  // Lets the parent end worker.stdout/stderr when the worker exits abruptly.
  stream.endFromOwner = function () {
    if (ended === false) {
      ended = true;
      stream.push(null);
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
  let pendingWriteCallback: ((error?: Error | null) => void) | null = null;
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
    destroy(err, cb) {
      // Discharge an in-flight batch: the reader may never ack a destroyed
      // stream, so release the loop ref taken in writev and complete the
      // parked callback; drop the ack listener so a late ack can't fire
      // into the destroyed stream.
      const pending = pendingWriteCallback;
      if (pending !== null) {
        pendingWriteCallback = null;
        port.unref();
        pending(err);
      }
      port.off("message", onAck);
      cb(err);
    },
  });
}

function setupWorkerStdio(stdio) {
  const { stdin, stdout, stderr } = stdio;
  if (stdout) {
    Object.defineProperty(process, "stdout", {
      value: makePortWritable(stdout),
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
  if (stderr) {
    Object.defineProperty(process, "stderr", {
      value: makePortWritable(stderr),
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
  // node always replaces a worker's process.stdin: port-backed when { stdin: true },
  // otherwise an immediately-EOF'd stream — never the process-wide fd 0, which
  // would race the main thread (and hang on a TTY).
  Object.defineProperty(process, "stdin", {
    value: stdin
      ? makePortReadable(stdin, true)
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
  if (stdout || stderr) {
    const { Console } = require("node:console");
    globalThis.console = new Console(process.stdout, process.stderr);
  }
}

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
// node: main-thread and unspecified-worker name are both "" (trimmed).
const threadName = isMainThread ? "" : (_threadName ?? "");
// postMessageToThread (Node 22+): the Worker ctor always smuggles a control
// MessagePort to the worker by wrapping workerData; unwrap it here.
const messaging = require("internal/worker/messaging");
messaging.initThreadInfo(threadId, isMainThread);
// Captured stdio + the messaging control port ride inside workerData (wrapped;
// ports transferred). Unwrap and bind the worker's stdio / messaging hub.
// Gate on _isNodeWorker so a raw `new globalThis.Worker` that loads this module
// does NOT have process.stdio rebound / workerData unwrapped by a fabricated key.
if (
  !isMainThread &&
  _isNodeWorker &&
  workerData &&
  typeof workerData === "object" &&
  (BUN_WORKER_STDIO_KEY in workerData || BUN_WORKER_MESSAGING_KEY in workerData)
) {
  const stdioPorts = workerData[BUN_WORKER_STDIO_KEY];
  const controlPort = workerData[BUN_WORKER_MESSAGING_KEY];
  workerData = workerData.data;
  if (stdioPorts) setupWorkerStdio(stdioPorts);
  if (controlPort) messaging.setupMainThreadPort(controlPort, _setEntryEvaluatedHook);
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

// In a node:worker_threads worker, several process operations are unsupported.
// Gate on _isNodeWorker so a raw `new globalThis.Worker` that transitively loads
// this module does NOT have process.abort/chdir/setuid replaced.
if (!isMainThread && _isNodeWorker) {
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

// The markers are DontEnum JSC private names set natively (node uses v8 Privates), so
// they are invisible to and unforgeable from user code, and marking cannot be undone.
// Primitives (including null) are a documented no-op, handled on the native side.
function markAsUntransferable(obj) {
  _markAsUntransferable(obj);
}

function isMarkedAsUntransferable(obj) {
  return _isMarkedAsUntransferable(obj);
}

function markAsUncloneable(obj) {
  _markAsUncloneable(obj);
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

    let portToMain;
    try {
      // Neuter transferred FileHandles only AFTER name/filename validation so a
      // validation throw above leaves them intact (matching node, which validates
      // before processing the transferList). Past this point every throw goes
      // through the catch below, which calls kRestoreJSTransferables — and revokes
      // the eval blob URL when packJSTransferables itself throws (duplicate
      // transferList entry or a busy FileHandle's kTransfer()).
      options = packJSTransferables(options);

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
      const stdoutAutoPipe = !options.stdout;
      const stderrAutoPipe = !options.stderr;
      {
        const channel = new MessageChannel();
        this.#stdoutPort = channel.port1;
        stdioForWorker.stdout = channel.port2;
        stdioTransfer.push(channel.port2);
      }
      {
        const channel = new MessageChannel();
        this.#stderrPort = channel.port1;
        stdioForWorker.stderr = channel.port2;
        stdioTransfer.push(channel.port2);
      }
      // Control channel for postMessageToThread; wrap workerData so the control and
      // stdio ports ride along transferred.
      const channel = messaging.createMessagingChannel();
      portToMain = channel.portToMain;
      const portToWorker = channel.portToWorker;
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
      // node runs its worker bootstrap before user code; preload the
      // worker_threads module so process.stdin/stdout/stderr are always rebound,
      // even when the worker never requires it.
      const userPreload = (options as any).preload;
      options = {
        ...options,
        preload: ["node:worker_threads", ...($isArray(userPreload) ? userPreload : userPreload ? [userPreload] : [])],
      } as NodeWorkerOptions;
      this.#worker = new WebWorker(filename, options as Bun.WorkerOptions, this);
      // Create the readables eagerly so the worker's writev is ack'd even when
      // worker.stdout/stderr is never touched; only captured streams ref their
      // port on first read (node's kIncrementsPortRef).
      this.#stdout = makePortReadable(this.#stdoutPort, !stdoutAutoPipe);
      this.#stderr = makePortReadable(this.#stderrPort, !stderrAutoPipe);
      // 'data' instead of pipe(): pipe() adds an error listener on the shared
      // process.stdout per worker, tripping MaxListenersExceededWarning.
      if (stdoutAutoPipe) this.#stdout.on("data", chunk => process.stdout.write(chunk));
      if (stderrAutoPipe) this.#stderr.on("data", chunk => process.stderr.write(chunk));
    } catch (e) {
      // Restore any transferList handles that were already neutered by
      // packJSTransferables, so their fds aren't orphaned.
      options[kRestoreJSTransferables]?.();
      if (this.#urlToRevoke) {
        URL.revokeObjectURL(this.#urlToRevoke);
      }
      throw e;
    }
    // threadId is only assigned once the WebWorker exists; register the hub-side
    // control port with the messaging hub now.
    this.#messagingThreadId = this.#worker.threadId;
    messaging.registerMainThreadPort(this.#messagingThreadId, portToMain);
    // The transfer is committed - release fds that were transferred but are
    // not referenced from workerData (nothing will deserialize them).
    options[kFinalizeJSTransferables]?.();
    // Tracing active (CLI flag or dynamic enable): record the Node-style
    // `[worker N] <name>` thread-name metadata event. No-op when tracing is
    // off — the agent module is a tiny one-time load.
    require("internal/trace_events").emitWorkerThreadName(options.name, this.#worker.threadId);
    this.#worker.addEventListener("close", this.#onClose.bind(this), { once: true });
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

  get threadName() {
    return this.#exited ? null : this.#name;
  }

  ref() {
    // stdio ports are not touched here (node's ref()/unref() only touch the
    // handle and the public port); their ref state tracks in-flight I/O.
    this.#worker.ref();
  }

  unref() {
    this.#worker.unref();
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
    return this.#stdout ?? null;
  }

  get stderr() {
    return this.#stderr ?? null;
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
      const { maxBufferSize, sampleInterval } = options;
      if (maxBufferSize !== undefined) validateInteger(maxBufferSize, "options.maxBufferSize", 1);
      if (sampleInterval !== undefined) validateNumber(sampleInterval, "options.sampleInterval");
    }
    // JSC has one thread-local sampler; cache stop() on the WORKER so overlapping
    // handles resolve to the same profile instead of empty JSON. Cleared on start
    // so a fresh non-overlapping run gets a fresh profile.
    this.#pendingCpuProfileStop = undefined;
    return this.#worker.startCpuProfileInternal().then(() => {
      return { stop: () => (this.#pendingCpuProfileStop ??= this.#worker.stopCpuProfileInternal()) };
    });
  }
  #pendingCpuProfileStop: Promise<string> | undefined;

  cpuUsage(prevValue?: { user: number; system: number }) {
    let prevUser = 0;
    let prevSystem = 0;
    if (prevValue) {
      validateObject(prevValue, "prevValue");
      ({ user: prevUser, system: prevSystem } = prevValue);
      validateNumber(prevUser, "prevValue.user");
      if (prevUser < 0 || !Number.isFinite(prevUser))
        throw $ERR_OUT_OF_RANGE("prevValue.user", ">= 0 and a finite number", prevUser);
      validateNumber(prevSystem, "prevValue.system");
      if (prevSystem < 0 || !Number.isFinite(prevSystem))
        throw $ERR_OUT_OF_RANGE("prevValue.system", ">= 0 and a finite number", prevSystem);
    }
    return this.#worker
      .cpuUsageInternal()
      .then((abs: { user: number; system: number }) =>
        prevValue ? { user: abs.user - prevUser, system: abs.system - prevSystem } : abs,
      );
  }

  startHeapProfile(options?: object) {
    if (options !== undefined && options !== null) {
      validateObject(options, "options");
      const {
        sampleInterval,
        stackDepth,
        forceGC,
        includeObjectsCollectedByMajorGC,
        includeObjectsCollectedByMinorGC,
      } = options as any;
      if (sampleInterval !== undefined) validateInteger(sampleInterval, "options.sampleInterval", 1);
      if (stackDepth !== undefined) validateInteger(stackDepth, "options.stackDepth", 0);
      if (forceGC !== undefined) validateBoolean(forceGC, "options.forceGC");
      if (includeObjectsCollectedByMajorGC !== undefined)
        validateBoolean(includeObjectsCollectedByMajorGC, "options.includeObjectsCollectedByMajorGC");
      if (includeObjectsCollectedByMinorGC !== undefined)
        validateBoolean(includeObjectsCollectedByMinorGC, "options.includeObjectsCollectedByMinorGC");
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
    const message = event.message;
    if (message !== "") {
      error = new Error(message, { cause: event });
      const stack = event?.stack;
      if (stack) {
        error.stack = stack;
      }
    }
    // Reshape the native 'ModuleNotFound ... (entry point)' error into node's
    // "Cannot find module '<path>'" (MODULE_NOT_FOUND).
    const errorMessage = error?.message;
    if (typeof errorMessage === "string" && errorMessage.includes("(entry point)")) {
      const m = /ModuleNotFound resolving "(.+?)"/.exec(errorMessage);
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
};
