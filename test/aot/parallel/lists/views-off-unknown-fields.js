// Loops that read and store by index off a field of an unknown object: a list, a view of any kind, a text, an object with indexes, a proxy, nothing; the field or the view changes in the loop.
const log = []; let effects = 0;
const show = v => typeof v === "number" ? (Object.is(v, -0) ? "-0" : Number.isInteger(v) ? String(v) : v.toPrecision(10)) : typeof v === "bigint" ? v + "n" : typeof v === "string" ? JSON.stringify(v) : ArrayBuffer.isView(v) ? v.constructor.name + (v.length === undefined ? "" : "[" + Array.from(v).slice(0, 9).map(show).join() + "]") : Array.isArray(v) ? "[" + v.slice(0, 9).map(show).join() + "|" + v.length + "]" : typeof v === "object" && v ? "{" + Object.keys(v).slice(0, 6).join() + "}" : String(v);
class Own extends Int32Array { get first() { return this[0]; } } class Late extends Float64Array { constructor(a) { super(a); this.tag = 1; } }
const N = [1, 2, 3, 4, 5, 6, 7, 8];
const kinds = {
  list: () => [1, 2, 3, 4, 5, 6, 7, 8], doubles: () => [0.5, 1.5, 2, 3, 4, 5, 6, 7], mixed: () => [1, "2", 3.5, null, 5, undefined, 7, 8], holes: () => [1, , 3, 4, , 6, 7, 8], short: () => [1, 2, 3],
  i8: () => new Int8Array(N), u8: () => new Uint8Array(N), u8c: () => new Uint8ClampedArray(N), i16: () => new Int16Array(N), u16: () => new Uint16Array(N), i32: () => new Int32Array(N), u32: () => new Uint32Array(N.map(x => x * 600000000)), f32: () => new Float32Array(N.map(x => x / 3)), f64: () => new Float64Array(N.map(x => x / 3)), b64: () => new BigInt64Array(N.map(BigInt)),
  buffer: () => Buffer.from(N), own: () => new Own(N), late: () => new Late(N), part: () => new Int32Array(new ArrayBuffer(64), 8, 8), grown: () => new Uint8Array(new ArrayBuffer(8, { maxByteLength: 32 })), shared: () => new Int32Array(new SharedArrayBuffer(32)), tiny: () => new Int32Array(3), none: () => new Float64Array(0),
  detached: () => { const v = new Int32Array(N); structuredClone(v, { transfer: [v.buffer] }); return v; }, text: () => "12345678", object: () => ({ 0: 5, 1: 6, 2: 7, length: 3 }), proxy: () => new Proxy([1, 2, 3, 4, 5, 6, 7, 8], { get(t, k) { effects++; return t[k]; }, set(t, k, v) { effects += 3; t[k] = v; return true; } }), proxyView: () => new Proxy(new Int32Array(N), {}),
  nothing: () => undefined, null: () => null, number: () => 5, func: () => function () {}, frozen: () => Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]), accessor: () => { const a = [1, 2, 3, 4, 5, 6, 7, 8]; Object.defineProperty(a, 2, { get() { effects++; return 9; }, set() { effects += 2; }, configurable: true }); return a; }, named: () => Object.assign(new Int32Array(N), { tag: 1 }), args: () => (function () { return arguments; })(1, 2, 3, 4, 5, 6, 7, 8), set: () => new Set(N), map: () => new Map([[1, 2]]), dataview: () => new DataView(new ArrayBuffer(16)),
};
const build = name => { const o = JSON.parse('{"n":3,"t":0,"u":1}'); o.t = kinds[name](); o.u = kinds.i32(); return o; };
const added = name => { const o = JSON.parse('{"n":3}'); o.t = kinds[name](); o.u = kinds.f64(); return o; };
const literal = name => JSON.parse("[0]").map(n => ({ n, t: kinds[name](), u: kinds.u8() }))[0];
const getter = name => { const t = kinds[name](); return { n: 1, get t() { effects++; return t; }, u: kinds.i16() }; };
const above = name => Object.create({ t: kinds[name](), u: kinds.list(), n: 2 });
function kick(o) { effects += 10; if (o.t && o.t.buffer && o.t.buffer.resize) o.t.buffer.resize(4); else if (Array.isArray(o.t) && !Object.isFrozen(o.t)) o.t.length = 2; }
const runs = {
  masks(o) { let s = 1; for (let i = 0; i < 20; i++) s = (s + o.t[i & 7]) | 0; return s; },
  sums(o) { let s = 0; for (let i = 0; i < 12; i++) s += o.t[i]; return s; },
  products(o) { let s = 0; for (let i = 0; i < 8; i++) s += o.t[i] * o.u[7 - i]; return s; },
  stores(o) { let s = 0; for (let i = 0; i < 12; i++) { o.t[i & 7] = i * 1.5; s = i; } return s; },
  updates(o) { let s = 0; for (let i = 0; i < 9; i++) { o.t[i & 3] += i; s += o.t[i & 3]; } return s; },
  nests(o) { let s = 0; for (let k = 0; k < 3; k++) for (let i = 0; i < 8; i++) s = (s + o.t[i]) | 0; return s; },
  kicked(o) { let s = 0; for (let i = 0; i < 9; i++) { s += o.t[i & 7] * 2; if (i === 4) kick(o); } return s; },
  replaced(o) { let s = 0; for (let i = 0; i < 9; i++) { s = s - o.t[i & 7] * 2; if (i === 5) o.t = kinds.f64(); } return s; },
  fractions(o) { let s = 0; for (let i = 0; i < 9; i += 0.5) s += o.t[i] * 1; return s; },
};
var held; function outside() { let s = 1; for (let i = 0; i < 20; i++) s = (s + held.t[i & 7]) | 0; return s; }
for (const make of [build, added, literal, getter, above]) for (const name in kinds) {
  for (const way in runs) { let o, said; effects = 0; try { o = make(name); said = show(runs[way](o)); } catch (error) { said = "threw " + error?.constructor?.name; } let t; try { t = show(o.t); } catch (error) { t = error?.constructor?.name; } log.push(make.name + " " + name + " " + way + " " + said + " " + effects + " " + t); }
  let said; try { held = make(name); said = show(outside()); } catch (error) { said = "threw " + error?.constructor?.name; } log.push("outside " + said);
}
console.log(log.join("\n"));
