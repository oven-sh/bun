// Accesses of a DataView in loops: written and computed offsets up to and past the end, both byte orders, stored numbers of every kind, views that shrink, move or go away, and the order in which the methods are first read.
const item = v => Object.is(v, -0) ? "-0" : String(v);
const lines = [], say = (...all) => lines.push(all.map(item).join(" "));
const attempt = f => { try { return f(); } catch (error) { return error.name; } };
const names = () => Reflect.ownKeys(DataView.prototype).filter(k => typeof k === "string" && k !== "constructor").slice(0, 8).join();
const bytesOf = v => { const all = []; for (let i = 0; i < v.byteLength; i++) all.push(v.getUint8(i)); return all.join(); };

// The methods are read in the order of the text, and a loop that ends early reads those in front of its end alone.
const first = new DataView(new ArrayBuffer(16));
function readsInOrder(turns) { let n = 0; for (let k = 0; k < turns; k++) { first.setFloat32(0, k / 4); n += first.getFloat32(0); first.setInt16(14, k); n += first.getInt16(14); } return n; }
say(readsInOrder(0), names()); say(readsInOrder(9), names());
const short = new DataView(new ArrayBuffer(4));
function leavesInTheMiddle(turns) { let n = 0; for (let k = 0; k < turns; k++) { n += short.getUint16(2); n += short.getUint32(1); n += short.getInt8(0); } return n; }
say(attempt(() => leavesInTheMiddle(3)), names());

const view = new DataView(new ArrayBuffer(40), 3, 24);
function written(turns) {
  let n = 0;
  for (let k = 0; k < turns; k++) { view.setUint16(0, k * 70001); view.setInt32(4, k - 5, true); view.setFloat64(8, k / 3); view.setFloat32(16, -k, true); view.setInt8(20, k * 200); view.setUint32(20, k * 2 ** 31, true); n += view.getUint8(1) + view.getInt32(4, true) + view.getFloat64(8) + view.getFloat32(16, true) + view.getUint32(20, true) + view.getInt16(22); }
  return n;
}
for (const turns of [0, 1, 2, 300]) { say(written(turns)); say(bytesOf(view)); }
function lastOffsets(turns) { let n = 0; for (let k = 0; k < turns; k++) { n += view.getUint8(23); n += view.getUint16(22); n += view.getUint32(20); n += view.getFloat64(16); } return n; }
say(lastOffsets(5));
const past = [() => { let n = 0; for (let k = 0; k < 3; k++) n += view.getUint8(24); return n; }, () => { let n = 0; for (let k = 0; k < 3; k++) n += view.getUint16(23); return n; }, () => { let n = 0; for (let k = 0; k < 3; k++) n += view.getUint32(21, true); return n; }, () => { let n = 0; for (let k = 0; k < 3; k++) n += view.getFloat64(17); return n; }, () => { for (let k = 0; k < 3; k++) view.setUint8(24, 1); }, () => { for (let k = 0; k < 3; k++) view.setInt16(23, 1); }, () => { for (let k = 0; k < 3; k++) view.setFloat32(21, 1); }, () => { for (let k = 0; k < 3; k++) view.setFloat64(17, 1, true); }, () => { let n = 0; for (let k = 0; k < 3; k++) n += view.getUint16(-1); return n; }, () => { let n = 0; for (let k = 0; k < 3; k++) n += view.getUint32(2 ** 31); return n; }, () => { let n = 0; for (let k = 0; k < 3; k++) n += view.getUint32(2 ** 32); return n; }];
for (const f of past) say(attempt(f)); say(bytesOf(view));

// Computed offsets run up to the end and past it.
function sums(v, from, to, step, little) { let n = 0; for (let i = from; i < to; i += step) { n = n * 3 + v.getUint16(i, little) - v.getInt16(i, !little); n ^= v.getUint8(i); } return n; }
for (const [from, to, step] of [[0, 23, 1], [0, 24, 2], [0, 24, 1], [1, 26, 3], [-2, 8, 2], [22, 23, 1], [23, 24, 1]]) for (const little of [true, false]) say(attempt(() => sums(view, from, to, step, little)));
function fills(v, to, step, little) { for (let i = 0; i < to; i += step) { v.setUint32(i, i * 0x01020304, little); if (i & 1) v.setFloat32(i, i / 7, little); } return bytesOf(v); }
for (const [to, step] of [[21, 4], [20, 1], [22, 3], [24, 4]]) for (const little of [true, false]) { say(attempt(() => fills(view, to, step, little))); say(bytesOf(view)); }
const numbers = [0, -0, 1, -1, 127, 128, 255, 256, 65535, 65536, 2 ** 31, 2 ** 32, 2 ** 53, -(2 ** 31) - 1, 0.5, -0.5, 1e300, NaN, Infinity, -Infinity, undefined, null, true, "7", "x"];
function kinds(turns) {
  let shown = "";
  for (let k = 0; k < turns; k++) {
    const x = numbers[k];
    view.setInt8(0, x); view.setUint8(1, x); view.setInt16(2, x); view.setUint16(4, x, true); view.setInt32(6, x); view.setUint32(10, x, true); view.setFloat32(14, x); view.setFloat64(16, x, true);
    shown += [view.getInt8(0), view.getUint8(1), view.getInt16(2), view.getUint16(4, true), view.getInt32(6), view.getUint32(10, true), view.getFloat64(16, true), view.getFloat64(16)].map(item).join() + ";";
  }
  return shown;
}
say(kinds(numbers.length));
function sameBits(turns) { let n = 0; for (let k = 0; k < turns; k++) { view.setUint32(0, 0x7ff80000 + k); view.setUint32(4, 1); const x = view.getFloat64(0); view.setFloat64(8, x); n += Object.is(x, NaN) ? 1 : 0; n += Number.isNaN(view.getFloat64(8)) ? 1 : 0; view.setUint32(0, 0xfff00000 + k * 8); n += Number.isNaN(view.getFloat64(0)) ? 2 : 0; view.setUint32(12, 0x7fc00001 + k, true); n += Object.is(view.getFloat32(12, true), NaN) ? 4 : 0; } return n; }
say(sameBits(4));

// The view changes under the loop.
function shrinks(turns) { const buffer = new ArrayBuffer(16, { maxByteLength: 32 }), v = new DataView(buffer), fixed = new DataView(buffer, 0, 8); let n = 0; for (let k = 0; k < turns; k++) { v.setUint32(4, k); n += v.getUint32(4) + fixed.getUint8(7); if (k === 5) buffer.resize(8); if (k === 7) buffer.resize(6); } return n; }
say(attempt(() => shrinks(5)), attempt(() => shrinks(7)), attempt(() => shrinks(20)));
function goesAway(turns) { const buffer = new ArrayBuffer(16), v = new DataView(buffer); let n = 0; for (let k = 0; k < turns; k++) { v.setUint32(4, k); n += v.getUint32(4); if (k === 5) buffer.transfer(); } return n; }
say(attempt(() => goesAway(5)), attempt(() => goesAway(9)));
let held = new DataView(new ArrayBuffer(8)); const other = new DataView(new ArrayBuffer(2));
function isReplaced(turns) { let n = 0; for (let k = 0; k < turns; k++) { held.setUint16(0, k); n += held.getUint16(0); if (k === 4) held = other; if (k === 6) held = null; } return n; }
say(attempt(() => isReplaced(4))); held = new DataView(new ArrayBuffer(8)); say(attempt(() => isReplaced(9)));
const bytes = new Uint8Array(8), sharing = new DataView(bytes.buffer, 2);
function beside(turns) { let n = 0; for (let k = 0; k < turns; k++) { bytes[3] = k; n += sharing.getUint16(0); sharing.setUint8(1, k + 1); n += bytes[3]; n += sharing.getUint8(1); } return n; }
say(beside(300));
function invariant(turns) { let n = 0; for (let k = 0; k < turns; k++) { let s = 0; for (let i = 0; i < 8; i += 2) s += view.getUint16(i, true); n += s + view.getFloat32(8) * 0; } return n; }
view.setFloat32(8, 2); say(invariant(6)); view.setUint16(2, 777, true); say(invariant(6));
function catches(turns) { let n = 0; for (let k = 0; k < turns; k++) try { n += view.getUint16(k); } catch { n += 1000000; } return n; }
say(catches(30));
class Reader { constructor(v) { this.v = v; this.at = 0; } u8() { return this.v.getUint8(this.at++); } u16() { const x = this.v.getUint16(this.at, true); this.at += 2; return x; } f32() { const x = this.v.getFloat32(this.at); this.at += 4; return x; } }
function readAll(v) { const r = new Reader(v); let n = 0; for (let k = 0; k < 3; k++) { n = n * 5 + r.u8(); n += r.u16(); n += r.f32() > 0 ? 1 : 2; } return n + " " + r.at; }
say(attempt(() => readAll(view)), attempt(() => readAll(other)));
const own = new DataView(new ArrayBuffer(8)); own.getUint8 = i => 40 + i;
function ownMethod(v, turns) { let n = 0; for (let k = 0; k < turns; k++) { v.setUint8(1, k); n += v.getUint8(1); } return n; }
say(ownMethod(own, 5), ownMethod(view, 5), attempt(() => ownMethod({ setUint8() { }, getUint8: i => i }, 5)), attempt(() => ownMethod(Object.create(DataView.prototype), 2)));
console.log(lines.join("\n"));
