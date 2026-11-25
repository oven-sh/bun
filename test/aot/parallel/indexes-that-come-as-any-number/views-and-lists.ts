// An index that is now a small integer and now another number: what a view and a list read and store there.
declare const process: { readonly argv: readonly string[] };
export {};
const numbers = [0, 3, 6, 7, -1, -0, 2.5, 3.0000000001, NaN, Infinity, -Infinity, 1e9, 2 ** 31, 2 ** 32 + 1, -(2 ** 31), 2 ** 53, 4, 1e300, 0.5 + 0.5, 6 * 0.5, process.argv.length / 2];
type View = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;
class Machine {
  steps = 0;
  constructor(readonly words: Int32Array, readonly marks: Uint8Array) {}
  add(at: number, depth: number): string {
    if (this.marks[at] === depth) return "seen";
    this.marks[at] = depth;
    this.words[at] ^= 5;
    this.words[at]++;
    this.steps++;
    return `${this.words[at]} ${at in this.words}`;
  }
}
function readInt32(view: Int32Array, at: number) { return view[at]; }
function storeFloat(view: Float64Array, at: number, value: number) { view[at] = value; return view[at]; }
function storeClamped(view: Uint8ClampedArray, at: number) { view[at] = 300.5; view[at + 1] = view[at]!; return view[at]; }
function storeBig(view: BigInt64Array, at: number) { view[at] = 9n; return String(view[at]); }
function change(view: View, at: number) { view[at]!++; return view[at]; }
function readList(list: (number | string)[], at: number) { return list[at] === 3 ? "three" : list[at]; }
function* reads(view: Int32Array, at: number): Generator<number | undefined> { yield view[at]; yield view[at + 1]; }
const machine = new Machine(new Int32Array(7), new Uint8Array(7));
const floats = new Float64Array(7), clamped = new Uint8ClampedArray(7), big = new BigInt64Array(7);
const views: View[] = [new Int8Array(7), new Uint8Array(7), new Uint8ClampedArray(7), new Int16Array(7), new Uint16Array(7), new Int32Array(7), new Uint32Array(7), new Float32Array(7), new Float64Array(7)];
for (let depth = 1; depth < 3; depth++) {
  for (const at of numbers) {
    console.log(String(at), machine.add(at, depth), machine.add(at, depth), readInt32(machine.words, at), storeFloat(floats, at, at), storeClamped(clamped, at), storeBig(big, at), views.map(view => String(change(view, at))).join(), readList([1, "two", 3, 4], at), [...reads(machine.words, at)].map(String).join());
  }
}
console.log(machine.steps, machine.words.join(), machine.marks.join(), floats.join(), clamped.join(), big.join(), views.map(view => Object.keys(view).length).join());
const growing = new Int32Array(new ArrayBuffer(8, { maxByteLength: 64 }));
growing.buffer.resize(28);
const detached = new Int32Array(7);
structuredClone(detached.buffer, { transfer: [detached.buffer] });
for (const at of numbers) console.log(String(readInt32(growing, at)), String(readInt32(detached, at)), new Machine(growing, machine.marks).add(at, 9), growing.length);
