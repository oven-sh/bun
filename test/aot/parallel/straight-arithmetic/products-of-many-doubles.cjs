// STATISTIC on x64: SpilledFirstOperandsRead >= 8
// Thirty-two doubles are more than the registers hold. A product whose first operand was spilled reads it in memory.
class Matrix {
  constructor() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  multiply(a, b) {
    const ae = a.elements, be = b.elements, te = this.elements;
    const a00 = ae[0], a01 = ae[4], a02 = ae[8], a03 = ae[12];
    const a10 = ae[1], a11 = ae[5], a12 = ae[9], a13 = ae[13];
    const a20 = ae[2], a21 = ae[6], a22 = ae[10], a23 = ae[14];
    const a30 = ae[3], a31 = ae[7], a32 = ae[11], a33 = ae[15];
    const b00 = be[0], b01 = be[4], b02 = be[8], b03 = be[12];
    const b10 = be[1], b11 = be[5], b12 = be[9], b13 = be[13];
    const b20 = be[2], b21 = be[6], b22 = be[10], b23 = be[14];
    const b30 = be[3], b31 = be[7], b32 = be[11], b33 = be[15];
    te[0] = a00 * b00 + a01 * b10 + a02 * b20 + a03 * b30;
    te[4] = a00 * b01 + a01 * b11 + a02 * b21 + a03 * b31;
    te[8] = a00 * b02 + a01 * b12 + a02 * b22 + a03 * b32;
    te[12] = a00 * b03 + a01 * b13 + a02 * b23 + a03 * b33;
    te[1] = a10 * b00 + a11 * b10 + a12 * b20 + a13 * b30;
    te[5] = a10 * b01 + a11 * b11 + a12 * b21 + a13 * b31;
    te[9] = a10 * b02 + a11 * b12 + a12 * b22 + a13 * b32;
    te[13] = a10 * b03 + a11 * b13 + a12 * b23 + a13 * b33;
    te[2] = a20 * b00 + a21 * b10 + a22 * b20 + a23 * b30;
    te[6] = a20 * b01 + a21 * b11 + a22 * b21 + a23 * b31;
    te[10] = a20 * b02 + a21 * b12 + a22 * b22 + a23 * b32;
    te[14] = a20 * b03 + a21 * b13 + a22 * b23 + a23 * b33;
    te[3] = a30 * b00 + a31 * b10 + a32 * b20 + a33 * b30;
    te[7] = a30 * b01 + a31 * b11 + a32 * b21 + a33 * b31;
    te[11] = a30 * b02 + a31 * b12 + a32 * b22 + a33 * b32;
    te[15] = a30 * b03 + a31 * b13 + a32 * b23 + a33 * b33;
    return this;
  }
  mixed(m, s) {
    const e = m.elements, te = this.elements;
    const x0 = e[0], x1 = e[1], x2 = e[2], x3 = e[3], x4 = e[4], x5 = e[5], x6 = e[6], x7 = e[7], x8 = e[8], x9 = e[9], x10 = e[10], x11 = e[11], x12 = e[12], x13 = e[13], x14 = e[14], x15 = e[15];
    const y = x0 * x3 + x1 * x10 + x2 * x1 + x3 * x8 + x4 * x15 + x5 * x6 + x6 * x13 + x7 * x4 + x8 * x11 + x9 * x2 + x10 * x9 + x11 * x0 + x12 * x7 + x13 * x14 + x14 * x5 + x15 * x12;
    const z = (x0 + x2) - (x2 + x12) - (x4 + x6) - (x6 + x0) - (x8 + x10) - (x10 + x4) - (x12 + x14) - (x14 + x8);
    te[0] = y * s; te[1] = z / (x0 + x1 * x15); te[2] = (y - z) * (x2 + x13); te[3] = x4 * x5 * x6 * x7 * x8 * x9 * x10 * x11;
    return y * z - x3 * x12;
  }
}
globalThis.KEPT = Matrix;
const show = v => Object.is(v, -0) ? "-0" : String(v);
const all = [];
for (let i = 0; i < 24; i++) { const m = new Matrix(); m.elements = m.elements.map((x, j) => i % 6 === 5 ? (x + j) * 4 : x + Math.sin(i * 16 + j) * 3); all.push(m); }
all[3].elements[5] = NaN; all[7].elements[2] = -0; all[9].elements[9] = Infinity; all[11].elements[0] = 1e308; all[13].elements[15] = 5e-324; delete all[17].elements[6]; all[19].elements[4] = "4"; all[21].elements.length = 9;
const lines = [];
function run(list) {
  for (let i = 0; i < list.length; i++) {
    const t = new Matrix();
    try { lines.push(t.multiply(list[i], list[(i * 5 + 1) % list.length]).elements.map(show).join(" ")); } catch (e) { lines.push(e.name); }
    try { lines.push(show(t.mixed(list[i], i - 3)) + " " + t.elements.map(show).join(" ")); } catch (e) { lines.push(e.name); }
  }
}
run(all); run(all);
all[2].elements[3] = 5n;
run(all.slice(0, 4));
console.log(lines.join("\n"));
