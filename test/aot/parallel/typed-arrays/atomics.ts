// Atomics on each kind of integer view: every operation, operands beyond the width of an element, and the indexes and views that have to go through the function.

function text(value: unknown): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

function onInt8(view: Int8Array, index: number, a: number, b: number): unknown[] {
  return [Atomics.store(view, index, a), Atomics.load(view, index), Atomics.add(view, index, b), Atomics.sub(view, index, a), Atomics.and(view, index, b), Atomics.or(view, index, a), Atomics.xor(view, index, b), Atomics.exchange(view, index, a), Atomics.compareExchange(view, index, a, b), Atomics.compareExchange(view, index, a, b), Atomics.compareExchange(view, index, b, b), Atomics.load(view, index)];
}

function onUint8(view: Uint8Array, index: number, a: number, b: number): unknown[] {
  return [Atomics.store(view, index, a), Atomics.load(view, index), Atomics.add(view, index, b), Atomics.sub(view, index, a), Atomics.and(view, index, b), Atomics.or(view, index, a), Atomics.xor(view, index, b), Atomics.exchange(view, index, a), Atomics.compareExchange(view, index, a, b), Atomics.compareExchange(view, index, a, b), Atomics.compareExchange(view, index, b, b), Atomics.load(view, index)];
}

function onInt16(view: Int16Array, index: number, a: number, b: number): unknown[] {
  return [Atomics.store(view, index, a), Atomics.load(view, index), Atomics.add(view, index, b), Atomics.sub(view, index, a), Atomics.and(view, index, b), Atomics.or(view, index, a), Atomics.xor(view, index, b), Atomics.exchange(view, index, a), Atomics.compareExchange(view, index, a, b), Atomics.compareExchange(view, index, a, b), Atomics.compareExchange(view, index, b, b), Atomics.load(view, index)];
}

function onUint16(view: Uint16Array, index: number, a: number, b: number): unknown[] {
  return [Atomics.store(view, index, a), Atomics.load(view, index), Atomics.add(view, index, b), Atomics.sub(view, index, a), Atomics.and(view, index, b), Atomics.or(view, index, a), Atomics.xor(view, index, b), Atomics.exchange(view, index, a), Atomics.compareExchange(view, index, a, b), Atomics.compareExchange(view, index, a, b), Atomics.compareExchange(view, index, b, b), Atomics.load(view, index)];
}

function onInt32(view: Int32Array, index: number, a: number, b: number): unknown[] {
  return [Atomics.store(view, index, a), Atomics.load(view, index), Atomics.add(view, index, b), Atomics.sub(view, index, a), Atomics.and(view, index, b), Atomics.or(view, index, a), Atomics.xor(view, index, b), Atomics.exchange(view, index, a), Atomics.compareExchange(view, index, a, b), Atomics.compareExchange(view, index, a, b), Atomics.compareExchange(view, index, b, b), Atomics.load(view, index)];
}

function onUint32(view: Uint32Array, index: number, a: number, b: number): unknown[] {
  return [Atomics.store(view, index, a), Atomics.load(view, index), Atomics.add(view, index, b), Atomics.sub(view, index, a), Atomics.and(view, index, b), Atomics.or(view, index, a), Atomics.xor(view, index, b), Atomics.exchange(view, index, a), Atomics.compareExchange(view, index, a, b), Atomics.compareExchange(view, index, a, b), Atomics.compareExchange(view, index, b, b), Atomics.load(view, index)];
}

const operands: [number, number][] = [
  [1, 2],
  [-1, 1],
  [127, 1],
  [128, 255],
  [255, 256],
  [261, 3],
  [32767, 1],
  [-32769, 32768],
  [65535, 65543],
  [2147483647, 1],
  [-2147483648, -1],
  [4294967295, 4294967305],
  [1.9, -1.9],
  [NaN, 5],
  [-0, 0],
  [Infinity, -Infinity],
  [2 ** 53, 2 ** 31],
  [0x5a5a5a5a, 0x0ff00ff0],
];

// The neighbors of the element stay as they are.
function show(name: string, results: unknown[], view: ArrayLike<number>): void {
  console.log(name, results.map(text).join(" "), "|", Array.prototype.join.call(view, " "));
}

for (const [a, b] of operands) {
  const int8 = new Int8Array([11, 0, -11]);
  show(`int8 ${text(a)} ${text(b)}`, onInt8(int8, 1, a, b), int8);
  const uint8 = new Uint8Array([11, 0, 244]);
  show(`uint8 ${text(a)} ${text(b)}`, onUint8(uint8, 1, a, b), uint8);
  const int16 = new Int16Array([11, 0, -11]);
  show(`int16 ${text(a)} ${text(b)}`, onInt16(int16, 1, a, b), int16);
  const uint16 = new Uint16Array([11, 0, 65000]);
  show(`uint16 ${text(a)} ${text(b)}`, onUint16(uint16, 1, a, b), uint16);
  const int32 = new Int32Array([11, 0, -11]);
  show(`int32 ${text(a)} ${text(b)}`, onInt32(int32, 1, a, b), int32);
  const uint32 = new Uint32Array([11, 0, 4000000000]);
  show(`uint32 ${text(a)} ${text(b)}`, onUint32(uint32, 1, a, b), uint32);
}

// An operation whose result nobody reads still takes place, and a plain read behind it sees what it stored.
function withoutResults(view: Int32Array): string {
  const before = view[0];
  Atomics.add(view, 0, 5);
  const added = view[0];
  Atomics.store(view, 0, added * 2);
  Atomics.load(view, 0);
  Atomics.compareExchange(view, 0, view[0], 1);
  return `${before} ${added} ${view[0]}`;
}
console.log(withoutResults(new Int32Array([3])));

function addAt(view: Int32Array, index: number): string {
  try {
    return `${Atomics.add(view, index, 1)} | ${view.join(" ")}`;
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
for (const index of [0, -0, 1, 1.5, NaN, 2, 3, -1, -0.5, Infinity, -Infinity, 2 ** 31, 2 ** 32, 2 ** 53, 2 ** 63]) console.log("index", text(index), addAt(new Int32Array([10, 20, 30]), index));

const words = new Int32Array([1, 2, 3, 4, 5, 6]);
console.log("part", addAt(words.subarray(2, 4), 1), "|", words.join(" "));
console.log("part, outside", addAt(words.subarray(2, 4), 2));
console.log("shared", addAt(new Int32Array(new SharedArrayBuffer(8)), 1));
console.log("empty", addAt(new Int32Array(0), 0));

class Counters extends Int32Array {}
console.log("subclass", addAt(new Counters([7, 8]), 1));

const growing: ArrayBuffer = new (ArrayBuffer as any)(8, { maxByteLength: 32 });
const following = new Int32Array(growing);
console.log("follows", addAt(following, 1), addAt(following, 2));
(growing as any).resize(12);
console.log("grown", addAt(following, 2));
(growing as any).resize(4);
console.log("shrunk", addAt(following, 1));

const gone = new ArrayBuffer(8);
const left = new Int32Array(gone);
(gone as any).transfer();
console.log("detached", addAt(left, 0));
