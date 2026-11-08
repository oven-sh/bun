"use strict";

const EE = require("node:events");
const { isArrayBufferView, isUint8Array } = require("node:util/types");
const { internals } = require("internal/streams/state");

// Reflect lists a member from when it is first read. internal/primordials, which is loaded behind this one, reads the second ahead of the last two.
const {
  ownKeys: ReflectOwnKeys,
  getPrototypeOf: _ReflectGetPrototypeOf,
  getOwnPropertyDescriptor: ReflectGetOwnPropertyDescriptor,
  defineProperty: ReflectDefineProperty,
} = Reflect;
const ArrayIsArray = Array.isArray;
const ObjectDefineProperty = Object.defineProperty;

declare global {
  namespace $Node {
    interface PipeOptions {
      end?: boolean;
    }

    interface Stream extends EventEmitter {
      /** The destination is whatever has `write()`, `end()` and emits: a `Writable`, a response of node:http, an old-style stream. */
      pipe<T extends AnyStream>(destination: T, options?: PipeOptions): T;
    }

    /** A stream of the kind that came before `Readable`: whatever emits "data" and may know how to pause. */
    interface LegacyReadable extends Stream {
      readable?: boolean;
      pause?(): unknown;
      resume?(): unknown;
    }

    /** `require("node:stream")`. internal/stream.ts stores the members that other modules define. */
    interface StreamConstructor {
      new (options?: EventEmitterOptions): Stream;
      (this: Stream, options?: EventEmitterOptions): void;
      prototype: any;
      Stream: StreamConstructor;
      Readable: ReadableConstructor;
      Writable: WritableConstructor;
      Duplex: DuplexConstructor;
      Transform: TransformConstructor;
      PassThrough: PassThroughConstructor;
      duplexPair: typeof import("internal/streams/duplexpair").default;
      pipeline: typeof import("internal/streams/pipeline").default.pipeline;
      finished: typeof import("internal/streams/end-of-stream").default;
      /** The old name of `finished`. */
      eos: typeof import("internal/streams/end-of-stream").default;
      compose: typeof import("internal/streams/compose").default;
      addAbortSignal: typeof import("internal/streams/add-abort-signal").default.addAbortSignal;
      destroy: typeof import("internal/streams/destroy").default.destroyer;
      setDefaultHighWaterMark: typeof import("internal/streams/state").default.setDefaultHighWaterMark;
      getDefaultHighWaterMark: typeof import("internal/streams/state").default.getDefaultHighWaterMark;
      isDestroyed: typeof import("internal/streams/utils").default.isDestroyed;
      isDisturbed: typeof import("internal/streams/utils").default.isDisturbed;
      isErrored: typeof import("internal/streams/utils").default.isErrored;
      isReadable: typeof import("internal/streams/utils").default.isReadable;
      isWritable: typeof import("internal/streams/utils").default.isWritable;
      readonly promises: typeof import("internal/stream.promises").default;
      _isArrayBufferView: typeof Stream._isArrayBufferView;
      _isUint8Array: typeof Stream._isUint8Array;
      _uint8ArrayToBuffer: typeof Stream._uint8ArrayToBuffer;
    }
  }
}

function Stream(this: $Node.Stream, opts?: $Node.EventEmitterOptions) {
  EE.$call(this, opts);
}
$toClass(Stream, "Stream", EE);

Stream.prototype.pipe = function (this: $Node.LegacyReadable, dest: $Node.AnyStream, options?: $Node.PipeOptions) {
  const source = this;

  function ondata(chunk: unknown) {
    if (dest.writable && dest.write!(chunk) === false && source.pause) {
      source.pause();
    }
  }

  source.on("data", ondata);

  function ondrain() {
    if (source.readable && source.resume) {
      source.resume();
    }
  }

  dest.on("drain", ondrain);

  // If the 'end' option is not supplied, dest.end() will be called when
  // source gets the 'end' or 'close' events.  Only dest.end() once.
  if (!dest._isStdio && (!options || options.end !== false)) {
    source.on("end", onend);
    source.on("close", onclose);
  }

  let didOnEnd = false;
  function onend() {
    if (didOnEnd) return;
    didOnEnd = true;

    dest.end!();
  }

  function onclose() {
    if (didOnEnd) return;
    didOnEnd = true;

    if (typeof dest.destroy === "function") dest.destroy();
  }

  // Don't leave dangling pipes when there are errors.
  function onerror(this: $Node.EventEmitter, er: unknown) {
    cleanup();
    if (this.listenerCount?.("error") === 0) {
      this.emit("error", er);
    }
  }

  prependListener(source, "error", onerror);
  prependListener(dest, "error", onerror);

  // Remove all the event listeners that were added.
  function cleanup() {
    source.removeListener("data", ondata);
    dest.removeListener("drain", ondrain);

    source.removeListener("end", onend);
    source.removeListener("close", onclose);

    source.removeListener("error", onerror);
    dest.removeListener("error", onerror);

    source.removeListener("end", cleanup);
    source.removeListener("close", cleanup);

    dest.removeListener("close", cleanup);
  }

  source.on("end", cleanup);
  source.on("close", cleanup);

  dest.on("close", cleanup);
  dest.emit("pipe", source);

  // Allow for unix-like usage: A.pipe(B).pipe(C)
  return dest;
};

Stream.prototype.eventNames = function eventNames(this: $Node.Stream) {
  const names: $Node.EventName[] = [];
  for (const key of ReflectOwnKeys(this._events!)) {
    if (
      typeof this._events![key] === "function" ||
      (ArrayIsArray(this._events![key]) && this._events![key].length > 0)
    ) {
      names.push(key);
    }
  }
  return names;
};

function prependListener(emitter: $Node.EventEmitter, event: $Node.EventName, fn: $Node.Listener) {
  // Sadly this is not cacheable as some libraries bundle their own
  // event emitter implementation with them.
  if (typeof emitter.prependListener === "function") return emitter.prependListener(event, fn);

  // This is a hack to make sure that our error handler is attached before any
  // userland ones.  NEVER DO THIS. This is here only because this code needs
  // to continue to work with older versions of Node.js that do not include
  // the prependListener() method. The goal is to eventually remove this hack.
  let events: $Node.Events | undefined, existing: $Node.Listener | $Node.Listener[] | undefined;
  if (!(events = emitter._events) || !(existing = events[event])) emitter.on(event, fn);
  // A fresh array, not unshift(): node:events iterates stored arrays without
  // cloning, so a stored `_events` array must never be mutated in place.
  else if (ArrayIsArray(existing)) events[event] = [fn, ...existing];
  else events[event] = [fn, existing];
}

// Add helper methods to Stream
Stream._isArrayBufferView = isArrayBufferView;
Stream._isUint8Array = isUint8Array;
Stream._uint8ArrayToBuffer = function _uint8ArrayToBuffer(chunk) {
  return new $Buffer(chunk.buffer, chunk.byteOffset, chunk.byteLength);
};

type LazyMember = Exclude<keyof $Node.StreamConstructor, "prototype" | "Stream" | "promises" | `_${string}`>;

// What internal/stream.ts stores to `Stream` under that name.
function loadMember(name: LazyMember): Function {
  switch (name) {
    case "isDestroyed":
      return require("internal/streams/utils").isDestroyed;
    case "isDisturbed":
      return require("internal/streams/utils").isDisturbed;
    case "isErrored":
      return require("internal/streams/utils").isErrored;
    case "isReadable":
      return require("internal/streams/utils").isReadable;
    case "isWritable":
      return require("internal/streams/utils").isWritable;
    case "Readable":
      return require("internal/streams/readable");
    case "Writable":
      return require("internal/streams/writable");
    case "Duplex":
      return require("internal/streams/duplex");
    case "Transform":
      return require("internal/streams/transform");
    case "PassThrough":
      return require("internal/streams/passthrough");
    case "duplexPair":
      return require("internal/streams/duplexpair");
    case "pipeline":
      return require("internal/streams/pipeline").pipeline;
    case "addAbortSignal":
      return require("internal/streams/add-abort-signal").addAbortSignal;
    case "finished":
    case "eos":
      return require("internal/streams/end-of-stream");
    case "destroy":
      return require("internal/streams/destroy").destroyer;
    case "compose":
      return require("internal/streams/compose");
    case "setDefaultHighWaterMark":
      return require("internal/streams/state").setDefaultHighWaterMark;
    case "getDefaultHighWaterMark":
      return require("internal/streams/state").getDefaultHighWaterMark;
  }
}

function lazyMember(name: LazyMember) {
  // As a store to a data property: the value goes on the receiver, a class below `Stream` for `Socket.pipeline = value`.
  function set(this: unknown, value: unknown) {
    if (!$isObject(this)) return;
    const own = ReflectGetOwnPropertyDescriptor(this, name);
    if (own === undefined)
      ReflectDefineProperty(this, name, {
        __proto__: null,
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    else if (own.writable || own.set === set)
      ReflectDefineProperty(this, name, { __proto__: null, value, writable: true });
  }
  ObjectDefineProperty(Stream, name, {
    __proto__: null,
    enumerable: true,
    configurable: true,
    get() {
      // internal/stream stores the members itself once it has begun to load, and a load that throws does so at require("node:stream").
      if (!internals.streamDefinesItsMembers) {
        try {
          require("internal/stream");
        } catch {}
      }
      return loadMember(name);
    },
    set,
  });
}

// Modules such as node:net and node:crypto make `Stream` without internal/stream, where a program can freeze it: so it has every member from the start, as an accessor that loads internal/stream.
function defineLazyMembers() {
  const names = [
    "isDestroyed",
    "isDisturbed",
    "isErrored",
    "isReadable",
    "isWritable",
    "Readable",
    "Writable",
    "Duplex",
    "Transform",
    "PassThrough",
    "duplexPair",
    "pipeline",
    "addAbortSignal",
    "finished",
    "destroy",
    "compose",
    "setDefaultHighWaterMark",
    "getDefaultHighWaterMark",
  ] as const satisfies readonly LazyMember[];
  for (let i = 0; i < names.length; i++) lazyMember(names[i]);
  definePromisesAndStream();
  lazyMember("eos");
}

// Behind the members that other modules define and ahead of `eos`, from whichever module puts the members on `Stream`.
function definePromisesAndStream() {
  ObjectDefineProperty(Stream, "promises", {
    __proto__: null,
    configurable: true,
    enumerable: true,
    get() {
      return require("internal/stream.promises");
    },
  });
  // Backwards-compat with node 0.4.x
  (Stream as $Node.StreamConstructor).Stream = Stream as $Node.StreamConstructor;
}

const hasLazyMembers = !internals.streamDefinesItsMembers;
if (hasLazyMembers) defineLazyMembers();

export default {
  Stream: Stream as $Node.StreamConstructor,
  prependListener,
  hasLazyMembers,
  definePromisesAndStream,
};
