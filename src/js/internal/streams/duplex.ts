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
const { kOnConstructed } = require("internal/streams/utils");

const ObjectKeys = Object.keys;
const ObjectDefineProperties = Object.defineProperties;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

function Duplex(options): void {
  if (!(this instanceof Duplex)) return new Duplex(options);

  this._events ??= {
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

  this._readableState = new Readable.ReadableState(options, this, true);
  this._writableState = new Writable.WritableState(options, this, true);

  if (options) {
    this.allowHalfOpen = options.allowHalfOpen !== false;

    if (options.readable === false) {
      this._readableState.readable = false;
      this._readableState.ended = true;
      this._readableState.endEmitted = true;
    }

    if (options.writable === false) {
      this._writableState.writable = false;
      this._writableState.ending = true;
      this._writableState.ended = true;
      this._writableState.finished = true;
    }

    if (typeof options.read === "function") this._read = options.read;

    if (typeof options.write === "function") this._write = options.write;

    if (typeof options.writev === "function") this._writev = options.writev;

    if (typeof options.destroy === "function") this._destroy = options.destroy;

    if (typeof options.final === "function") this._final = options.final;

    if (typeof options.construct === "function") this._construct = options.construct;

    if (options.signal) addAbortSignal(options.signal, this);
  } else {
    this.allowHalfOpen = true;
  }

  Stream.$call(this, options);

  if (this._construct != null) {
    destroyImpl.construct(this, () => {
      this._readableState[kOnConstructed](this);
      this._writableState[kOnConstructed](this);
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
      if (this._readableState === undefined || this._writableState === undefined) {
        return false;
      }
      return this._readableState.destroyed && this._writableState.destroyed;
    },
    set(value) {
      // Backward compatibility, the user is explicitly
      // managing destroyed.
      if (this._readableState && this._writableState) {
        this._readableState.destroyed = value;
        this._writableState.destroyed = value;
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

Duplex.toWeb = function (duplex) {
  return lazyWebStreams().newReadableWritablePairFromDuplex(duplex);
};

let duplexify;
Duplex.from = function (body) {
  duplexify ??= require("internal/streams/duplexify");
  return duplexify(body, "body");
};

export default Duplex as unknown as typeof import("node:stream").Duplex;
