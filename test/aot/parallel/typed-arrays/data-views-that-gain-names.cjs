// Methods of DataViews that stay as they were made, and of those that gain names, another prototype or an heir's methods, each behind a field, a parameter, a variable and a list.
const item = v => typeof v === "bigint" ? v + "n" : String(v);
const lines = [], say = (...all) => lines.push(all.map(item).join(" "));
const attempt = f => { try { return f(); } catch (error) { return error.name; } };
const filled = (size, start = 0) => { const v = new DataView(new ArrayBuffer(size + start), start); for (let i = 0; i < size; i++) v.setUint8(i, (i * 29 + start) & 255); return v; };
class Reader { constructor(view) { this.view = view; this.at = 0; } u8() { return this.view.getUint8(this.at++); } u16() { const x = this.view.getUint16(this.at, true); this.at += 2; return x; } i32() { const x = this.view.getInt32(this.at); this.at += 4; return x; } f64() { const x = this.view.getFloat64(this.at, true); this.at += 8; return x; } get left() { return this.view.byteLength - this.at; } }
function readAll(view, turns) { const r = new Reader(view); let s = 0; for (let k = 0; k < turns; k++) { s = (s * 31 + r.u8() + r.u16()) | 0; s = (s + r.i32()) | 0; s += r.f64() > 0 ? 1 : 2; } return s + "/" + r.at + "/" + r.left; }
say(readAll(filled(64), 4), readAll(filled(64, 5), 4), attempt(() => readAll(filled(20), 4)), attempt(() => readAll(filled(0), 1)));
class Writer { constructor(size) { this.view = new DataView(new ArrayBuffer(size)); this.at = 0; } u8(x) { this.view.setUint8(this.at, x); this.at += 1; } u32(x) { this.view.setUint32(this.at, x, true); this.at += 4; } f32(x) { this.view.setFloat32(this.at, x); this.at += 4; } text() { let s = ""; for (let i = 0; i < this.at; i++) s += this.view.getUint8(i).toString(16); return s; } }
function writeAll(turns, size) { const w = new Writer(size); for (let k = 0; k < turns; k++) { w.u8(k); w.u32(k * 0x01010101); w.f32(k / 2); } return w.text(); }
say(writeAll(5, 64), attempt(() => writeAll(9, 64)));
// A method of its own.
const own = filled(32); let calls = 0;
function sumOf(v, turns) { let s = 0; for (let k = 0; k < turns; k++) s += v.getUint8(k) + v.getInt16(k, true); return s; }
say(sumOf(own, 8)); own.getUint8 = function (i) { calls++; return this.byteLength * 1000 + i; }; say(sumOf(own, 8), calls); delete own.getUint8; say(sumOf(own, 8), calls);
const defined = filled(32); Object.defineProperty(defined, "getInt16", { value: i => -i, configurable: true }); say(sumOf(defined, 8)); Object.defineProperty(defined, "getInt16", { get() { calls += 100; return () => 7; } }); say(sumOf(defined, 8), calls);
const late = filled(32); function gainsInTheLoop(v, turns) { let s = 0; for (let k = 0; k < turns; k++) { s = s * 3 + v.getUint8(1); if (k === 3) v.getUint8 = () => 1; if (k === 5) delete v.getUint8; } return s; } say(gainsInTheLoop(late, 9));
const assigned = Object.assign(filled(32), { getUint8: () => 9, note: "n" }); say(sumOf(assigned, 4), assigned.note);
const reflected = filled(32); Reflect.set(reflected, "getUint8", () => 11); say(sumOf(reflected, 4)); const keyed = filled(32); for (const name of ["getUint8", "other"]) keyed[name] = () => 13; say(sumOf(keyed, 4));
// Another prototype.
const moved = filled(32); Object.setPrototypeOf(moved, { getUint8: i => i * 2, getInt16: () => 1, __proto__: DataView.prototype }); say(sumOf(moved, 4), moved.getUint16(0)); Object.setPrototypeOf(moved, null); say(attempt(() => sumOf(moved, 4)));
const restored = Object.setPrototypeOf(Object.setPrototypeOf(filled(32), Object.prototype), DataView.prototype); say(sumOf(restored, 4));
// Heirs.
class Loud extends DataView { getUint8(i) { return super.getUint8(i) + 1000; } get last() { return this.getUint8(this.byteLength - 1); } }
class Quiet extends DataView { at = 3; next() { return this.getUint8(this.at++); } }
const loud = new Loud(filled(32).buffer), quiet = new Quiet(filled(32).buffer); say(sumOf(loud, 4), loud.last, sumOf(quiet, 4)); function nexts(q, turns) { let s = 0; for (let k = 0; k < turns; k++) s += q.next(); return s; } say(nexts(quiet, 6), quiet.at, readAll(loud, 2), readAll(quiet, 2));
// Others with such methods, and lists of both.
const fake = { byteLength: 4, getUint8: i => i, getInt16: i => -i }; const all = [filled(16), fake, filled(16, 1), loud, own]; function each(list, turns) { let s = ""; for (let k = 0; k < turns; k++) for (const v of list) s += v.getUint8(k) + ","; return s; } say(each(all, 4), sumOf(fake, 4));
// Extracted, bound, applied and borrowed methods.
const { getUint8, setUint8 } = DataView.prototype, plain = filled(16), bound = plain.getUint8.bind(plain); function borrowed(turns) { let s = 0; for (let k = 0; k < turns; k++) { setUint8.call(plain, k, k * 3); s += getUint8.call(plain, k) + bound(k) + plain["get" + "Uint8"](k) + Reflect.apply(getUint8, plain, [k]); } return s; } say(borrowed(8), attempt(() => getUint8.call({}, 0)), attempt(() => getUint8(0)));
Object.freeze(plain); say(sumOf(plain, 4)); Object.preventExtensions(late); say(sumOf(late, 4)); const copy = structuredClone(plain); say(sumOf(copy, 4), copy.constructor === DataView);
console.log(lines.join("\n"));
