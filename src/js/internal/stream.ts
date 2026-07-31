"use strict";

const ObjectDefineProperty = Object.defineProperty;

const customPromisify = Symbol.for("nodejs.util.promisify.custom");
const { setDefaultHighWaterMark, getDefaultHighWaterMark } = require("internal/streams/state");
const utils = require("internal/streams/utils");
const { isArrayBufferView, isUint8Array } = require("node:util/types");
const Stream = require("internal/streams/legacy").Stream;

Stream.isDestroyed = utils.isDestroyed;
Stream.isDisturbed = utils.isDisturbed;
Stream.isErrored = utils.isErrored;
Stream.isReadable = utils.isReadable;
Stream.isWritable = utils.isWritable;

function defineValue(name, value) {
  Reflect.defineProperty(Stream, name, {
    __proto__: null,
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  return value;
}

function defineLazy(name, load) {
  ObjectDefineProperty(Stream, name, {
    __proto__: null,
    enumerable: true,
    configurable: true,
    get() {
      return defineValue(name, load());
    },
    set(value) {
      defineValue(name, value);
    },
  });
}

defineLazy("Readable", () => require("internal/streams/readable"));
defineLazy("Writable", () => require("internal/streams/writable"));
defineLazy("Duplex", () => require("internal/streams/duplex"));
defineLazy("Transform", () => require("internal/streams/transform"));
defineLazy("PassThrough", () => require("internal/streams/passthrough"));
defineLazy("duplexPair", () => require("internal/streams/duplexpair"));
defineLazy("pipeline", () => {
  const { pipeline } = require("internal/streams/pipeline");
  ObjectDefineProperty(pipeline, customPromisify, {
    __proto__: null,
    enumerable: true,
    get() {
      return Stream.promises.pipeline;
    },
  });
  return pipeline;
});
defineLazy("addAbortSignal", () => require("internal/streams/add-abort-signal").addAbortSignal);
defineLazy("finished", () => {
  const eos = require("internal/streams/end-of-stream");
  ObjectDefineProperty(eos, customPromisify, {
    __proto__: null,
    enumerable: true,
    get() {
      return Stream.promises.finished;
    },
  });
  return eos;
});
defineLazy("destroy", () => require("internal/streams/destroy").destroyer);
defineLazy("compose", () => require("internal/streams/compose"));
Stream.setDefaultHighWaterMark = setDefaultHighWaterMark;
Stream.getDefaultHighWaterMark = getDefaultHighWaterMark;

let promises;
ObjectDefineProperty(Stream, "promises", {
  __proto__: null,
  configurable: true,
  enumerable: true,
  get() {
    return (promises ??= require("internal/stream.promises"));
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
