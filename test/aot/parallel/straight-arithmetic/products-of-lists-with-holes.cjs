// STATISTIC: StraightArmHoleChecksRemoved >= 30
// A product takes NaN for undefined, so a hole of a list needs no check where products alone use the element. Everything else tells the two apart.
class Vector {
  constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
}
class Matrix {
  constructor() { this.elements = [1, 0, 0, 0, 1, 0, 0, 0, 1]; this.kept = undefined; }
  multiply(a, b) {
    const ae = a.elements, be = b.elements, te = this.elements;
    const a11 = ae[0], a12 = ae[1], a13 = ae[2], a21 = ae[3], a22 = ae[4], a23 = ae[5];
    const b11 = be[0], b12 = be[1], b21 = be[3], b22 = be[4], b31 = be[6], b32 = be[7];
    te[0] = a11 * b11 + a12 * b21 + a13 * b31; te[1] = a11 * b12 + a12 * b22 + a13 * b32;
    te[3] = a21 * b11 + a22 * b21 + a23 * b31; te[4] = a21 * b12 + a22 * b22 + a23 * b32;
    return this;
  }
  determinant() {
    const te = this.elements;
    const a = te[0], b = te[1], c = te[2], d = te[3], e = te[4], f = te[5], g = te[6], h = te[7], i = te[8];
    return a * e * i - a * f * h - b * d * i + b * f * g + c * d * h - c * e * g;
  }
  apply(v) {
    const x = v.x, y = v.y, z = v.z, e = this.elements;
    v.x = e[0] * x + e[3] * y + e[6] * z; v.y = e[1] * x + e[4] * y + e[7] * z; v.z = e[2] * x + e[5] * y + e[8];
    return v;
  }
  difference(m) { const a = this.elements, b = m.elements; return (a[0] - b[0]) * (a[1] - b[1]) + a[2] / b[2] - a[3] * b[3]; }
  // Uses that tell undefined from NaN.
  stored(m) { const te = this.elements, e = m.elements; te[0] = e[0] * 2; te[1] = e[1] * e[2] - e[0] * e[3]; this.kept = e[2]; return this.kept; }
  text(m) { const e = m.elements; const x = e[1], y = e[2]; return x * y * 2 + " " + x + " " + (y * x - e[4] * e[5]); }
  kind(m) { const e = m.elements; const x = e[1], y = e[2], z = e[0] * x - y * x; return typeof x + " " + (y === undefined) + " " + (x ?? "none") + " " + z; }
  sum(m, n) { const e = m.elements, x = e[1], y = e[2]; return e[0] * e[3] - e[4] * e[5] + (x + n) + (n + y); }
  passed(m) { const e = m.elements, x = e[1]; return this.hand(x * e[0] - e[3] * e[4], x, e[2]); }
  hand(...values) { return values.map(show).join(); }
  joined(m, some) { const e = m.elements, x = e[1], y = e[2]; const z = x * y - e[0] * e[3] * e[4]; return some ? x : z; }
}
globalThis.KEPT = [Vector, Matrix];
const show = v => typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "bigint" ? v + "n" : String(v);
const list = l => { let s = ""; for (let i = 0; i < l.length; i++) s += (Object.hasOwn(l, i) ? show(l[i]) : "hole") + " "; return s; };
const usual = [];
for (let i = 0; i < 30; i++) { const m = new Matrix(); m.elements = m.elements.map((x, j) => x + j * 0.25 + i); usual.push(m); }
function holes(which) {
  const m = new Matrix(); m.elements = m.elements.map((x, j) => x * 2 + j * 0.5 + 0.25);
  for (const i of which) delete m.elements[i];
  return m;
}
function short() { const m = new Matrix(); m.elements = [1.5, 2.5]; m.elements.length = 9; return m; }
const lines = [];
function run(ms, ns, vs, n) {
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i], o = ns[i], t = new Matrix(), log = [];
    try { log.push(list(t.multiply(m, o).elements)); } catch (e) { log.push(e.name); }
    try { log.push(show(m.determinant())); } catch (e) { log.push(e.name); }
    try { const v = m.apply(vs[i]); log.push(show(v.x), show(v.y), show(v.z)); } catch (e) { log.push(e.name); }
    try { log.push(show(m.difference(o))); } catch (e) { log.push(e.name); }
    try { log.push(show(t.stored(m)), list(t.elements), show(t.kept)); } catch (e) { log.push(e.name); }
    try { log.push(t.text(m)); } catch (e) { log.push(e.name); }
    try { log.push(t.kind(m)); } catch (e) { log.push(e.name); }
    try { log.push(show(t.sum(m, n))); } catch (e) { log.push(e.name); }
    try { log.push(t.passed(m)); } catch (e) { log.push(e.name); }
    try { log.push(show(t.joined(m, i & 1)), show(t.joined(m, !(i & 1)))); } catch (e) { log.push(e.name); }
    lines.push(log.join("; "));
  }
}
run(usual, usual.slice().reverse(), usual.map((_, i) => new Vector(i, i * 0.5, -i)), 2);
const odd = [holes([0]), holes([1]), holes([2]), holes([3, 4]), holes([1, 2]), holes([0, 1, 2, 3, 4, 5, 6, 7, 8]), short(), usual[3]];
run(odd, odd.slice().reverse(), odd.map(() => new Vector(1.5, 2.5, 3.5)), 2);
run(odd, usual, odd.map(() => new Vector(1, 0, 2)), "s");
run(odd, usual, odd.map(() => new Vector(1n, 2, 3)), 3n);
run(odd, usual, odd.map(() => new Vector({ valueOf() { lines.push("asked"); return 2; } }, undefined, "4")), { valueOf: () => 5 });
console.log(lines.join("\n"));
