// emit.rs copies the declarations that a schema needs into its module. A blank line ends a declaration.
export {};

interface $Writer {
  buf: Uint8Array<ArrayBuffer>;
  pos: number;
}

interface $Reader {
  buf: Uint8Array;
  pos: number;
  depth: number;
}

const $scratch = /* @__PURE__ */ new DataView(/* @__PURE__ */ new ArrayBuffer(8));

const $noBytes = /* @__PURE__ */ new Uint8Array(0);

const $encoder = /* @__PURE__ */ new TextEncoder();

const $strictDecoder = /* @__PURE__ */ new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const $looseDecoder = /* @__PURE__ */ new TextDecoder("utf-8", { ignoreBOM: true });

let $idleWriter: $Writer | undefined;

function $writer(): $Writer {
  const w = $idleWriter;
  if (w === undefined) return { buf: new Uint8Array(256), pos: 0 };
  $idleWriter = undefined;
  w.pos = 0;
  return w;
}

function $finish(w: $Writer): Uint8Array<ArrayBuffer> {
  const bytes = w.buf.slice(0, w.pos);
  if (w.buf.length <= 65536) $idleWriter = w;
  return bytes;
}

// gRPC puts a flag and the length before each message.
function $framer(): $Writer {
  const w = $writer();
  w.pos = 5;
  return w;
}

function $finishFrame(w: $Writer): Uint8Array<ArrayBuffer> {
  const buf = w.buf;
  const length = w.pos - 5;
  buf[0] = 0;
  buf[1] = length >>> 24;
  buf[2] = length >>> 16;
  buf[3] = length >>> 8;
  buf[4] = length;
  return $finish(w);
}

function $reserve(w: $Writer, count: number): void {
  const end = w.pos + count;
  if (end > w.buf.length) {
    const buf = new Uint8Array(Math.max(end, w.buf.length * 2));
    buf.set(w.buf.subarray(0, w.pos));
    w.buf = buf;
  }
}

function $invalidValue(type: string, value: unknown): TypeError {
  const shown = typeof value === "string" ? JSON.stringify(value) : typeof value === "bigint" ? value + "n" : value;
  return new TypeError(
    `Expected ${type}, received ${typeof shown === "object" && shown !== null ? typeof shown : String(shown)}`,
  );
}

function $expectMessage(value: unknown): void {
  if (typeof value !== "object" || value === null) throw $invalidValue("a message", value);
}

function $lengthOf(value: readonly unknown[]): number {
  if (!Array.isArray(value)) throw $invalidValue("an array", value);
  return value.length;
}

function $keysOf(value: object): string[] {
  if (typeof value !== "object" || Symbol.iterator in value) throw $invalidValue("a plain object", value);
  return Object.keys(value);
}

function $missingField(name: string): TypeError {
  return new TypeError(`Missing required field ${name}`);
}

function $putVarint(w: $Writer, value: number): void {
  const buf = w.buf;
  let pos = w.pos;
  while (value > 127) {
    buf[pos++] = value | 128;
    value >>>= 7;
  }
  buf[pos++] = value;
  w.pos = pos;
}

function $putVarint64(w: $Writer, low: number, high: number): void {
  const buf = w.buf;
  let pos = w.pos;
  while (high !== 0) {
    buf[pos++] = low | 128;
    low = (low >>> 7) | (high << 25);
    high >>>= 7;
  }
  w.pos = pos;
  $putVarint(w, low >>> 0);
}

function $put32(w: $Writer, value: number): void {
  const buf = w.buf;
  const pos = w.pos;
  buf[pos] = value;
  buf[pos + 1] = value >>> 8;
  buf[pos + 2] = value >>> 16;
  buf[pos + 3] = value >>> 24;
  w.pos = pos + 4;
}

function $putScratch64(w: $Writer): void {
  $put32(w, $scratch.getInt32(0, true));
  $put32(w, $scratch.getInt32(4, true));
}

// Leaves room for the tag and for one number, so the writers of numbers reserve nothing.
function $tag(w: $Writer, tag: number): void {
  $reserve(w, 15);
  $putVarint(w, tag);
}

function $fork(w: $Writer): number {
  return ++w.pos;
}

function $varintSize(value: number): number {
  return value < 0x80 ? 1 : value < 0x4000 ? 2 : value < 0x200000 ? 3 : value < 0x10000000 ? 4 : 5;
}

// Writes the length of what follows `start` into the `room` bytes before it.
function $join(w: $Writer, start: number, room: number): void {
  const length = w.pos - start;
  if (length > 0x7fffffff) throw new RangeError("A protobuf message cannot be larger than 2 GiB");
  const more = $varintSize(length) - room;
  if (more !== 0) {
    $reserve(w, more);
    w.buf.copyWithin(start + more, start, w.pos);
  }
  w.pos = start - room;
  $putVarint(w, length);
  w.pos += length;
}

function $writeInt32(w: $Writer, value: number): void {
  if ((value | 0) !== value) throw $invalidValue("an int32", value);
  $putVarint64(w, value, value >> 31);
}

function $writeUint32(w: $Writer, value: number): void {
  if (value >>> 0 !== value) throw $invalidValue("a uint32", value);
  $putVarint(w, value);
}

function $writeSint32(w: $Writer, value: number): void {
  if ((value | 0) !== value) throw $invalidValue("an int32", value);
  $putVarint(w, ((value << 1) ^ (value >> 31)) >>> 0);
}

function $writeFixed32(w: $Writer, value: number): void {
  if (value >>> 0 !== value) throw $invalidValue("a uint32", value);
  $put32(w, value);
}

function $writeSfixed32(w: $Writer, value: number): void {
  if ((value | 0) !== value) throw $invalidValue("an int32", value);
  $put32(w, value);
}

function $toBigInt(value: bigint | number, type: string): bigint {
  if (typeof value === "bigint") return value;
  if (!Number.isSafeInteger(value)) throw $invalidValue(type, value);
  return BigInt(value);
}

function $loadInt64(value: bigint | number): void {
  const big = $toBigInt(value, "an int64");
  if (BigInt.asIntN(64, big) !== big) throw $invalidValue("an int64", value);
  $scratch.setBigInt64(0, big, true);
}

function $loadUint64(value: bigint | number): void {
  const big = $toBigInt(value, "a uint64");
  if (BigInt.asUintN(64, big) !== big) throw $invalidValue("a uint64", value);
  $scratch.setBigUint64(0, big, true);
}

function $writeInt64(w: $Writer, value: bigint | number): void {
  $loadInt64(value);
  $putVarint64(w, $scratch.getInt32(0, true), $scratch.getInt32(4, true));
}

function $writeUint64(w: $Writer, value: bigint | number): void {
  $loadUint64(value);
  $putVarint64(w, $scratch.getInt32(0, true), $scratch.getInt32(4, true));
}

function $writeSint64(w: $Writer, value: bigint | number): void {
  $loadInt64(value);
  const low = $scratch.getInt32(0, true);
  const high = $scratch.getInt32(4, true);
  const sign = high >> 31;
  $putVarint64(w, (low << 1) ^ sign, ((high << 1) | (low >>> 31)) ^ sign);
}

function $writeFixed64(w: $Writer, value: bigint | number): void {
  $loadUint64(value);
  $putScratch64(w);
}

function $writeSfixed64(w: $Writer, value: bigint | number): void {
  $loadInt64(value);
  $putScratch64(w);
}

function $writeFloat(w: $Writer, value: number): void {
  if (typeof value !== "number") throw $invalidValue("a number", value);
  $scratch.setFloat32(0, value, true);
  $put32(w, $scratch.getInt32(0, true));
}

function $writeDouble(w: $Writer, value: number): void {
  if (typeof value !== "number") throw $invalidValue("a number", value);
  $scratch.setFloat64(0, value, true);
  $putScratch64(w);
}

function $writeBool(w: $Writer, value: boolean): void {
  if (typeof value !== "boolean") throw $invalidValue("a boolean", value);
  w.buf[w.pos++] = value ? 1 : 0;
}

function $writeString(w: $Writer, value: string): void {
  if (typeof value !== "string") throw $invalidValue("a string", value);
  const length = value.length;
  if (length <= 64) {
    $reserve(w, length + 1);
    const buf = w.buf;
    const start = w.pos + 1;
    let i = 0;
    for (; i < length; i++) {
      const code = value.charCodeAt(i);
      if (code > 127) break;
      buf[start + i] = code;
    }
    if (i === length) {
      buf[start - 1] = length;
      w.pos = start + length;
      return;
    }
  }
  $reserve(w, length * 3 + 5);
  const room = $varintSize(length);
  const start = w.pos + room;
  w.pos = start + $encoder.encodeInto(value, w.buf.subarray(start)).written;
  $join(w, start, room);
}

function $writeBytes(w: $Writer, value: Uint8Array): void {
  if (!(value instanceof Uint8Array)) throw $invalidValue("a Uint8Array", value);
  const length = value.length;
  $reserve(w, length + 5);
  $putVarint(w, length);
  w.buf.set(value, w.pos);
  w.pos += length;
}

function $int32Key(key: string): number {
  const value = Number(key);
  if (String(value) !== key) throw $invalidValue("an integer as the key of a map", key);
  return value;
}

function $int64Key(key: string): bigint {
  if (!/^-?[0-9]+$/.test(key)) throw $invalidValue("an integer as the key of a map", key);
  return BigInt(key);
}

function $boolKey(key: string): boolean {
  if (key !== "true" && key !== "false") throw $invalidValue('"true" or "false" as the key of a map', key);
  return key === "true";
}

// A Buffer's slice() shares its memory, so the bytes are always read through a plain Uint8Array.
function $reader(bytes: Uint8Array): $Reader {
  if (!(bytes instanceof Uint8Array)) throw $invalidValue("a Uint8Array", bytes);
  return { buf: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), pos: 0, depth: 0 };
}

function $malformed(why: string): RangeError {
  return new RangeError(`Invalid protobuf message: ${why}`);
}

function $enter(r: $Reader): void {
  if (++r.depth > 100) throw $malformed("nested more than 100 levels deep");
}

function $expectEnd(r: $Reader, end: number): void {
  if (r.pos !== end) throw $malformed("a field is longer than what contains it");
}

function $leave(r: $Reader, end: number, endGroup: number): void {
  if (endGroup !== -1) throw $malformed("a group has no end");
  $expectEnd(r, end);
  r.depth--;
}

// Leaves the low half in the first four bytes of $scratch, and the high half in the others.
function $varint64(r: $Reader): void {
  const buf = r.buf;
  let pos = r.pos;
  let low = 0;
  let high = 0;
  for (let shift = 0; shift < 70; shift += 7) {
    if (pos >= buf.length) throw $malformed("unexpected end of data");
    const byte = buf[pos++]!;
    const bits = byte & 127;
    if (shift < 28) {
      low |= bits << shift;
    } else if (shift === 28) {
      low |= bits << 28;
      high = bits >>> 4;
    } else {
      high |= bits << (shift - 32);
    }
    if (byte < 128) {
      r.pos = pos;
      $scratch.setInt32(0, low, true);
      $scratch.setInt32(4, high, true);
      return;
    }
  }
  throw $malformed("a varint is longer than 10 bytes");
}

function $readInt32(r: $Reader): number {
  const pos = r.pos;
  if (pos < r.buf.length) {
    const byte = r.buf[pos]!;
    if (byte < 128) {
      r.pos = pos + 1;
      return byte;
    }
  }
  $varint64(r);
  return $scratch.getInt32(0, true);
}

function $readTag(r: $Reader): number {
  const start = r.pos;
  const tag = $readInt32(r);
  const size = r.pos - start;
  if (size > 5 || (size === 5 && $scratch.getInt32(4, true) !== 0)) throw $malformed("a tag has more than 32 bits");
  return tag;
}

function $readUint32(r: $Reader): number {
  return $readInt32(r) >>> 0;
}

function $readSint32(r: $Reader): number {
  const value = $readInt32(r);
  return (value >>> 1) ^ -(value & 1);
}

function $readInt64(r: $Reader): bigint {
  $varint64(r);
  return $scratch.getBigInt64(0, true);
}

function $readUint64(r: $Reader): bigint {
  $varint64(r);
  return $scratch.getBigUint64(0, true);
}

function $readSint64(r: $Reader): bigint {
  $varint64(r);
  const low = $scratch.getInt32(0, true);
  const high = $scratch.getInt32(4, true);
  const sign = -(low & 1);
  $scratch.setInt32(0, ((low >>> 1) | (high << 31)) ^ sign, true);
  $scratch.setInt32(4, (high >>> 1) ^ sign, true);
  return $scratch.getBigInt64(0, true);
}

function $readBool(r: $Reader): boolean {
  $varint64(r);
  return ($scratch.getInt32(0, true) | $scratch.getInt32(4, true)) !== 0;
}

function $readSfixed32(r: $Reader): number {
  const buf = r.buf;
  const pos = r.pos;
  if (pos + 4 > buf.length) throw $malformed("unexpected end of data");
  r.pos = pos + 4;
  return buf[pos]! | (buf[pos + 1]! << 8) | (buf[pos + 2]! << 16) | (buf[pos + 3]! << 24);
}

function $readFixed32(r: $Reader): number {
  return $readSfixed32(r) >>> 0;
}

function $readFloat(r: $Reader): number {
  $scratch.setInt32(0, $readSfixed32(r), true);
  return $scratch.getFloat32(0, true);
}

function $fixed64(r: $Reader): void {
  $scratch.setInt32(0, $readSfixed32(r), true);
  $scratch.setInt32(4, $readSfixed32(r), true);
}

function $readFixed64(r: $Reader): bigint {
  $fixed64(r);
  return $scratch.getBigUint64(0, true);
}

function $readSfixed64(r: $Reader): bigint {
  $fixed64(r);
  return $scratch.getBigInt64(0, true);
}

function $readDouble(r: $Reader): number {
  $fixed64(r);
  return $scratch.getFloat64(0, true);
}

// Reads a length, and returns the position at which that many bytes end.
function $readEnd(r: $Reader): number {
  const start = r.pos;
  const length = $readInt32(r);
  const isUint31 = length >= 0 && (r.pos - start < 5 || $scratch.getInt32(4, true) === 0);
  if (!isUint31 || length > r.buf.length - r.pos) throw $malformed("unexpected end of data");
  return r.pos + length;
}

function $readString(r: $Reader): string {
  const end = $readEnd(r);
  const start = r.pos;
  if (start === end) return "";
  r.pos = end;
  try {
    return $strictDecoder.decode(r.buf.subarray(start, end));
  } catch {
    throw $malformed("a string is not valid UTF-8");
  }
}

function $readLooseString(r: $Reader): string {
  const end = $readEnd(r);
  const start = r.pos;
  r.pos = end;
  return $looseDecoder.decode(r.buf.subarray(start, end));
}

function $readBytes(r: $Reader): Uint8Array<ArrayBuffer> {
  const end = $readEnd(r);
  const start = r.pos;
  r.pos = end;
  return r.buf.slice(start, end);
}

function $skip(r: $Reader, tag: number): void {
  if (tag >>> 3 === 0) throw $malformed("a field has the number 0");
  switch (tag & 7) {
    case 0:
      return $varint64(r);
    case 1:
      r.pos += 8;
      return;
    case 2:
      r.pos = $readEnd(r);
      return;
    case 3:
      $enter(r);
      for (let inner = $readTag(r); inner !== tag + 1; inner = $readTag(r)) $skip(r, inner);
      r.depth--;
      return;
    case 5:
      r.pos += 4;
      return;
  }
  throw $malformed((tag & 7) === 4 ? "a group ends that did not start" : `unknown wire type ${tag & 7}`);
}
