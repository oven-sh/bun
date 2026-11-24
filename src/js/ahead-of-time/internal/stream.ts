// What the compiler reads in place of src/js/internal/stream.ts, which `bun run` evaluates. The two do the same.
// Written against that file with the SHA-256 5b3c7ace5d3d9cbb6f1fa8287ed9fd58b271b7bf73166f5d8bbc8c1ef5779b01.
// When that file changes, bring the change here and write the new hash: test/internal/second-texts-of-modules.test.ts.

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
const utils = require("internal/streams/utils");
const { isArrayBufferView, isUint8Array } = require("node:util/types");
const Stream = require("internal/streams/legacy").Stream;

Stream.isDestroyed = utils.isDestroyed;
Stream.isDisturbed = utils.isDisturbed;
Stream.isErrored = utils.isErrored;
Stream.isReadable = utils.isReadable;
Stream.isWritable = utils.isWritable;

Stream.Readable = require("internal/streams/readable");
const streamKeys = ObjectKeys(streamReturningOperators);
for (let i = 0; i < streamKeys.length; i++) {
  const key = streamKeys[i];
  const op: (this: $Node.Readable, ...args: any[]) => AsyncIterable<unknown> = streamReturningOperators[key];
  // The name that both functions `fn` of this file have in what `bun run` evaluates, until the line below gives each its own.
  const fn2 = function (this: $Node.Readable, ...args: unknown[]) {
    if (new.target) {
      throw $ERR_ILLEGAL_CONSTRUCTOR();
    }
    return Stream.Readable.from(op.$apply(this, args));
  };
  ObjectDefineProperty(fn2, "name", { __proto__: null, value: op.name });
  ObjectDefineProperty(fn2, "length", { __proto__: null, value: op.length });
  ObjectDefineProperty(Stream.Readable.prototype, key, {
    __proto__: null,
    value: fn2,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}
const promiseKeys = ObjectKeys(promiseReturningOperators);
for (let i = 0; i < promiseKeys.length; i++) {
  const key = promiseKeys[i];
  const op: (this: $Node.Readable, ...args: any[]) => Promise<unknown> = promiseReturningOperators[key];
  const fn2 = function (this: $Node.Readable, ...args: unknown[]) {
    if (new.target) {
      throw $ERR_ILLEGAL_CONSTRUCTOR();
    }
    return Promise.$resolve().then(() => op.$apply(this, args));
  };
  ObjectDefineProperty(fn2, "name", { __proto__: null, value: op.name });
  ObjectDefineProperty(fn2, "length", { __proto__: null, value: op.length });
  ObjectDefineProperty(Stream.Readable.prototype, key, {
    __proto__: null,
    value: fn2,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}
Stream.Writable = require("internal/streams/writable");
Stream.Duplex = require("internal/streams/duplex");
Stream.Transform = require("internal/streams/transform");
Stream.PassThrough = require("internal/streams/passthrough");
Stream.duplexPair = require("internal/streams/duplexpair");
Stream.pipeline = pipeline;
const { addAbortSignal } = require("internal/streams/add-abort-signal");
Stream.addAbortSignal = addAbortSignal;
Stream.finished = eos;
Stream.destroy = destroyer;
Stream.compose = compose;
Stream.setDefaultHighWaterMark = setDefaultHighWaterMark;
Stream.getDefaultHighWaterMark = getDefaultHighWaterMark;

ObjectDefineProperty(Stream, "promises", {
  __proto__: null,
  configurable: true,
  enumerable: true,
  get() {
    return require("internal/stream.promises");
  },
});

ObjectDefineProperty(pipeline, customPromisify, {
  __proto__: null,
  enumerable: true,
  get() {
    return require("internal/stream.promises").pipeline;
  },
});

ObjectDefineProperty(eos, customPromisify, {
  __proto__: null,
  enumerable: true,
  get() {
    return require("internal/stream.promises").finished;
  },
});

// Backwards-compat with node 0.4.x
Stream.Stream = Stream;

Stream._isArrayBufferView = isArrayBufferView;
Stream._isUint8Array = isUint8Array;
Stream._uint8ArrayToBuffer = function _uint8ArrayToBuffer(chunk) {
  return new $Buffer(chunk.buffer, chunk.byteOffset, chunk.byteLength);
};

export default Stream;
