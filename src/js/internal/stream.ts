"use strict";

const ObjectKeys = Object.keys;
const ObjectDefineProperty = Object.defineProperty;

const { setDefaultHighWaterMark, getDefaultHighWaterMark, internals } = require("internal/streams/state");
// Set before internal/streams/legacy can load: a `Stream` that is made from here on gets its members from the stores below, not as accessors.
internals.streamDefinesItsMembers = true;
const customPromisify = Symbol.for("nodejs.util.promisify.custom");
const { streamReturningOperators, promiseReturningOperators } = require("internal/streams/operators");
const compose = require("internal/streams/compose");
const { pipeline } = require("internal/streams/pipeline");
const { destroyer } = require("internal/streams/destroy");
const eos = require("internal/streams/end-of-stream");
const utils = require("internal/streams/utils");
const { Stream, hasLazyMembers, definePromisesAndStream } = require("internal/streams/legacy");

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
  const fn = function (this: $Node.Readable, ...args: unknown[]) {
    if (new.target) {
      throw $ERR_ILLEGAL_CONSTRUCTOR();
    }
    return Stream.Readable.from(op.$apply(this, args));
  };
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
  const op: (this: $Node.Readable, ...args: any[]) => Promise<unknown> = promiseReturningOperators[key];
  const fn = function (this: $Node.Readable, ...args: unknown[]) {
    if (new.target) {
      throw $ERR_ILLEGAL_CONSTRUCTOR();
    }
    return Promise.$resolve().then(() => op.$apply(this, args));
  };
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

if (!hasLazyMembers) definePromisesAndStream();
// The old name of `finished`.
Stream.eos = eos;

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

export default Stream;
