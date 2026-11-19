// STATISTIC: ArraysGuardedForReads >= 8
class Vector {
  constructor(x, y, z) { Vector.prototype.isVector = true; this.x = x; this.y = y; this.z = z; }
  apply(m) {
    const x = this.x, y = this.y, z = this.z, e = m.elements;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    return this;
  }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  add(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
}
class Matrix {
  constructor() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  copy(m) {
    const te = this.elements, me = m.elements;
    te[0] = me[0]; te[1] = me[1]; te[2] = me[2]; te[3] = me[3]; te[4] = me[4]; te[5] = me[5]; te[6] = me[6]; te[7] = me[7];
    te[8] = me[8]; te[9] = me[9]; te[10] = me[10]; te[11] = me[11]; te[12] = me[12]; te[13] = me[13]; te[14] = me[14]; te[15] = me[15];
    return this;
  }
  multiply(a, b) {
    const ae = a.elements, be = b.elements, te = this.elements;
    const a11 = ae[0], a12 = ae[4], a13 = ae[8], a21 = ae[1], a22 = ae[5], a23 = ae[9], a31 = ae[2], a32 = ae[6], a33 = ae[10];
    const b11 = be[0], b12 = be[4], b13 = be[8], b21 = be[1], b22 = be[5], b23 = be[9], b31 = be[2], b32 = be[6], b33 = be[10];
    te[0] = a11 * b11 + a12 * b21 + a13 * b31; te[4] = a11 * b12 + a12 * b22 + a13 * b32; te[8] = a11 * b13 + a12 * b23 + a13 * b33;
    te[1] = a21 * b11 + a22 * b21 + a23 * b31; te[5] = a21 * b12 + a22 * b22 + a23 * b32; te[9] = a21 * b13 + a22 * b23 + a23 * b33;
    te[2] = a31 * b11 + a32 * b21 + a33 * b31; te[6] = a31 * b12 + a32 * b22 + a33 * b32; te[10] = a31 * b13 + a32 * b23 + a33 * b33;
    return this;
  }
  // Each store comes ahead of a read that may find it.
  shift(a, b) {
    const ae = a.elements, be = b.elements;
    ae[0] = be[1] * 2; ae[1] = be[0] * be[2]; be[2] = ae[1] - ae[0]; ae[3] = be[2] * ae[0]; be[0] = ae[3] + be[3] * 0.5; ae[2] = be[0];
    return ae[2] * be[2];
  }
  compose(position, scale, q, log) {
    const te = this.elements, x = q.x, y = q.y, z = q.z;
    const x2 = x + x, y2 = y + y, xx = x * x2, xy = x * y2, yz = y * z;
    te[0] = (1 - (xy + yz)) * scale.x; te[1] = (xx + yz) * scale.y; te[2] = xy - z; te[3] = 0;
    te[4] = position.x; te[5] = log.next; te[6] = position.y * xx; te[7] = te[0] * te[1];
    return te[4] * te[6] - te[7];
  }
  determinant() {
    const te = this.elements;
    const n11 = te[0], n12 = te[4], n13 = te[8], n21 = te[1], n22 = te[5], n23 = te[9], n31 = te[2], n32 = te[6], n33 = te[10];
    return n11 * (n22 * n33 - n23 * n32) - n12 * (n21 * n33 - n23 * n31) + n13 * (n21 * n32 - n22 * n31);
  }
}
globalThis.KEPT = [Vector, Matrix];
const show = v => typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "bigint" ? v + "n" : Array.isArray(v) || ArrayBuffer.isView(v) ? "[" + Array.from({ length: Math.min(v.length, 20) }, (_, i) => i in v ? show(v[i]) : "hole").join() + "]" + v.length : v && typeof v === "object" ? "{" + Object.keys(v).map(k => k + ":" + show(v[k])).join() + "}" : typeof v === "function" ? "function" : String(v);
let log = [];
const noisy = (n, f) => ({ valueOf() { log.push("valueOf " + n); f?.(); return 2.5; } });
const kinds = {
  doubles: () => Array.from({ length: 16 }, (_, i) => Math.sin(i + 1)),
  integers: () => Array.from({ length: 16 }, (_, i) => i - 3),
  born: () => new Matrix().elements,
  mixed: () => [1, 2.5, "3", true, null, undefined, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  holes: () => { const a = kinds.doubles(); delete a[1]; delete a[10]; return a; },
  odd: () => [NaN, -0, Infinity, -Infinity, 2 ** 53, 2 ** 31, -(2 ** 31), 5e-324, 0, 1, 1e308, -1e308, 0.1, 0.2, 0.3, NaN],
  short: () => [1.5, 2.5, 3.5],
  frozen: () => Object.freeze(kinds.doubles()),
  below: () => { class Below extends Array {} return Below.from(kinds.doubles()); },
  floats: () => new Float32Array(kinds.doubles()),
  big: () => [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n, 11n, 12n, 13n, 14n, 15n, 16n],
  noisy: () => { const a = kinds.doubles(); a[4] = noisy("four", () => { a[0] = 100; a.length = 12; }); return a; },
  accessor: () => { const a = kinds.doubles(); Object.defineProperty(a, 2, { get() { log.push("get 2"); return 4; }, set(v) { log.push("set 2 " + show(v)); } }); return a; },
  none: () => undefined,
};
const of = name => { const m = new Matrix(); m.elements = kinds[name](); return m; };
const names = Object.keys(kinds);
let lines = [], turn = 0;
function attempt(what, f, ...held) {
  log = [];
  let answer;
  try { answer = show(f()); } catch (e) { answer = e.name; }
  lines.push([what, answer, ...held.map(m => show(m instanceof Matrix ? m.elements : m)), ...log].join(" "));
}
const run = [
  (a, b, c) => attempt("multiply", () => { c.multiply(a, b); }, a, b, c),
  (a, b) => attempt("multiply itself", () => { a.multiply(a, b); }, a, b),
  a => attempt("square", () => { a.multiply(a, a); }, a),
  (a, b) => attempt("copy", () => { a.copy(b); }, a, b),
  (a, b) => attempt("shift", () => a.shift(a, b), a, b),
  a => attempt("shift itself", () => a.shift(a, a), a),
  a => attempt("determinant", () => a.determinant(), a),
  (a, b) => { const v = new Vector(1.5, turn % 3 ? 2 : "2", -0.5); attempt("apply", () => v.apply(a), v, a); },
  (a, b) => { const v = new Vector(b.elements?.[0], 2, turn), u = new Vector(0.5, b.elements?.[3], 1); attempt("dot", () => v.add(u, 0.5).dot(u) + v.dot(v), v, u); },
  (a, b) => { const p = new Vector(turn, 0.5, 1), s = turn % 4 ? new Vector(1, 1, 1) : { get x() { log.push("get x"); if (a.elements) a.elements.length = 2; return 1.5; }, y: 2 }; const q = turn % 5 ? new Vector(0.1, 0.2, 0.3) : Object.freeze(new Vector(-0, 1, NaN)); attempt("compose", () => a.compose(p, s, q, { get next() { log.push("next " + show(a.elements)); return turn % 2 ? 0.25 : turn % 3 ? NaN : "t"; } }), a, p); },
];
for (let i = 0; i < 40; i++) {
  const a = new Matrix(), b = new Matrix(), c = new Matrix();
  c.multiply(a, b).copy(a);
  a.shift(a, b);
  new Vector(1.5, 2, i).apply(c).add(new Vector(i, 2, 3), 0.5).dot(new Vector(0.5, 1, 1));
  lines.push([c.compose(new Vector(i, 0.5, 1), new Vector(1, 2, 1), new Vector(0.1, 0.2, 0.3), { next: i }), b.determinant(), c.elements].join());
}
for (const first of names) for (const second of names) { turn++; for (const f of run) f(of(first), of(second), of(names[turn % names.length])); }
for (let i = 0; i < 40; i++) { turn++; const a = of("doubles"), b = of("born"), c = of("integers"); for (const f of run) f(a, b, c); }
let hash = 0; for (const line of lines) for (let i = 0; i < line.length; i++) hash = (Math.imul(hash, 31) + line.charCodeAt(i)) | 0;
for (let i = 0; i < lines.length; i += 37) console.log(lines[i]);
console.log(lines.length, hash);
