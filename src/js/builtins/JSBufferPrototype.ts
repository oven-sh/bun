interface BufferExt extends Buffer {
  toString(encoding?: BufferEncoding, start?: number, end?: number): string;
  toString(offset: number, length: number, encoding?: BufferEncoding): string;
}

export function toJSON(this: BufferExt) {
  const type = "Buffer";
  // A detached or out-of-bounds view has length 0, and the %TypedArray% iterator throws on it.
  const data = this.length === 0 ? [] : Array.from(this);
  return { type, data };
}

$getter;
export function parent(this: BufferExt) {
  return $isObject(this) && this instanceof $Buffer ? this.buffer : undefined;
}

$getter;
export function offset(this: BufferExt) {
  return $isObject(this) && this instanceof $Buffer ? this.byteOffset : undefined;
}
