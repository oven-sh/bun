interface BufferExt extends Buffer {
  toString(encoding?: BufferEncoding, start?: number, end?: number): string;
  toString(offset: number, length: number, encoding?: BufferEncoding): string;
}

export function toJSON(this: BufferExt) {
  const type = "Buffer";
  const data = Array.from(this);
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
