"use strict";

const EE = require("node:events");
const { isArrayBufferView, isUint8Array } = require("node:util/types");

const ReflectOwnKeys = Reflect.ownKeys;
const ArrayIsArray = Array.isArray;

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

    /** `require("node:stream")`. internal/stream.ts adds the members that other modules define. */
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
      /** The old name of `finished`, which node/stream.ts adds. */
      eos?: typeof import("internal/streams/end-of-stream").default;
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

export default { Stream: Stream as $Node.StreamConstructor, prependListener };
