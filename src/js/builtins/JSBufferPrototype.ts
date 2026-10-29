export function toJSON(this: Buffer) {
  const type = "Buffer";
  const data = Array.from(this);
  return { type, data };
}

$getter;
export function parent(this: Buffer) {
  return $isObject(this) && this instanceof $Buffer ? this.buffer : undefined;
}

$getter;
export function offset(this: Buffer) {
  return $isObject(this) && this instanceof $Buffer ? this.byteOffset : undefined;
}
