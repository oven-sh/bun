// `i << 1` wraps at 32 bits: for i = -2147483647 it is 2. The test against the length sees 2, and so must the address.
function read(bytes: Uint8Array, i: number): number {
  return bytes[(i << 1) >>> 0];
}
function readSigned(bytes: Uint8Array, i: number): number {
  return bytes[i << 1];
}
function readTested(bytes: Uint8Array, i: number): number {
  const index = (i << 2) >>> 0;
  return index < bytes.length ? bytes[index] : -1;
}
function write(bytes: Uint8Array, i: number, value: number): void {
  bytes[(i << 1) >>> 0] = value;
}
function unit(text: string, i: number): number {
  return text.charCodeAt((i << 1) >>> 0);
}
function readByEight(list: Int8Array, i: number): number {
  return list[(i << 3) >>> 0];
}
function readWide(list: Uint16Array, i: number): number {
  return list[(i << 1) >>> 0];
}
const bytes = new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17]);
const list = new Int8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const wide = new Uint16Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
for (const i of [1, 2, 3, -2147483647, -2147483646, 2147483649, 1073741825, -1073741823, 536870913, -536870911]) {
  console.log(i, read(bytes, i), readSigned(bytes, i), readTested(bytes, i), unit("abcdefghijkl", i), readByEight(list, i), readWide(wide, i));
  write(bytes, i, 99);
}
console.log(bytes.join());
