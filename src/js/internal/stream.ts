"use strict";

const ObjectKeys = Object.keys;
const ObjectDefineProperty = Object.defineProperty;

const customPromisify = Symbol.for("nodejs.util.promisify.custom");
const { streamReturningOperators, promiseReturningOperators } = require("internal/streams/operators");
const compose = require("internal/streams/compose");
const { setDefaultHighWaterMark, getDefaultHighWaterMark } = require("internal/streams/state");
const { pipeline } = require("internal/streams/pipeline");
const { destroyer } = require("internal/streams/destroy");
const eos = require("internal/streams/end-of-stream");
const promises = require("internal/stream.promises");
const utils = require("internal/streams/utils");
const { isArrayBufferView, isUint8Array } = require("node:util/types");
const Stream = require("internal/streams/legacy").Stream;

// Add missing static methods/properties to Stream
(Stream as any).isDestroyed = utils.isDestroyed;
(Stream as any).isDisturbed = utils.isDisturbed;
(Stream as any).isErrored = utils.isErrored;
(Stream as any).isReadable = utils.isReadable;
(Stream as any).isWritable = utils.isWritable;

Stream.Readable = require("internal/streams/readable");
const streamKeys = ObjectKeys(streamReturningOperators);
for (let i = 0; i < streamKeys.length; i++) {
  const key = streamKeys[i];
  const op = streamReturningOperators[key];
  function fn(...args) {
    if (new.target) {
      throw $ERR_ILLEGAL_CONSTRUCTOR();
    }
    return Stream.Readable.from(op.$apply(this, args));
  }
  ObjectDefineProperty(fn, "name", { __proto__: null, value: op.name });
  ObjectDefineProperty(fn, "length", { __proto__: null, value: op.length });
  ObjectDefineProperty(Stream.Readable.prototype, key, {
    __proto__: null,
    value: fn,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}
const promiseKeys = ObjectKeys(promiseReturningOperators);
for (let i = 0; i < promiseKeys.length; i++) {
  const key = promiseKeys[i];
  const op = promiseReturningOperators[key];
  function fn(...args) {
    if (new.target) {
      throw $ERR_ILLEGAL_CONSTRUCTOR();
    }
    return Promise.resolve().then(() => op.$apply(this, args));
  }
  ObjectDefineProperty(fn, "name", { __proto__: null, value: op.name });
  ObjectDefineProperty(fn, "length", { __proto__: null, value: op.length });
  ObjectDefineProperty(Stream.Readable.prototype, key, {
    __proto__: null,
    value: fn,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}
Stream.Writable = require("internal/streams/writable");
Stream.Duplex = require("internal/streams/duplex");
Stream.Transform = require("internal/streams/transform");
Stream.PassThrough = require("internal/streams/passthrough").default;
Stream.duplexPair = require("internal/streams/duplexpair").default;
Stream.pipeline = pipeline;
const { addAbortSignal } = require("internal/streams/add-abort-signal");
Stream.addAbortSignal = addAbortSignal;
Stream.finished = eos.finished;
(Stream as any).destroy = destroyer;
(Stream as any).compose = compose;
Stream.setDefaultHighWaterMark = setDefaultHighWaterMark;
Stream.getDefaultHighWaterMark = getDefaultHighWaterMark;

ObjectDefineProperty(Stream, "promises", {
  __proto__: null,
  configurable: true,
  enumerable: true,
  get() {
    return promises;
  },
});

ObjectDefineProperty(pipeline, customPromisify, {
  __proto__: null,
  enumerable: true,
  get() {
    return promises.pipeline;
  },
});

ObjectDefineProperty(eos.finished, customPromisify, {
  __proto__: null,
  enumerable: true,
  get() {
    return promises.finished;
  },
});

// Add __promisify__ for util.promisify compatibility
ObjectDefineProperty(pipeline, "__promisify__", {
  __proto__: null,
  enumerable: false,
  configurable: true,
  writable: true,
  value: promises.pipeline,
});
ObjectDefineProperty(eos.finished, "__promisify__", {
  __proto__: null,
  enumerable: false,
  configurable: true,
  writable: true,
  value: promises.finished,
});

// Backwards-compat with node 0.4.x
Stream.Stream = Stream;

(Stream as any)._isArrayBufferView = isArrayBufferView;
(Stream as any)._isUint8Array = isUint8Array;
(Stream as any)._uint8ArrayToBuffer = function _uint8ArrayToBuffer(chunk: Uint8Array) {
  // chunk.buffer is ArrayBufferLike, but $Buffer expects ArrayBuffer.
  // If chunk.buffer is not an ArrayBuffer, we need to copy it into a new ArrayBuffer.
  // SharedArrayBuffer is not supported by Buffer, so we must copy.
  let ab = chunk.buffer;
  if (!(ab instanceof ArrayBuffer)) {
    // Copy to a new ArrayBuffer
    ab = new Uint8Array(chunk).buffer;
    return new $Buffer(ab as ArrayBuffer, 0, chunk.byteLength);
  }
  return new $Buffer(ab as ArrayBuffer, chunk.byteOffset, chunk.byteLength);
};

export default Stream;