"use strict";

function createBuffer(BufferPrototype, BufferStatic, Realm) {
  "use strict";

  var Uint8ArraySubarray = Realm.Uint8Array.prototype.subarray;
  var isUint8Array = (value) => value instanceof Realm.Uint8Array;
  var SymbolToPrimitive = Realm.Symbol.toPrimitive;
  var isArray = Realm.Array.isArray;
  var isArrayBufferLike =
    "SharedArrayBuffer" in Realm
      ? () =>
          value instanceof Realm.ArrayBuffer ||
          value instanceof Realm.SharedArrayBuffer
      : () => value instanceof Realm.ArrayBuffer;

  var BufferInstance = class BufferInstance extends Realm.Uint8Array {
    constructor(bufferOrLength, byteOffset, length) {
      super(bufferOrLength, byteOffset, length);
    }

    static isBuffer(obj) {
      return obj instanceof BufferInstance;
    }

    static from(value, encodingOrOffset, length) {
      switch (typeof value) {
        case "string": {
          return BufferStatic.fromString(value, encodingOrOffset, length);
        }
        case "object": {
          if (isUint8Array(value)) {
            return BufferStatic.fromUint8Array(value, encodingOrOffset, length);
          }

          if (isArrayBufferLike(value)) {
            return new BufferInstance(value, 0, length);
          }

          const valueOf = value.valueOf && value.valueOf();
          if (
            valueOf != null &&
            valueOf !== value &&
            (typeof valueOf === "string" || typeof valueOf === "object")
          ) {
            return BufferInstance.from(valueOf, encodingOrOffset, length);
          }

          if (typeof value[SymbolToPrimitive] === "function") {
            const primitive = value[SymbolToPrimitive]("string");
            if (typeof primitive === "string") {
              return BufferStatic.fromString(primitive, encodingOrOffset);
            }
          }

          if (isArray(value)) {
            return BufferStatic.fromArray(value, encodingOrOffset, length);
          }
        }
      }

      throw new TypeError(
        "First argument must be a string, Buffer, ArrayBuffer, Array, or array-like object."
      );
    }

    slice(start, end) {
      return Uint8ArraySubarray.call(this, start, end);
    }

    static get poolSize() {
      return BufferStatic._poolSize;
    }

    static set poolSize(value) {
      BufferStatic._poolSize = value;
    }

    get parent() {
      return this.buffer;
    }

    get offset() {
      return this.byteOffset;
    }
  };

  Object.assign(BufferInstance, BufferStatic);
  Object.assign(BufferInstance.prototype, BufferPrototype);
  Object.defineProperty(BufferInstance, "name", {
    value: "Buffer",
    configurable: false,
    enumerable: false,
  });

  return BufferInstance;
}
