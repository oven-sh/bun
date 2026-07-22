// LazyTransform is a special type of Transform stream that is lazily loaded.
// This is used for performance with bi-API-ship: when two APIs are available
// for the stream, one conventional and one non-conventional.
"use strict";

const Transform = require("internal/streams/transform");

const ObjectDefineProperty = Object.defineProperty;
const ObjectDefineProperties = Object.defineProperties;

function LazyTransform(options) {
  this._options = options;
}
$toClass(LazyTransform, "LazyTransform", Transform);

function makeGetter(name) {
  return function () {
    Transform.$call(this, this._options);
    this._writableState.decodeStrings = false;
    return this[name];
  };
}

function makeSetter(name) {
  return function (val) {
    ObjectDefineProperty(this, name, {
      __proto__: null,
      value: val,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  };
}

ObjectDefineProperties(LazyTransform.prototype, {
  _readableState: {
    __proto__: null,
    get: makeGetter("_readableState"),
    set: makeSetter("_readableState"),
    configurable: true,
    enumerable: true,
  },
  _writableState: {
    __proto__: null,
    get: makeGetter("_writableState"),
    set: makeSetter("_writableState"),
    configurable: true,
    enumerable: true,
  },
});

export default LazyTransform;
