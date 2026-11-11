function bytesFrom(list: number[]) {
  return Uint8Array.from(list);
}
function doublesFrom(list: number[]) {
  return Float64Array.from(list);
}
for (const list of [[], [1, 2, 3], [255, 256, -1, 1.9, NaN], [, 2] as number[]]) console.log(bytesFrom(list).join(), doublesFrom(list).join(), bytesFrom(list).length);
console.log(Uint8Array.from(new Set([3, 2, 1])).join(), Uint8Array.from({ length: 2, 0: 7, 1: 8 }).join(), Uint8Array.from("123").join());
console.log(Int16Array.from([1, 2, 3], (value, at) => value * at).join(), Array.from(new Uint8Array([4, 5, 6])).join(), Array.from(new Float32Array([0.5, 1.5]), value => value * 2).join());
function sizes(view: DataView) {
  return [view.byteLength, view.byteOffset, view.buffer.byteLength].join(" ");
}
const buffer = new ArrayBuffer(16);
console.log(sizes(new DataView(buffer)), sizes(new DataView(buffer, 4)), sizes(new DataView(buffer, 4, 8)), sizes(new DataView(buffer, 16)));
function lengthOf(view: Uint32Array) {
  return view.length + " " + view.byteLength + " " + view.byteOffset;
}
console.log(lengthOf(new Uint32Array(buffer)), lengthOf(new Uint32Array(buffer, 8)), lengthOf(new Uint32Array(buffer, 4, 1)), lengthOf(new Uint32Array(0)));
const growing = new ArrayBuffer(8, { maxByteLength: 32 });
const tracking = new Uint32Array(growing);
const window = new DataView(growing, 4);
console.log(lengthOf(tracking), sizes(window));
growing.resize(24);
console.log(lengthOf(tracking), sizes(window));
growing.resize(0);
console.log(lengthOf(tracking));
try {
  console.log(sizes(window));
} catch (error) {
  console.log((error as Error).constructor.name);
}
function wide(view: BigInt64Array, at: number) {
  return view[at];
}
const wides = new BigInt64Array([0n, 1n, -1n, 9223372036854775807n, -9223372036854775808n, 4294967296n]);
for (let at = 0; at <= wides.length; at++) console.log(String(wide(wides, at)));
const unsigned = new BigUint64Array([0n, 18446744073709551615n, 4294967295n]);
for (let at = 0; at < unsigned.length; at++) console.log(String(unsigned[at]));
