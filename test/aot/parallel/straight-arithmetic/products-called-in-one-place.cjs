// A method that multiplies elements of an array is called where the only call of it stands in a loop: its code asks the array once.
// STATISTIC: StraightArmHoleChecksRemoved >= 9
class Matrix {
  constructor() { this.elements = [1, 0, 0, 0, 1, 0, 0, 0, 1]; }
  determinant() {
    const te = this.elements;
    const a = te[0], b = te[1], c = te[2], d = te[3], e = te[4], f = te[5], g = te[6], h = te[7], i = te[8];
    return a * e * i - a * f * h - b * d * i + b * f * g + c * d * h - c * e * g;
  }
}
globalThis.KEPT = [Matrix];
const show = value => typeof value === "number" ? (Object.is(value, -0) ? "-0" : String(value)) : typeof value === "bigint" ? value + "n" : String(value);
const lines = [];
function run(matrices) {
  for (let i = 0; i < matrices.length; i++) {
    const m = matrices[i], log = [];
    try { log.push(show(m.determinant())); } catch (error) { log.push(error.constructor.name); }
    lines.push(log.join("; "));
  }
}
const usual = [];
for (let i = 0; i < 20; i++) { const m = new Matrix(); m.elements = m.elements.map((x, j) => x + j * 0.25 + i); usual.push(m); }
run(usual);
delete usual[3].elements[4];
usual[4].elements[0] = "2";
usual[5].elements[8] = { valueOf() { lines.push("asked"); return 3; } };
usual[6].elements[1] = 4n;
usual[7].elements.length = 5;
run(usual);
console.log(lines.join("\n"));
