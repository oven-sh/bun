// Array.from(view) and [...view] copy the elements of a typed array in an inline loop. Every element kind goes through it, then the views that have to leave it: NaN among doubles, no elements, a detached buffer, 513 elements, a resizable buffer, a subclass, an iterator of its own.
const lines: string[] = [];
function text(list: unknown[]): string {
  let said = list.length + "[";
  for (let i = 0; i < list.length; i++) {
    if (i === 20 && list.length > 40) i = list.length - 4;
    said += (i in list ? (Object.is(list[i], -0) ? "-0" : String(list[i])) : "hole") + " ";
  }
  return said + "]";
}
function attempt(name: string, run: () => unknown[][]): void {
  const said = new Set<string>();
  for (let round = 0; round < 20; round++) {
    try { said.add(run().map(text).join(" ")); } catch (error) { said.add(error instanceof TypeError ? "TypeError" : "another error"); }
  }
  lines.push(name + ": " + [...said].join(" | "));
}

const values = [0, 1, -1, 127, 128, 255, 256, 32767, 32768, 65535, 65536, 2147483647, 2147483648, 4294967295, 1.5, -1.5, -0, 1e40];
attempt("Int8Array", () => { const view = new Int8Array(values); return [Array.from(view), [...view], [1, ...view, 2], [0.5, ...view], ["a", ...view]]; });
attempt("Uint8Array", () => { const view = new Uint8Array(values); return [Array.from(view), [...view], [1, ...view, 2], [0.5, ...view], ["a", ...view]]; });
attempt("Uint8ClampedArray", () => { const view = new Uint8ClampedArray(values); return [Array.from(view), [...view], [1, ...view, 2], [0.5, ...view], ["a", ...view]]; });
attempt("Int16Array", () => { const view = new Int16Array(values); return [Array.from(view), [...view], [1, ...view, 2], [0.5, ...view], ["a", ...view]]; });
attempt("Uint16Array", () => { const view = new Uint16Array(values); return [Array.from(view), [...view], [1, ...view, 2], [0.5, ...view], ["a", ...view]]; });
attempt("Int32Array", () => { const view = new Int32Array(values); return [Array.from(view), [...view], [1, ...view, 2], [0.5, ...view], ["a", ...view]]; });
attempt("Uint32Array", () => { const view = new Uint32Array(values); return [Array.from(view), [...view], [1, ...view, 2], [0.5, ...view], ["a", ...view]]; });
attempt("Float32Array", () => { const view = new Float32Array(values); return [Array.from(view), [...view], [1, ...view, 2], [0.5, ...view], ["a", ...view]]; });
attempt("Float64Array", () => { const view = new Float64Array(values); return [Array.from(view), [...view], [1, ...view, 2], [0.5, ...view], ["a", ...view]]; });
attempt("BigInt64Array", () => { const view = new BigInt64Array([1n, -1n]); return [Array.from(view), [...view], ["a", ...view]]; });

function fromBytes(view: Uint8Array): number[] { return Array.from(view); }
function spreadBytes(view: Uint8Array): number[] { return [7, ...view, 9]; }
function fromFloats(view: Float32Array): number[] { return Array.from(view); }
function spreadFloats(view: Float32Array): number[] { return [0.5, ...view, 1.5]; }
function fromDoubles(view: Float64Array): number[] { return Array.from(view); }
function spreadDoubles(view: Float64Array): number[] { return [0.5, ...view, 1.5]; }
function spreadBehindText(view: Float64Array): (string | number)[] { return ["a", ...view]; }
function spreadThrice(a: Float64Array, b: Uint8Array): number[] { return [...a, ...b, ...a]; }
function counting(length: number): Uint8Array { const view = new Uint8Array(length); for (let i = 0; i < length; i++) view[i] = i; return view; }
function halves(length: number, nanAt: number): Float64Array { const view = new Float64Array(length); for (let i = 0; i < length; i++) view[i] = i === nanAt ? NaN : i + 0.5; return view; }
function detached(): Uint8Array { const buffer = new ArrayBuffer(3); const view = new Uint8Array(buffer); buffer.transfer(); return view; }
function resizable(): [ArrayBuffer, Uint8Array] { const buffer = new ArrayBuffer(4, { maxByteLength: 16 }); const view = new Uint8Array(buffer); for (let i = 0; i < 4; i++) view[i] = i + 1; return [buffer, view]; }
class Named extends Uint8Array {}

for (const length of [1, 2, 511, 512, 513, 5000]) attempt(length + " elements", () => [fromBytes(counting(length)), spreadBytes(counting(length)), fromDoubles(halves(length, -1)), spreadDoubles(halves(length, -1))]);
for (const at of [0, 1, 2]) attempt("NaN at " + at + " of 3 doubles", () => [fromDoubles(halves(3, at)), spreadDoubles(halves(3, at))]);
attempt("only NaN", () => [fromDoubles(halves(1, 0)), spreadDoubles(halves(1, 0))]);
attempt("NaN at the end of 40 doubles", () => [fromDoubles(halves(40, 39)), spreadDoubles(halves(40, 39))]);
attempt("NaN at the end of 512 doubles", () => [fromDoubles(halves(512, 511)), spreadDoubles(halves(512, 511))]);
attempt("NaN among floats", () => { const view = new Float32Array([0.5, NaN, 2.5]); return [fromFloats(view), spreadFloats(view)]; });
attempt("NaN with a payload", () => { const view = new Float64Array(new BigUint64Array([0xfffe000000000002n, 0x7ff8000000000001n]).buffer); return [fromDoubles(view), spreadDoubles(view), spreadBehindText(view)]; });
attempt("no elements", () => [fromBytes(new Uint8Array(0)), spreadBytes(new Uint8Array(0)), fromDoubles(new Float64Array(0)), spreadDoubles(new Float64Array(0))]);
attempt("detached, Array.from", () => [fromBytes(detached())]);
attempt("detached, spread", () => [spreadBytes(detached())]);
attempt("length-tracking", () => { const [, view] = resizable(); return [fromBytes(view), spreadBytes(view)]; });
attempt("length-tracking, grown", () => { const [buffer, view] = resizable(); buffer.resize(6); return [fromBytes(view), spreadBytes(view)]; });
attempt("length-tracking, emptied", () => { const [buffer, view] = resizable(); buffer.resize(0); return [fromBytes(view), spreadBytes(view)]; });
attempt("fixed length in a resizable buffer", () => { const [buffer] = resizable(); const part = new Uint8Array(buffer, 1, 2); return [fromBytes(part), spreadBytes(part)]; });
attempt("out of bounds, Array.from", () => { const [buffer] = resizable(); const part = new Uint8Array(buffer, 1, 2); buffer.resize(2); return [fromBytes(part)]; });
attempt("out of bounds, spread", () => { const [buffer] = resizable(); const part = new Uint8Array(buffer, 1, 2); buffer.resize(2); return [spreadBytes(part)]; });
attempt("part of a buffer", () => { const view = counting(10).subarray(3, 7); return [fromBytes(view), spreadBytes(view)]; });
attempt("subclass", () => { const view = new Named([1, 2, 3]); return [fromBytes(view), spreadBytes(view)]; });
attempt("iterator of its own", () => { const view = new Uint8Array([1, 2, 3]); (view as any)[Symbol.iterator] = function* () { yield 40; yield 50; }; return [fromBytes(view), spreadBytes(view)]; });
attempt("three spreads", () => [spreadThrice(halves(3, -1), counting(5)), spreadThrice(halves(3, 1), counting(5)), spreadThrice(halves(30, -1), counting(30))]);
attempt("written afterwards", () => { const copy = fromBytes(counting(3)), spread = spreadBytes(counting(3)); copy.push(0.5); copy[6] = 7; spread.push(0.5); spread[8] = 7; return [copy, spread]; });
console.log(lines.join("\n"));
export {};
