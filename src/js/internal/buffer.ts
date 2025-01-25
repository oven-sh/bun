const { isAnyArrayBuffer } = require("node:util/types");

function fromString(string: string, encoding) {
  return new $Buffer(string, encoding);
}

function fromArrayBuffer(arrayBuffer: ArrayBuffer, byteOffset?: number, length?: number) {
  return new $Buffer(arrayBuffer, byteOffset, length);
}

function fromObject(obj) {
  if (obj.length !== undefined || isAnyArrayBuffer(obj.buffer)) {
    if (typeof obj.length !== "number") {
      return new $Buffer(0);
    }
    return fromArrayLike(obj);
  }
  if (obj.type === "Buffer" && $isArray(obj.data)) {
    return fromArrayLike(obj.data);
  }
}

function fromArrayLike(obj) {
  if (obj.length <= 0) return new $Buffer(0);
  if (obj.length < Buffer.poolSize >>> 1) {
    //   if (obj.length > poolSize - poolOffset) createPool();
    //   const b = new FastBuffer(allocPool, poolOffset, obj.length);
    //   TypedArrayPrototypeSet(b, obj, 0);
    //   poolOffset += obj.length;
    //   alignPool();
    //   return b;
  }
  return new $Buffer(obj);
}

export default {
  fromString,
  fromObject,
  fromArrayBuffer,
};
