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
const streamState = require("internal/streams/state");
const { ReadableState, WritableState, isReadableState, isWritableState, internals } = streamState;
const kState: typeof streamState.kState = streamState.kState;
const kOnConstructed: typeof streamState.kOnConstructed = streamState.kOnConstructed;
type ReadableState = $Node.ReadableState;
type WritableState = $Node.WritableState;

const enum Flag {
  Destroyed = 1 << 4,
}

const ObjectKeys = Object.keys;
const ObjectDefineProperties = Object.defineProperties;

declare global {
  namespace $Node {
    interface DuplexOptions extends ReadableOptions, WritableOptions {
      allowHalfOpen?: boolean;
      readable?: boolean;
      writable?: boolean;
      readableObjectMode?: boolean;
      writableObjectMode?: boolean;
      readableHighWaterMark?: number;
      writableHighWaterMark?: number;
    }

    /** Inherits from `Readable`; the members of `Writable.prototype` are copied into its prototype. */
    interface Duplex extends Readable, Writable {
      _readableState: ReadableState;
      _writableState: WritableState;
      allowHalfOpen: boolean;
      get readable(): boolean;
      set readable(value: boolean);
      get writable(): boolean;
      set writable(value: boolean);
    }

    interface DuplexConstructor {
      new (options?: DuplexOptions): Duplex;
      (this: Duplex, options?: DuplexOptions): void;
      prototype: any;
      from: typeof Duplex.from;
      fromWeb: typeof Duplex.fromWeb;
      toWeb: typeof Duplex.toWeb;
    }
  }
}

function preallocatedEvents(): $Node.Events {
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

function Duplex(this: $Node.Duplex, options?: $Node.DuplexOptions): void {
  if (!(this instanceof Duplex)) return new Duplex(options) as any;

  this._events ??= preallocatedEvents();

  const readableState = (this._readableState = new ReadableState(options, this, true));
  const writableState = (this._writableState = new WritableState(options, this, true));

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

const writableAccessors = internals.writableAccessors!;
ObjectDefineProperties(Duplex.prototype, {
  writable: writableAccessors.writable,
  writableHighWaterMark: writableAccessors.writableHighWaterMark,
  writableObjectMode: writableAccessors.writableObjectMode,
  writableBuffer: writableAccessors.writableBuffer,
  writableLength: writableAccessors.writableLength,
  writableFinished: writableAccessors.writableFinished,
  writableCorked: writableAccessors.writableCorked,
  writableEnded: writableAccessors.writableEnded,
  writableNeedDrain: writableAccessors.writableNeedDrain,

  destroyed: {
    __proto__: null,
    get(this: $Node.Duplex) {
      const readableState = this._readableState as ReadableState | $Node.ForeignState | undefined;
      const writableState = this._writableState as WritableState | $Node.ForeignState | undefined;
      if (readableState === undefined || writableState === undefined) {
        return false;
      }
      if (isReadableState(readableState) && isWritableState(writableState)) {
        return (readableState[kState] & writableState[kState] & Flag.Destroyed) !== 0;
      }
      return readableState.destroyed && writableState.destroyed;
    },
    set(this: $Node.Duplex, value) {
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
Duplex.fromWeb = function (pair, options?) {
  return require("internal/webstreams_adapters").newStreamDuplexFromReadableWritablePair(pair, options);
};

Duplex.toWeb = function (duplex, options?) {
  return require("internal/webstreams_adapters").newReadableWritablePairFromDuplex(duplex, options);
};

let duplexify: typeof import("internal/streams/duplexify").default | undefined;
Duplex.from = function (body) {
  duplexify ??= require("internal/streams/duplexify");
  return duplexify(body, "body");
};

export default Duplex as $Node.DuplexConstructor;
