// The bytes that a store of what may be undefined, null or a boolean leaves in views of every kind.
function putOptional(list: Float64Array, at: number, value?: number): void {
  list[at] = value!;
}
function putNullable(list: Float64Array, at: number, value: number | null): void {
  list[at] = value as number;
}
function putFlag(list: Float64Array, at: number, value: number | boolean): void {
  list[at] = value as number;
}
function putFloat32(list: Float32Array, at: number, value?: number): void {
  list[at] = value!;
}
function putInt32(list: Int32Array, at: number, value?: number): void {
  list[at] = value!;
}
function putUint8(list: Uint8Array, at: number, value?: number): void {
  list[at] = value!;
}
function putClamped(list: Uint8ClampedArray, at: number, value?: number): void {
  list[at] = value!;
}
function putOutside(list: Float64Array, at: number, value?: number): void {
  list[at] = value!;
}
function hex(view: ArrayBufferView): string {
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString("hex");
}
const doubles = new Float64Array(6);
const floats = new Float32Array(6);
const ints = new Int32Array(6).fill(7);
const bytes = new Uint8Array(6).fill(7);
const clamped = new Uint8ClampedArray(6).fill(7);
const values: (number | undefined)[] = [1.5, undefined, -0, NaN, -NaN, 300.7];
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < 6; i++) {
    putOptional(doubles, i, values[i]);
    putFloat32(floats, i, values[i]);
    putInt32(ints, i, values[i]);
    putUint8(bytes, i, values[i]);
    putClamped(clamped, i, values[i]);
    putOutside(doubles, i + 6, values[i]);
  }
}
console.log(hex(doubles), hex(floats), hex(ints), hex(bytes), hex(clamped));
const others = new Float64Array(6);
const nullable: (number | null)[] = [null, 2.5, null];
const flags: (number | boolean)[] = [true, false, 4.25];
for (let i = 0; i < 3; i++) {
  putNullable(others, i, nullable[i]);
  putFlag(others, i + 3, flags[i]);
}
console.log(hex(others), Array.from(others).join());
