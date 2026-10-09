// a duplex stream is just a stream that is both readable and writable.
// Since JS doesn't have multiple prototype inheritance, this class
// prototypically inherits from Readable, and then parasitically from
// Writable.

"use strict";

const Stream = require("internal/streams/legacy").Stream;
const Readable = require("internal/streams/readable");
const Writable = require("internal/streams/writable");
const { addAbortSignal } = require("internal/streams/add-abort-signal");
const destroyImpl = require("internal/streams/destroy");
const { createReadableState, createWritableState, internals } =
  require("internal/streams/state") as typeof import("internal/streams/state").default;
type ReadableState = import("internal/streams/state").ReadableState;
type WritableState = import("internal/streams/state").WritableState;

const ObjectKeys = Object.keys;
const ObjectDefineProperties = Object.defineProperties;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

function preallocatedEvents(): Record<string | symbol, unknown> {
  return {
      close: undefined,
      error: undefined,
      prefinish: undefined,
      finish: undefined,
      drain: undefined,
      data: undefined,
      end: undefined,
      readable: undefined,
      // Skip uncommon events...
      // pause: undefined,
      // resume: undefined,
      // pipe: undefined,
      // unpipe: undefined,
      // [destroyImpl.kConstruct]: undefined,
      // [destroyImpl.kDestroy]: undefined,
  };
}

function Duplex(options): void {
  if (!(this instanceof Duplex)) return new Duplex(options);

  this._events ??= preallocatedEvents();

  const readableState = (this._readableState = createReadableState(options, this, true));
  const writableState = (this._writableState = createWritableState(options, this, true));

  if (options) {
    this.allowHalfOpen = options.allowHalfOpen !== false;

    if (options.readable === false) {
      readableState.readable = false;
      readableState.ended = true;
      readableState.endEmitted = true;
    }

    if (options.writable === false) {
      writableState.writable = false;
      writableState.ending = true;
      writableState.ended = true;
      writableState.finished = true;
    }

    const { read, write, writev, destroy, final, construct, signal } = options;
    if (typeof read === "function") this._read = read;

    if (typeof write === "function") this._write = write;

    if (typeof writev === "function") this._writev = writev;

    if (typeof destroy === "function") this._destroy = destroy;

    if (typeof final === "function") this._final = final;

    if (typeof construct === "function") this._construct = construct;

    if (signal) addAbortSignal(signal, this);
  } else {
    this.allowHalfOpen = true;
  }

  Stream.$call(this, options);

  if (this._construct != null) {
    destroyImpl.construct(this, () => {
      internals.onReadableConstructed!(this, this._readableState);
      internals.onWritableConstructed!(this, this._writableState);
    });
  }
}
$toClass(Duplex, "Duplex", Readable);

// Use the `destroy` method of `Writable`.
Duplex.prototype.destroy = Writable.prototype.destroy;

{
  const keys = ObjectKeys(Writable.prototype);
  // Allow the keys array to be GC'ed.
  for (let i = 0; i < keys.length; i++) {
    const method = keys[i];
    Duplex.prototype[method] ||= Writable.prototype[method];
  }
}

ObjectDefineProperties(Duplex.prototype, {
  writable: { __proto__: null, ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writable") },
  writableHighWaterMark: {
    __proto__: null,
    ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableHighWaterMark"),
  },
  writableObjectMode: { __proto__: null, ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableObjectMode") },
  writableBuffer: { __proto__: null, ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableBuffer") },
  writableLength: { __proto__: null, ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableLength") },
  writableFinished: { __proto__: null, ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableFinished") },
  writableCorked: { __proto__: null, ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableCorked") },
  writableEnded: { __proto__: null, ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableEnded") },
  writableNeedDrain: { __proto__: null, ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableNeedDrain") },

  destroyed: {
    __proto__: null,
    get() {
      const readableState: ReadableState | undefined = this._readableState;
      const writableState: WritableState | undefined = this._writableState;
      if (readableState === undefined || writableState === undefined) {
        return false;
      }
      return readableState.destroyed && writableState.destroyed;
    },
    set(value) {
      // Backward compatibility, the user is explicitly
      // managing destroyed.
      const readableState: ReadableState | undefined = this._readableState;
      let writableState: WritableState | undefined;
      if (readableState && (writableState = this._writableState)) {
        readableState.destroyed = value;
        writableState.destroyed = value;
      }
    },
  },
});

// Lazy to avoid circular references
let webStreamsAdapters;
function lazyWebStreams() {
  if (webStreamsAdapters === undefined) webStreamsAdapters = require("internal/webstreams_adapters");
  return webStreamsAdapters;
}

Duplex.fromWeb = function (pair, options) {
  return lazyWebStreams().newStreamDuplexFromReadableWritablePair(pair, options);
};

Duplex.toWeb = function (duplex, options) {
  return lazyWebStreams().newReadableWritablePairFromDuplex(duplex, options);
};

let duplexify;
Duplex.from = function (body) {
  duplexify ??= require("internal/streams/duplexify");
  return duplexify(body, "body");
};

type NodeDuplex = import("node:stream").Duplex;
type NodeDuplexOptions = import("node:stream").DuplexOptions;

interface DuplexOptions extends NodeDuplexOptions {
  readable?: boolean;
  writable?: boolean;
}

export default Duplex as unknown as typeof import("node:stream").Duplex & {
  new (options?: DuplexOptions): NodeDuplex;
};
