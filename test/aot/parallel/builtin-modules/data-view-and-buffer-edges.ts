// DataView accessors, Buffer's fixed-size accessors and Atomics.store at the limits of their inline paths: the last valid offset and the first invalid one, offsets that are not indexes, every form of littleEndian, values outside the range of a write, detached and resizable memory. Results, stored bytes and errors must match plain Bun.
function formatError(error: any): string {
  return error.code === undefined ? `${error.name}: ${error.message}` : `${error.name} ${error.code}: ${error.message}`;
}
function format(value: unknown): string {
  if (Array.isArray(value)) return value.map(format).join(" ");
  if (typeof value === "bigint") return value + "n";
  return Object.is(value, -0) ? "-0" : String(value);
}
function attempt(run: () => unknown): string {
  try {
    return format(run());
  } catch (error) {
    return formatError(error);
  }
}

const byteLength = 16;
function fill(memory: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(memory);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 129) & 255;
  return memory;
}
function hex(memory: ArrayBufferLike): string {
  let text = "";
  for (const byte of new Uint8Array(memory)) text += byte.toString(16).padStart(2, "0");
  return text;
}
function offsetsFor(size: number): number[] {
  return [0, byteLength - size, byteLength - size + 1, -1, 1.5, NaN, 2 ** 53];
}

type ViewRead = (view: DataView, offset: number, littleEndian: boolean) => unknown[];
const viewReads: [string, number, ViewRead][] = [
  ["getInt8", 1, (view: DataView, offset: number) => [view.getInt8(offset)]],
  ["getUint8", 1, (view: DataView, offset: number) => [view.getUint8(offset)]],
  ["getInt16", 2, (view: DataView, offset: number, littleEndian: boolean) => [view.getInt16(offset), view.getInt16(offset, true), view.getInt16(offset, false), view.getInt16(offset, undefined), view.getInt16(offset, littleEndian)]],
  ["getUint16", 2, (view: DataView, offset: number, littleEndian: boolean) => [view.getUint16(offset), view.getUint16(offset, true), view.getUint16(offset, false), view.getUint16(offset, undefined), view.getUint16(offset, littleEndian)]],
  ["getInt32", 4, (view: DataView, offset: number, littleEndian: boolean) => [view.getInt32(offset), view.getInt32(offset, true), view.getInt32(offset, false), view.getInt32(offset, undefined), view.getInt32(offset, littleEndian)]],
  ["getUint32", 4, (view: DataView, offset: number, littleEndian: boolean) => [view.getUint32(offset), view.getUint32(offset, true), view.getUint32(offset, false), view.getUint32(offset, undefined), view.getUint32(offset, littleEndian)]],
  ["getFloat32", 4, (view: DataView, offset: number, littleEndian: boolean) => [view.getFloat32(offset), view.getFloat32(offset, true), view.getFloat32(offset, false), view.getFloat32(offset, undefined), view.getFloat32(offset, littleEndian)]],
  ["getFloat64", 8, (view: DataView, offset: number, littleEndian: boolean) => [view.getFloat64(offset), view.getFloat64(offset, true), view.getFloat64(offset, false), view.getFloat64(offset, undefined), view.getFloat64(offset, littleEndian)]],
  ["getBigInt64", 8, (view: DataView, offset: number, littleEndian: boolean) => [view.getBigInt64(offset), view.getBigInt64(offset, true), view.getBigInt64(offset, false), view.getBigInt64(offset, undefined), view.getBigInt64(offset, littleEndian)]],
  ["getBigUint64", 8, (view: DataView, offset: number, littleEndian: boolean) => [view.getBigUint64(offset), view.getBigUint64(offset, true), view.getBigUint64(offset, false), view.getBigUint64(offset, undefined), view.getBigUint64(offset, littleEndian)]],
];

type ViewWrite<Value> = (view: DataView, offset: number, value: Value, littleEndian: boolean) => unknown[];
const viewNumberWrites: [string, number, ViewWrite<number>][] = [
  ["setInt8", 1, (view: DataView, offset: number, value: number) => [view.setInt8(offset, value), hex(view.buffer)]],
  ["setUint8", 1, (view: DataView, offset: number, value: number) => [view.setUint8(offset, value), hex(view.buffer)]],
  ["setInt16", 2, (view: DataView, offset: number, value: number, littleEndian: boolean) => [view.setInt16(offset, value), hex(view.buffer), view.setInt16(offset, value, true), hex(view.buffer), view.setInt16(offset, value, false), hex(view.buffer), view.setInt16(offset, value, littleEndian), hex(view.buffer), view.setInt16(offset, value, undefined), hex(view.buffer)]],
  ["setUint16", 2, (view: DataView, offset: number, value: number, littleEndian: boolean) => [view.setUint16(offset, value), hex(view.buffer), view.setUint16(offset, value, true), hex(view.buffer), view.setUint16(offset, value, false), hex(view.buffer), view.setUint16(offset, value, littleEndian), hex(view.buffer), view.setUint16(offset, value, undefined), hex(view.buffer)]],
  ["setInt32", 4, (view: DataView, offset: number, value: number, littleEndian: boolean) => [view.setInt32(offset, value), hex(view.buffer), view.setInt32(offset, value, true), hex(view.buffer), view.setInt32(offset, value, false), hex(view.buffer), view.setInt32(offset, value, littleEndian), hex(view.buffer), view.setInt32(offset, value, undefined), hex(view.buffer)]],
  ["setUint32", 4, (view: DataView, offset: number, value: number, littleEndian: boolean) => [view.setUint32(offset, value), hex(view.buffer), view.setUint32(offset, value, true), hex(view.buffer), view.setUint32(offset, value, false), hex(view.buffer), view.setUint32(offset, value, littleEndian), hex(view.buffer), view.setUint32(offset, value, undefined), hex(view.buffer)]],
  ["setFloat32", 4, (view: DataView, offset: number, value: number, littleEndian: boolean) => [view.setFloat32(offset, value), hex(view.buffer), view.setFloat32(offset, value, true), hex(view.buffer), view.setFloat32(offset, value, false), hex(view.buffer), view.setFloat32(offset, value, littleEndian), hex(view.buffer), view.setFloat32(offset, value, undefined), hex(view.buffer)]],
  ["setFloat64", 8, (view: DataView, offset: number, value: number, littleEndian: boolean) => [view.setFloat64(offset, value), hex(view.buffer), view.setFloat64(offset, value, true), hex(view.buffer), view.setFloat64(offset, value, false), hex(view.buffer), view.setFloat64(offset, value, littleEndian), hex(view.buffer), view.setFloat64(offset, value, undefined), hex(view.buffer)]],
];
const viewBigIntWrites: [string, number, ViewWrite<bigint>][] = [
  ["setBigInt64", 8, (view: DataView, offset: number, value: bigint, littleEndian: boolean) => [view.setBigInt64(offset, value), hex(view.buffer), view.setBigInt64(offset, value, true), hex(view.buffer), view.setBigInt64(offset, value, false), hex(view.buffer), view.setBigInt64(offset, value, littleEndian), hex(view.buffer), view.setBigInt64(offset, value, undefined), hex(view.buffer)]],
  ["setBigUint64", 8, (view: DataView, offset: number, value: bigint, littleEndian: boolean) => [view.setBigUint64(offset, value), hex(view.buffer), view.setBigUint64(offset, value, true), hex(view.buffer), view.setBigUint64(offset, value, false), hex(view.buffer), view.setBigUint64(offset, value, littleEndian), hex(view.buffer), view.setBigUint64(offset, value, undefined), hex(view.buffer)]],
];

type BufferRead = (buffer: Buffer, offset: number) => unknown[];
const bufferReads: [string, number, BufferRead][] = [
  ["readInt8", 1, (buffer: Buffer, offset: number) => [buffer.readInt8(offset), buffer.readInt8()]],
  ["readUInt8", 1, (buffer: Buffer, offset: number) => [buffer.readUInt8(offset), buffer.readUInt8()]],
  ["readUint8", 1, (buffer: Buffer, offset: number) => [buffer.readUint8(offset), buffer.readUint8()]],
  ["readInt16LE", 2, (buffer: Buffer, offset: number) => [buffer.readInt16LE(offset), buffer.readInt16LE()]],
  ["readInt16BE", 2, (buffer: Buffer, offset: number) => [buffer.readInt16BE(offset), buffer.readInt16BE()]],
  ["readUInt16LE", 2, (buffer: Buffer, offset: number) => [buffer.readUInt16LE(offset), buffer.readUInt16LE()]],
  ["readUInt16BE", 2, (buffer: Buffer, offset: number) => [buffer.readUInt16BE(offset), buffer.readUInt16BE()]],
  ["readUint16LE", 2, (buffer: Buffer, offset: number) => [buffer.readUint16LE(offset), buffer.readUint16LE()]],
  ["readUint16BE", 2, (buffer: Buffer, offset: number) => [buffer.readUint16BE(offset), buffer.readUint16BE()]],
  ["readInt32LE", 4, (buffer: Buffer, offset: number) => [buffer.readInt32LE(offset), buffer.readInt32LE()]],
  ["readInt32BE", 4, (buffer: Buffer, offset: number) => [buffer.readInt32BE(offset), buffer.readInt32BE()]],
  ["readUInt32LE", 4, (buffer: Buffer, offset: number) => [buffer.readUInt32LE(offset), buffer.readUInt32LE()]],
  ["readUInt32BE", 4, (buffer: Buffer, offset: number) => [buffer.readUInt32BE(offset), buffer.readUInt32BE()]],
  ["readUint32LE", 4, (buffer: Buffer, offset: number) => [buffer.readUint32LE(offset), buffer.readUint32LE()]],
  ["readUint32BE", 4, (buffer: Buffer, offset: number) => [buffer.readUint32BE(offset), buffer.readUint32BE()]],
  ["readFloatLE", 4, (buffer: Buffer, offset: number) => [buffer.readFloatLE(offset), buffer.readFloatLE()]],
  ["readFloatBE", 4, (buffer: Buffer, offset: number) => [buffer.readFloatBE(offset), buffer.readFloatBE()]],
  ["readDoubleLE", 8, (buffer: Buffer, offset: number) => [buffer.readDoubleLE(offset), buffer.readDoubleLE()]],
  ["readDoubleBE", 8, (buffer: Buffer, offset: number) => [buffer.readDoubleBE(offset), buffer.readDoubleBE()]],
  ["readBigInt64LE", 8, (buffer: Buffer, offset: number) => [buffer.readBigInt64LE(offset), buffer.readBigInt64LE()]],
  ["readBigInt64BE", 8, (buffer: Buffer, offset: number) => [buffer.readBigInt64BE(offset), buffer.readBigInt64BE()]],
  ["readBigUInt64LE", 8, (buffer: Buffer, offset: number) => [buffer.readBigUInt64LE(offset), buffer.readBigUInt64LE()]],
  ["readBigUInt64BE", 8, (buffer: Buffer, offset: number) => [buffer.readBigUInt64BE(offset), buffer.readBigUInt64BE()]],
  ["readBigUint64LE", 8, (buffer: Buffer, offset: number) => [buffer.readBigUint64LE(offset), buffer.readBigUint64LE()]],
  ["readBigUint64BE", 8, (buffer: Buffer, offset: number) => [buffer.readBigUint64BE(offset), buffer.readBigUint64BE()]],
];

type BufferWrite<Value> = (buffer: Buffer, value: Value, offset: number) => unknown[];
const bufferNumberWrites: [string, number, number, number, BufferWrite<number>][] = [
  ["writeInt8", 1, -128, 127, (buffer: Buffer, value: number, offset: number) => [buffer.writeInt8(value, offset), buffer.writeInt8(value)]],
  ["writeUInt8", 1, 0, 255, (buffer: Buffer, value: number, offset: number) => [buffer.writeUInt8(value, offset), buffer.writeUInt8(value)]],
  ["writeUint8", 1, 0, 255, (buffer: Buffer, value: number, offset: number) => [buffer.writeUint8(value, offset), buffer.writeUint8(value)]],
  ["writeInt16LE", 2, -32768, 32767, (buffer: Buffer, value: number, offset: number) => [buffer.writeInt16LE(value, offset), buffer.writeInt16LE(value)]],
  ["writeInt16BE", 2, -32768, 32767, (buffer: Buffer, value: number, offset: number) => [buffer.writeInt16BE(value, offset), buffer.writeInt16BE(value)]],
  ["writeUInt16LE", 2, 0, 65535, (buffer: Buffer, value: number, offset: number) => [buffer.writeUInt16LE(value, offset), buffer.writeUInt16LE(value)]],
  ["writeUInt16BE", 2, 0, 65535, (buffer: Buffer, value: number, offset: number) => [buffer.writeUInt16BE(value, offset), buffer.writeUInt16BE(value)]],
  ["writeUint16LE", 2, 0, 65535, (buffer: Buffer, value: number, offset: number) => [buffer.writeUint16LE(value, offset), buffer.writeUint16LE(value)]],
  ["writeUint16BE", 2, 0, 65535, (buffer: Buffer, value: number, offset: number) => [buffer.writeUint16BE(value, offset), buffer.writeUint16BE(value)]],
  ["writeInt32LE", 4, -(2 ** 31), 2 ** 31 - 1, (buffer: Buffer, value: number, offset: number) => [buffer.writeInt32LE(value, offset), buffer.writeInt32LE(value)]],
  ["writeInt32BE", 4, -(2 ** 31), 2 ** 31 - 1, (buffer: Buffer, value: number, offset: number) => [buffer.writeInt32BE(value, offset), buffer.writeInt32BE(value)]],
  ["writeUInt32LE", 4, 0, 2 ** 32 - 1, (buffer: Buffer, value: number, offset: number) => [buffer.writeUInt32LE(value, offset), buffer.writeUInt32LE(value)]],
  ["writeUInt32BE", 4, 0, 2 ** 32 - 1, (buffer: Buffer, value: number, offset: number) => [buffer.writeUInt32BE(value, offset), buffer.writeUInt32BE(value)]],
  ["writeUint32LE", 4, 0, 2 ** 32 - 1, (buffer: Buffer, value: number, offset: number) => [buffer.writeUint32LE(value, offset), buffer.writeUint32LE(value)]],
  ["writeUint32BE", 4, 0, 2 ** 32 - 1, (buffer: Buffer, value: number, offset: number) => [buffer.writeUint32BE(value, offset), buffer.writeUint32BE(value)]],
  ["writeFloatLE", 4, -3.5, 3.5, (buffer: Buffer, value: number, offset: number) => [buffer.writeFloatLE(value, offset), buffer.writeFloatLE(value)]],
  ["writeFloatBE", 4, -3.5, 3.5, (buffer: Buffer, value: number, offset: number) => [buffer.writeFloatBE(value, offset), buffer.writeFloatBE(value)]],
  ["writeDoubleLE", 8, -1e300, 1e300, (buffer: Buffer, value: number, offset: number) => [buffer.writeDoubleLE(value, offset), buffer.writeDoubleLE(value)]],
  ["writeDoubleBE", 8, -1e300, 1e300, (buffer: Buffer, value: number, offset: number) => [buffer.writeDoubleBE(value, offset), buffer.writeDoubleBE(value)]],
];
const bufferBigIntWrites: [string, number, bigint, bigint, BufferWrite<bigint>][] = [
  ["writeBigInt64LE", 8, -(2n ** 63n), 2n ** 63n - 1n, (buffer: Buffer, value: bigint, offset: number) => [buffer.writeBigInt64LE(value, offset), buffer.writeBigInt64LE(value)]],
  ["writeBigInt64BE", 8, -(2n ** 63n), 2n ** 63n - 1n, (buffer: Buffer, value: bigint, offset: number) => [buffer.writeBigInt64BE(value, offset), buffer.writeBigInt64BE(value)]],
  ["writeBigUInt64LE", 8, 0n, 2n ** 64n - 1n, (buffer: Buffer, value: bigint, offset: number) => [buffer.writeBigUInt64LE(value, offset), buffer.writeBigUInt64LE(value)]],
  ["writeBigUInt64BE", 8, 0n, 2n ** 64n - 1n, (buffer: Buffer, value: bigint, offset: number) => [buffer.writeBigUInt64BE(value, offset), buffer.writeBigUInt64BE(value)]],
  ["writeBigUint64LE", 8, 0n, 2n ** 64n - 1n, (buffer: Buffer, value: bigint, offset: number) => [buffer.writeBigUint64LE(value, offset), buffer.writeBigUint64LE(value)]],
  ["writeBigUint64BE", 8, 0n, 2n ** 64n - 1n, (buffer: Buffer, value: bigint, offset: number) => [buffer.writeBigUint64BE(value, offset), buffer.writeBigUint64BE(value)]],
];

for (const [name, size, read] of viewReads) {
  const view = new DataView(fill(new ArrayBuffer(byteLength)));
  for (const offset of offsetsFor(size)) console.log(name, offset, attempt(() => read(view, offset, true)), "|", attempt(() => read(view, offset, false)));
}
for (const [name, size, write] of viewNumberWrites) {
  for (const offset of offsetsFor(size)) {
    const view = new DataView(fill(new ArrayBuffer(byteLength)));
    console.log(name, offset, attempt(() => write(view, offset, 0x1234567, true)), "|", attempt(() => write(view, offset, 0x1234567, false)), "|", hex(view.buffer));
  }
  for (const value of [-2, 1.9, -1.9, NaN, -0, Infinity, 2 ** 32 + 258, -(2 ** 31) - 1, 1e300]) {
    const view = new DataView(fill(new ArrayBuffer(byteLength)));
    console.log(name, format(value), attempt(() => write(view, 3, value, true)));
  }
}
for (const [name, size, write] of viewBigIntWrites) {
  for (const offset of offsetsFor(size)) {
    const view = new DataView(fill(new ArrayBuffer(byteLength)));
    console.log(name, offset, attempt(() => write(view, offset, 0x0123456789abcdefn, true)), "|", attempt(() => write(view, offset, 0x0123456789abcdefn, false)), "|", hex(view.buffer));
  }
  for (const value of [0n, -2n, 2n ** 63n, -(2n ** 63n), 2n ** 64n + 258n, -(2n ** 64n) - 258n, 2n ** 200n + 7n]) {
    const view = new DataView(fill(new ArrayBuffer(byteLength)));
    console.log(name, format(value), attempt(() => write(view, 3, value, true)));
  }
}

for (const [name, size, read] of bufferReads) {
  const buffer = Buffer.from(fill(new ArrayBuffer(byteLength)));
  for (const offset of offsetsFor(size)) console.log(name, offset, attempt(() => read(buffer, offset)));
}
for (const [name, size, lowest, highest, write] of bufferNumberWrites) {
  for (const offset of offsetsFor(size)) {
    const buffer = Buffer.from(fill(new ArrayBuffer(byteLength)));
    console.log(name, offset, attempt(() => write(buffer, highest, offset)), buffer.toString("hex"));
  }
  for (const value of [lowest, highest, lowest - 1, highest + 1, 1.5, NaN, -0, Infinity, -Infinity]) {
    const buffer = Buffer.from(fill(new ArrayBuffer(byteLength)));
    console.log(name, format(value), attempt(() => write(buffer, value, 3)), buffer.toString("hex"));
  }
}
for (const [name, size, lowest, highest, write] of bufferBigIntWrites) {
  for (const offset of offsetsFor(size)) {
    const buffer = Buffer.from(fill(new ArrayBuffer(byteLength)));
    console.log(name, offset, attempt(() => write(buffer, highest, offset)), buffer.toString("hex"));
  }
  for (const value of [lowest, highest, lowest - 1n, highest + 1n, 0n, 1n, 2n ** 64n, -(2n ** 64n), 2n ** 200n]) {
    const buffer = Buffer.from(fill(new ArrayBuffer(byteLength)));
    console.log(name, format(value), attempt(() => write(buffer, value, 3)), buffer.toString("hex"));
  }
}

function accessAll(title: string, views: DataView[], buffer: Buffer, ends: number[]): void {
  for (const [name, size, read] of viewReads) console.log(title, name, views.map(view => ends.map(end => attempt(() => read(view, end - size, true))).join("; ")).join(" | "));
  for (const [name, size, write] of viewNumberWrites) console.log(title, name, views.map(view => ends.map(end => attempt(() => write(view, end - size, 77, false))).join("; ")).join(" | "));
  for (const [name, size, write] of viewBigIntWrites) console.log(title, name, views.map(view => ends.map(end => attempt(() => write(view, end - size, 77n, false))).join("; ")).join(" | "));
  for (const [name, size, read] of bufferReads) console.log(title, name, ends.map(end => attempt(() => read(buffer, end - size))).join("; "));
  for (const [name, size, , highest, write] of bufferNumberWrites) console.log(title, name, ends.map(end => attempt(() => write(buffer, highest, end - size))).join("; "));
  for (const [name, size, , highest, write] of bufferBigIntWrites) console.log(title, name, ends.map(end => attempt(() => write(buffer, highest, end - size))).join("; "));
}

const transferred = fill(new ArrayBuffer(byteLength));
const detachedView = new DataView(transferred);
const detachedBuffer = Buffer.from(transferred);
transferred.transfer();
accessAll("detached", [detachedView], detachedBuffer, [8]);

const resizable = fill(new ArrayBuffer(byteLength, { maxByteLength: 2 * byteLength }));
const lengthTrackingView = new DataView(resizable);
const fixedLengthView = new DataView(resizable, 0, 8);
const lengthTrackingBuffer = Buffer.from(resizable);
accessAll("resizable", [lengthTrackingView, fixedLengthView], lengthTrackingBuffer, [8, 9, byteLength, byteLength + 1]);
resizable.resize(2 * byteLength);
accessAll("grown", [lengthTrackingView, fixedLengthView], lengthTrackingBuffer, [8, 9, 2 * byteLength, 2 * byteLength + 1]);
resizable.resize(8);
accessAll("shrunk to the fixed view", [lengthTrackingView, fixedLengthView], lengthTrackingBuffer, [8, 9]);
resizable.resize(4);
accessAll("shrunk below the fixed view", [lengthTrackingView, fixedLengthView], lengthTrackingBuffer, [8]);
console.log(hex(resizable));

function storeInt8(elements: Int8Array, value: number): string {
  return format(Atomics.store(elements, 1, value)) + " [" + elements.join() + "]";
}
function storeUint8(elements: Uint8Array, value: number): string {
  return format(Atomics.store(elements, 1, value)) + " [" + elements.join() + "]";
}
function storeInt16(elements: Int16Array, value: number): string {
  return format(Atomics.store(elements, 1, value)) + " [" + elements.join() + "]";
}
function storeUint16(elements: Uint16Array, value: number): string {
  return format(Atomics.store(elements, 1, value)) + " [" + elements.join() + "]";
}
function storeInt32(elements: Int32Array, value: number): string {
  return format(Atomics.store(elements, 1, value)) + " [" + elements.join() + "]";
}
function storeUint32(elements: Uint32Array, value: number): string {
  return format(Atomics.store(elements, 1, value)) + " [" + elements.join() + "]";
}
function storeInteger(elements: Uint8Array, value: number): string {
  return format(Atomics.store(elements, 1, (value | 0) + 300)) + " [" + elements.join() + "]";
}
for (const value of [-0, NaN, 1.9, -1.9, -0.5, -(2 ** 31) - 1, 2 ** 31, 2 ** 32 + 258, 2 ** 53, 2 ** 63, -(2 ** 63), 1e300, Infinity, -Infinity]) {
  console.log(
    "Atomics.store",
    format(value),
    storeInt8(new Int8Array(3), value),
    storeUint8(new Uint8Array(3), value),
    storeInt16(new Int16Array(3), value),
    storeUint16(new Uint16Array(3), value),
    storeInt32(new Int32Array(3), value),
    storeUint32(new Uint32Array(3), value),
    storeInteger(new Uint8Array(3), value),
  );
}
