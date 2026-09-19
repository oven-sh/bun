interface BufferExt extends Buffer {
  toString(encoding?: BufferEncoding, start?: number, end?: number): string;
  toString(offset: number, length: number, encoding?: BufferEncoding): string;
}

export function toJSON(this: BufferExt) {
  // Like Node, read `length` (0 for a detached or out-of-bounds view) instead of
  // iterating: the %TypedArray% iterator throws on such views.
  const length = this.length;
  if (length > 0) {
    const data = $newArrayWithSize<number>(length);
    for (let i = 0; i < length; i++) $putByValDirect(data, i, this[i]);
    return { type: "Buffer", data };
  }
  return { type: "Buffer", data: [] };
}

$getter;
export function parent(this: BufferExt) {
  return $isObject(this) && this instanceof $Buffer ? this.buffer : undefined;
}

$getter;
export function offset(this: BufferExt) {
  return $isObject(this) && this instanceof $Buffer ? this.byteOffset : undefined;
}
