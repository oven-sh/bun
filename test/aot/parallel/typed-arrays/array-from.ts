// Array.from(view): every kind of element, lengths on both sides of what is copied in line, NaN and -0, and the views that have to go through the function.

function text(value: unknown): string {
  return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? `${value}n` : String(value);
}

function show(name: string, list: unknown[]): void {
  let holes = 0;
  for (let i = 0; i < list.length; i++) if (!(i in list)) holes++;
  const ends = list.length > 8 ? [...list.slice(0, 4), "..", ...list.slice(-4)] : list;
  console.log(name, Array.isArray(list), list.length, holes, ends.map(text).join(","));
}

const fromInt8 = (view: Int8Array): number[] => Array.from(view);
const fromUint8 = (view: Uint8Array): number[] => Array.from(view);
const fromClamped = (view: Uint8ClampedArray): number[] => Array.from(view);
const fromInt16 = (view: Int16Array): number[] => Array.from(view);
const fromUint16 = (view: Uint16Array): number[] => Array.from(view);
const fromInt32 = (view: Int32Array): number[] => Array.from(view);
const fromUint32 = (view: Uint32Array): number[] => Array.from(view);
const fromFloat32 = (view: Float32Array): number[] => Array.from(view);
const fromFloat64 = (view: Float64Array): number[] => Array.from(view);
const fromBigInt64 = (view: BigInt64Array): bigint[] => Array.from(view);

show("int8", fromInt8(new Int8Array([-128, -1, 0, 127])));
show("uint8", fromUint8(new Uint8Array([0, 1, 254, 255])));
show("clamped", fromClamped(new Uint8ClampedArray([-5, 0.5, 1.5, 300])));
show("int16", fromInt16(new Int16Array([-32768, -1, 32767])));
show("uint16", fromUint16(new Uint16Array([0, 65535])));
show("int32", fromInt32(new Int32Array([-2147483648, -1, 0, 2147483647])));
show("uint32", fromUint32(new Uint32Array([0, 2147483647, 2147483648, 4294967295])));
show("float32", fromFloat32(new Float32Array([-0, 0.5, 1e30, Infinity, -Infinity])));
show("float64", fromFloat64(new Float64Array([-0, 0.1, 1e300, Infinity, -Infinity, 2147483648, 5e-324])));
show("bigint64", fromBigInt64(new BigInt64Array([-1n, 0n, 9223372036854775807n])));

for (const length of [0, 1, 2, 511, 512, 513, 3000]) {
  const bytes = new Uint8Array(length);
  const numbers = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = i * 7;
    numbers[i] = i / 4 - 3;
  }
  show(`bytes ${length}`, fromUint8(bytes));
  show(`numbers ${length}`, fromFloat64(numbers));
}

// NaN marks a hole in a list of doubles.
show("NaN first", fromFloat64(new Float64Array([NaN, 1, 2])));
show("NaN last", fromFloat64(new Float64Array([1, 2, NaN])));
show("NaN alone", fromFloat32(new Float32Array([NaN])));
const patterns = new BigUint64Array([0x7ff80000deadbeefn, 0xfff0000000000001n, 0xfffe000000000002n, 0xffffffffffffffffn, 0x3ff0000000000000n]);
const read = fromFloat64(new Float64Array(patterns.buffer));
show("NaN of every pattern", read);
console.log(read.map(value => typeof value).join(","));
const halves = new Uint32Array([0x7fc00001, 0xffc12345, 0xffffffff, 0x3f800000]);
show("NaN of every pattern in 32 bits", fromFloat32(new Float32Array(halves.buffer)));

// The list is a copy, and an ordinary one.
const source = new Int32Array([1, 2, 3]);
const copy: unknown[] = fromInt32(source);
source[0] = 9;
copy[1] = "two";
copy.push(1.5, undefined);
copy.length = 7;
show("copy", copy);
show("source", fromInt32(source));

const buffer = new ArrayBuffer(16);
new Uint8Array(buffer).set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
show("part", fromUint8(new Uint8Array(buffer, 3, 5)));
show("part of words", fromUint16(new Uint16Array(buffer, 2, 3)));
show("subarray", fromUint8(new Uint8Array(buffer).subarray(14)));
show("Buffer", fromUint8(Buffer.from("abc")));
show("mapper undefined", Array.from(new Uint8Array([4, 5]), undefined as any));

// Whoever finds another iterator has to use it.
const withOwnIterator = new Uint8Array([1, 2, 3]);
(withOwnIterator as any)[Symbol.iterator] = function* () {
  yield 9;
  yield 8;
};
show("own iterator", fromUint8(withOwnIterator));

class Doubled extends Uint8Array {
  *[Symbol.iterator](): any {
    for (let i = 0; i < this.length; i++) yield this[i] * 2;
  }
}
show("iterator of a subclass", fromUint8(new Doubled([1, 2, 3])));

class Plain extends Float64Array {}
show("subclass", fromFloat64(new Plain([1.5, NaN, -0])));

function Other(this: any) {
  this.made = true;
}
const made = (Array.from as any).call(Other, new Uint8Array([7, 8]));
console.log(Array.isArray(made), JSON.stringify(made));

// A view whose length follows its buffer.
const growing: ArrayBuffer = new (ArrayBuffer as any)(4, { maxByteLength: 16 });
const following = new Uint8Array(growing);
following.set([1, 2, 3, 4]);
show("follows", fromUint8(following));
(growing as any).resize(6);
show("grown", fromUint8(following));
(growing as any).resize(0);
show("shrunk", fromUint8(following));

const fixedOverGrowing = new Uint8Array(growing, 0, 0);
show("empty over a buffer that grows", fromUint8(fixedOverGrowing));

// A view of a buffer that is gone.
const gone = new ArrayBuffer(8);
const left = new Float64Array(gone);
(gone as any).transfer();
try {
  show("detached", fromFloat64(left));
} catch (error) {
  console.log("detached", (error as Error).constructor.name);
}
