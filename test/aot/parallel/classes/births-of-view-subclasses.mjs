// Views made by classes that extend classes of views: every length, every way of making them, and what is made behind a change of the class.
const lines = []; let hash = 0;
function one(v) { return typeof v === "bigint" ? v + "n" : ArrayBuffer.isView(v) ? v.constructor.name + v.length + "[" + Array.from(v.subarray(0, 4), one).join() + "]" + v.byteLength + "," + v.byteOffset : String(v); }
function attempt(f) { try { return one(f()); } catch (e) { return e.constructor.name; } }
function note(s) { for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0; if (lines.length < 300) lines.push(s); }
for (const Base of [Float64Array, Float32Array, Int32Array, Uint32Array, Int16Array, Uint16Array, Int8Array, Uint8Array, Uint8ClampedArray, BigInt64Array, BigUint64Array]) {
  const unit = Base.name.startsWith("Big") ? 1n : 1;
  class Plain extends Base {}
  class Vector extends Base { constructor(x, y, z) { super(3); this[0] = x; this[1] = y; this[2] = z; } }
  class Tagged extends Base { constructor(n, tag) { super(n); this.tag = tag; } tag2 = 5; }
  const make = [(n) => new Plain(n), () => new Vector(unit, unit, unit), (n) => new Tagged(n, "t").tag + new Tagged(n).tag2 + one(new Tagged(n, 1))];
  for (const f of make) for (const n of [0, 1, 2, 3, 7, 8, 63, 64, 127, 128, 129, 999, 1000, 1001, 5000, -1, 1.5, "3", undefined, null, [unit, unit], { length: 2 }, new ArrayBuffer(16)]) { let s; for (let i = 0; i < 12; i++) s = attempt(() => f(n)); note(Base.name + String(n && n.length) + s); }
  const kept = []; for (let i = 0; i < 2000; i++) { const v = new Plain(1 + (i & 15)); v[0] = unit; kept.push(v); } let filled = 0; for (const v of kept) { filled += v.length; for (let i = 1; i < v.length; i++) if (v[i] != 0) filled = NaN; if (v[0] != unit) filled = NaN; } note(String(filled));
  let s = ""; for (let i = 0; i < 30; i++) { const v = new Plain(4); if (i === 10) Plain.prototype.late = 7; if (i === 20) v.own = i; s = one(v) + v.late + v.own + (Object.getPrototypeOf(v) === Plain.prototype) + (v instanceof Base); } note(s);
  Object.defineProperty(Tagged, "prototype", { value: Tagged.prototype }); class Other extends Base {} s = "";
  for (let i = 0; i < 30; i++) { if (i === 15) Object.setPrototypeOf(Other, Base === Int8Array ? Uint8Array : Int8Array); s = attempt(() => new Other(2)) + Object.prototype.toString.call(new Other(1)); } note(s);
  for (let i = 0; i < 20; i++) s = attempt(() => Reflect.construct(Base, [3], Plain)) + attempt(() => Reflect.construct(Plain, [2], Vector)) + attempt(() => Reflect.construct(Plain, [2], Object).length); note(s);
  for (let i = 0; i < 20; i++) s = attempt(() => Plain.from([unit, unit])) + attempt(() => Plain.of(unit)) + attempt(() => new Plain(new Plain(2))) + attempt(() => new Plain(3).subarray(1)) + attempt(() => new Plain(new ArrayBuffer(32, { maxByteLength: 64 }), 8, 2)) + attempt(() => Plain(3)); note(s);
  const bound = Plain.bind(null); for (let i = 0; i < 20; i++) s = attempt(() => new bound(5)); note(s);
}
console.log(lines.length, hash); console.log(lines.join("\n"));
