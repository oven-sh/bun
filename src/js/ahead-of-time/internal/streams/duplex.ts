// What the compiler reads in place of src/js/internal/streams/duplex.ts, which `bun run` evaluates. The two do the same.
// Written against that file with the SHA-256 bf2af957ecec8c5faf81b5759b263202d0813415f3f6147425ce820aa69e85a9.
// When that file changes, bring the change here and write the new hash: test/internal/second-texts-of-modules.test.ts.

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

// Object lists a member from when it is first read. The third is called only where a test may have replaced it, as `bun run` calls it.
const {
  keys: ObjectKeys,
  defineProperties: ObjectDefineProperties,
  getOwnPropertyDescriptor: ObjectGetOwnPropertyDescriptor,
} = Object;

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

  const StateOfReadables = Readable.ReadableState;
  this._readableState =
    StateOfReadables === ReadableState
      ? new ReadableState(options, this, true)
      : new StateOfReadables(options, this, true);
  const StateOfWritables = Writable.WritableState;
  this._writableState =
    StateOfWritables === WritableState
      ? new WritableState(options, this, true)
      : new StateOfWritables(options, this, true);

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
  writable: CAN_REPLACE_BUILT_IN_FUNCTIONS
    ? { __proto__: null, ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writable") }
    : writableAccessors.writable,
  writableHighWaterMark: CAN_REPLACE_BUILT_IN_FUNCTIONS
    ? { __proto__: null, ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableHighWaterMark") }
    : writableAccessors.writableHighWaterMark,
  writableObjectMode: CAN_REPLACE_BUILT_IN_FUNCTIONS
    ? { __proto__: null, ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableObjectMode") }
    : writableAccessors.writableObjectMode,
  writableBuffer: CAN_REPLACE_BUILT_IN_FUNCTIONS
    ? { __proto__: null, ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableBuffer") }
    : writableAccessors.writableBuffer,
  writableLength: CAN_REPLACE_BUILT_IN_FUNCTIONS
    ? { __proto__: null, ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableLength") }
    : writableAccessors.writableLength,
  writableFinished: CAN_REPLACE_BUILT_IN_FUNCTIONS
    ? { __proto__: null, ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableFinished") }
    : writableAccessors.writableFinished,
  writableCorked: CAN_REPLACE_BUILT_IN_FUNCTIONS
    ? { __proto__: null, ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableCorked") }
    : writableAccessors.writableCorked,
  writableEnded: CAN_REPLACE_BUILT_IN_FUNCTIONS
    ? { __proto__: null, ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableEnded") }
    : writableAccessors.writableEnded,
  writableNeedDrain: CAN_REPLACE_BUILT_IN_FUNCTIONS
    ? { __proto__: null, ...ObjectGetOwnPropertyDescriptor(Writable.prototype, "writableNeedDrain") }
    : writableAccessors.writableNeedDrain,

  destroyed: {
    __proto__: null,
    get(this: $Node.Duplex) {
      if (this._readableState === undefined || this._writableState === undefined) {
        return false;
      }
      const readableState = this._readableState as ReadableState | $Node.ForeignState;
      const isReadableSideDestroyed = isReadableState(readableState)
        ? (readableState[kState] & Flag.Destroyed) !== 0
        : readableState.destroyed;
      if (!isReadableSideDestroyed) return isReadableSideDestroyed;
      const writableState = this._writableState as WritableState | $Node.ForeignState;
      return isWritableState(writableState) ? (writableState[kState] & Flag.Destroyed) !== 0 : writableState.destroyed;
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
