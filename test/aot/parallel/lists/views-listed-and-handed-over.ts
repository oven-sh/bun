// Views spread into literals, pushes and calls, given to apply and to Array.from: every class, every length, shrunk, detached, with names of their own.
const show = (list: any) => "[" + Array.from({ length: list.length }, (_, k) => (Object.is(list[k], -0) ? "-0" : typeof list[k] === "bigint" ? list[k] + "n" : String(list[k]))).join() + "]";
let hash = 7; const note = (text: string) => { for (let k = 0; k < text.length; k++) hash = (hash * 31 + text.charCodeAt(k)) | 0; };
const classes: any[] = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array];
if ((globalThis as any).Float16Array) classes.push((globalThis as any).Float16Array);
const fill = (view: any) => { for (let k = 0; k < view.length; k++) view[k] = view instanceof BigInt64Array || view instanceof BigUint64Array ? BigInt(k * 37 - 5) : k % 7 === 6 ? -0.5 : k * 37 - 5; return view; };
const total = (...all: any[]) => all.length + ":" + all.slice(0, 5).map(String).join() + ":" + String(all[all.length - 1]);
function spread(view: any) { return [...view]; }
function before(view: any, a: any) { return [...view, a]; }
function behind(view: any, a: any) { return [a, ...view]; }
function both(view: any, other: any) { return [...view, ...other]; }
function pushed(list: any[], view: any) { list.push(...view); return list; }
function from(view: any) { return Array.from(view); }
function mapped(view: any) { return Array.from(view, (x: any, k) => (typeof x === "bigint" ? x + 1n : x + k)); }
function applied(view: any) { return total.apply(null, view); }
function called(view: any) { return total(...view, "end"); }
function letters(view: any) { return String.fromCharCode.apply(null, view); }
let turns = 0;
for (const Class of classes) {
  const lines: string[] = [];
  for (let round = 0; round < 3; round++) for (const size of [0, 1, 2, 3, 7, 16, 17, 33, 64, 65, 126, 127, 128, 129, 500, 1100, 3000]) {
    const view = fill(new Class(size)); turns++;
    lines.push(show(spread(view)), show(before(view, "x")), show(before(view, 0.5)), show(behind(view, 1)), show(both(view, [1, 2])), show(both([0.5], view)), show(both(["t"], view)), show(pushed([], view)), show(pushed([1], view)), show(pushed([0.5], view)), show(pushed(["s"], view)), show(from(view)), show(mapped(view)), applied(view), called(view));
    if (!Class.name.startsWith("Big")) lines.push(String(Math.max.apply(null, view)), String(Math.min(...(view as any))), letters(view.subarray(0, 40)));
    const kept = spread(view); kept.push("late"); if (size) kept[0] = "first"; lines.push(show(view).length + " " + kept.length);
  }
  note(lines.join("\n")); console.log(Class.name, lines.length, hash);
}
const unusual = new Float64Array([NaN, 1, Infinity, -0, 5e-324]), single = new Float32Array([NaN, 0.1, -0, 3.5]), large = new Uint32Array([0, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1]);
for (let k = 0; k < 30; k++) for (const view of [unusual, single, large]) note(show(spread(view)) + show(before(view, k)) + show(from(view)) + show(mapped(view)) + applied(view) + show(pushed([1, 2], view)));
console.log(hash, show(spread(unusual)), show(spread(single)), show(spread(large)));
// Views that shrink and grow, or lose their buffer, while they are listed.
const buffer = new ArrayBuffer(16, { maxByteLength: 64 }), tracking = new Uint8Array(buffer), fixed = new Uint8Array(buffer, 0, 12); for (let k = 0; k < 16; k++) tracking[k] = k;
console.log(show(spread(tracking)), show(Array.from(tracking, (x, k) => { if (k === 3) buffer.resize(8); return x; })), show(spread(tracking))); for (const f of [spread, from, mapped, applied, called] as any[]) { try { console.log(show(f(fixed))); } catch (error: any) { console.log(error.name); } }
buffer.resize(24); console.log(show(spread(tracking)), show(spread(fixed)), show(Array.from(tracking, (x, k) => { if (k === 2) buffer.resize(32); return k; })).length, applied(fixed));
const gone = new Uint8Array([1, 2, 3, 4]); try { console.log(show(Array.from(gone, (x, k) => { if (k === 1) structuredClone(gone.buffer, { transfer: [gone.buffer] }); return x; }))); } catch (error: any) { console.log(error.name); }
for (const f of [spread, from, mapped, applied, called] as any[]) { try { console.log(show(f(gone))); } catch (error: any) { console.log(error.name); } }
// Names of their own.
const own: any = new Uint8Array([1, 2, 3]); own[Symbol.iterator] = function* () { yield "own"; }; const none: any = new Uint8Array([1, 2, 3]); none[Symbol.iterator] = undefined; const long: any = new Uint8Array([1, 2, 3]); Object.defineProperty(long, "length", { value: 5 }); const short: any = new Uint8Array([1, 2, 3]); Object.defineProperty(short, "length", { value: 2 });
for (let k = 0; k < 3; k++) { console.log(show(spread(own)), show(from(own)), show(mapped(own)), applied(own), show(from(none)), applied(none), applied(long), applied(short), show(spread(long)), show(from(short))); try { spread(none); } catch (error: any) { console.log(error.name); } }
class Sub extends Uint8Array { *[Symbol.iterator](): any { yield* [9, 8]; } } const sub = new Sub(3); console.log(show(spread(sub)), show(from(sub)), applied(sub));
class List extends Array<any> { } console.log((List as any).from(new Uint8Array([1, 2])) instanceof List, show(List.from(new Float64Array([1.5, NaN]), x => x)), show((Array.from as any).call(Object, new Uint8Array([4, 5]))));
try { Array.from(new Uint8Array(3), x => { throw new RangeError("stop " + x); }); } catch (error: any) { console.log(error.message); } const self: any[] = []; Array.from(new Uint8Array(3), function (this: any, x, k) { self.push(this === unusual, x, k, arguments.length); return x; }, unusual); console.log(self.join());
console.log(turns, hash);
