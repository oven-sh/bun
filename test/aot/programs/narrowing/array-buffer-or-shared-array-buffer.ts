// An ArrayBuffer and a SharedArrayBuffer are cells of one kind in the engine, and each class has getters and methods of its own: a member of a value that may be either comes from the class of the value.
type AnyBuffer = ArrayBuffer | SharedArrayBuffer;
function sizeOf(buffer: AnyBuffer): number { return buffer.byteLength; }
function limitOf(buffer: AnyBuffer): number { return buffer.maxByteLength; }
function tailOf(buffer: AnyBuffer): AnyBuffer { return buffer.slice(4); }
function tagOf(buffer: AnyBuffer): string { return buffer[Symbol.toStringTag]; }
function kindOf(buffer: AnyBuffer): string {
  if (buffer instanceof SharedArrayBuffer) return `shared growable=${buffer.growable}`;
  return `unshared resizable=${buffer.resizable} detached=${buffer.detached}`;
}
function describe(value: AnyBuffer | Uint8Array | string | undefined): string {
  if (value === undefined) return "nothing";
  if (typeof value === "string") return `text ${value.length}`;
  if (value instanceof Uint8Array) return `view ${value.length} over ${kindOf(value.buffer)}`;
  return `${tagOf(value)} ${sizeOf(value)}`;
}
function firstByte(buffer: AnyBuffer): number {
  const bytes = new Uint8Array(buffer);
  bytes[0] = sizeOf(buffer);
  return new DataView(buffer).getUint8(0);
}
const buffers: AnyBuffer[] = [new ArrayBuffer(8), new SharedArrayBuffer(16), new ArrayBuffer(24, { maxByteLength: 32 }), new SharedArrayBuffer(40, { maxByteLength: 64 })];
for (let round = 0; round < 3; round++) {
  for (const buffer of buffers) console.log(round, sizeOf(buffer), limitOf(buffer), sizeOf(tailOf(buffer)), tagOf(buffer), tagOf(tailOf(buffer)), kindOf(buffer), firstByte(buffer));
}
for (const value of [buffers[0], buffers[1], new Uint8Array(buffers[0]), new Uint8Array(buffers[1]), "text", undefined]) console.log(describe(value));
const moved = new ArrayBuffer(8);
const target = moved.transfer(4);
console.log(kindOf(moved), sizeOf(moved), kindOf(target), sizeOf(target));
