// view.set(source, offset) and view.subarray(begin, end) with every kind of receiver, source and position.
const show = value => value instanceof Error ? "throws " + value.name : ArrayBuffer.isView(value) ? value.constructor.name + "@" + value.byteOffset + "[" + Array.from(value).join() + "]" : String(value);
const attempt = f => { try { return show(f()); } catch (error) { return show(error); } };
const bytes = (...list) => Uint8Array.from(list);
class Below extends Uint8Array {}
class Other extends Uint8Array { static get [Symbol.species]() { return Uint16Array; } }
function detached() { const view = new Uint8Array(8); structuredClone(view.buffer, { transfer: [view.buffer] }); return view; }
function resizable(length, most) { return new Uint8Array(new ArrayBuffer(length, { maxByteLength: most })); }
function tracking() { const buffer = new ArrayBuffer(8, { maxByteLength: 16 }); const view = new Uint8Array(buffer, 2); buffer.resize(1); return view; }
const receivers = [() => new Uint8Array(8), () => new Uint8Array(2000), () => new Uint8Array(new ArrayBuffer(16), 4, 8), () => new Uint8Array(0), () => Buffer.alloc(8), () => new Below(8), () => new Other(8), () => new Uint8ClampedArray(8), () => new Int8Array(8), () => new Uint16Array(8), () => new Float64Array(4), () => new BigInt64Array(4), detached, () => resizable(8, 16), tracking, () => new Uint8Array(new SharedArrayBuffer(8)), () => Object.assign(new Uint8Array(8), { extra: 1 }), () => Object.setPrototypeOf(new Uint8Array(8), Uint16Array.prototype), () => new DataView(new ArrayBuffer(8)), () => [1, 2, 3], () => ({ length: 2 }), () => "text", () => 5, () => null, () => undefined];
const sources = [() => bytes(1, 2, 3), () => bytes(), () => bytes(1, 2, 3, 4, 5, 6, 7, 8), () => bytes(1, 2, 3, 4, 5, 6, 7, 8, 9), () => Buffer.from("ab"), () => new Below(2).fill(7), () => Uint8ClampedArray.from([9, 8]), () => Int8Array.from([-1, -2]), () => Uint16Array.from([257, 2]), () => Float64Array.from([1.9, -1]), () => BigInt64Array.from([1n]), detached, () => resizable(2, 4).fill(3), tracking, () => [4, 5], () => [4, , 6], () => ({ length: 2, 0: 7, 1: 8 }), () => "12", () => 5, () => null, () => undefined, () => new Set([1])];
const positions = [undefined, 0, 1, 5, 6, 7, 8, 9, -1, -0, 1.5, 2 ** 31, 2 ** 32, NaN, Infinity, -Infinity, "2", null, true, { valueOf() { return 3; } }, 1n, Symbol.iterator];
function setAt(target, source, offset) { const answer = target.set(source, offset); return answer === undefined ? target : answer; }
function setAtStart(target, source) { const answer = target.set(source); return answer === undefined ? target : answer; }
function borrowedSet(target, source, offset) { Uint8Array.prototype.set.call(target, source, offset); return target; }
function range(view, begin, end) { const part = view.subarray(begin, end); return part; }
function rest(view, begin) { const part = view.subarray(begin); return part; }
function whole(view) { const part = view.subarray(); return part; }
function borrowedRange(view, begin, end) { const part = Uint8Array.prototype.subarray.call(view, begin, end); return part; }
const fill = view => { if (ArrayBuffer.isView(view) && !(view instanceof DataView) && !(view instanceof BigInt64Array)) for (let i = 0; i < Math.min(view.length, 12); i++) view[i] = i + 1; return view; };
let lines = [];
for (let round = 0; round < 3; round++) {
  lines = [];
  receivers.forEach((receiver, r) => {
    const short = view => ArrayBuffer.isView(view) && view.length > 12 ? view.subarray(0, 12) : view;
    sources.forEach((source, s) => lines.push("set " + r + " " + s + ": " + [0, 1, 6].map(at => attempt(() => short(setAt(receiver(), source(), at)))).join(" ") + " " + attempt(() => short(setAtStart(receiver(), source()))) + " " + attempt(() => short(borrowedSet(receiver(), source(), 2)))));
    lines.push("set at " + r + ": " + positions.map(at => attempt(() => short(setAt(receiver(), bytes(1, 2), at)))).join(" "));
    lines.push("range " + r + ": " + positions.map(begin => attempt(() => short(rest(fill(receiver()), begin))) + "|" + attempt(() => short(range(fill(receiver()), 1, begin))) + "|" + attempt(() => short(range(fill(receiver()), begin, -1)))).join(" "));
    lines.push("whole " + r + ": " + attempt(() => short(whole(fill(receiver())))) + " " + attempt(() => short(borrowedRange(fill(receiver()), 2, 5))));
  });
}
console.log(lines.join("\n"));
const shared = new Uint8Array(8).fill(1); const part = rest(shared, 4); part[0] = 9; console.log(show(shared), part.buffer === shared.buffer, part.byteOffset, part.byteLength, Object.getPrototypeOf(part) === Uint8Array.prototype);
const overlapping = bytes(1, 2, 3, 4, 5, 6, 7, 8); setAt(overlapping, range(overlapping, 0, 6), 2); console.log(show(overlapping)); setAt(overlapping, range(overlapping, 2, 8), 0); console.log(show(overlapping));
const shrinks = resizable(8, 16); console.log(attempt(() => setAt(shrinks, bytes(1), { valueOf() { shrinks.buffer.resize(0); return 0; } })), attempt(() => range(resizable(8, 16), { valueOf() { return 1; } }, 4)));
for (const [name, change] of [["constructor", () => { Object.defineProperty(Uint8Array.prototype, "constructor", { value: Uint16Array, configurable: true }); }], ["species", () => { Object.defineProperty(Uint8Array, Symbol.species, { value: Uint16Array, configurable: true }); }], ["own constructor", () => 0]]) {
  let said; try { change(); said = "changed"; } catch (error) { said = "refused " + error.name; }
  const own = new Uint8Array(8); if (name === "own constructor") own.constructor = Uint16Array;
  console.log(name, said, attempt(() => range(fill(own), 2, 6)));
}
