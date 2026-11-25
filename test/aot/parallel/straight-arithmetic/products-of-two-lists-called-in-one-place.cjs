// A method that multiplies elements of two arrays is copied into a loop that calls nothing else: each iteration asks both arrays together.
// STATISTIC: ArraysGuardedInIterations >= 2
class Matrix {
  constructor() { this.elements = [1, 0, 0, 0, 1, 0, 0, 0, 1]; }
  difference(m) { const a = this.elements, b = m.elements; return (a[0] - b[0]) * (a[1] - b[1]) + a[2] / b[2] - a[3] * b[3]; }
}
globalThis.KEPT = [Matrix];
function sum(matrices, others) {
  let total = 0;
  for (let i = 0; i < matrices.length; i++) total += matrices[i].difference(others[i]);
  return total;
}
const usual = [];
for (let i = 0; i < 20; i++) { const m = new Matrix(); m.elements = m.elements.map((x, j) => x + j * 0.25 + i); usual.push(m); }
const others = usual.slice().reverse();
const changes = [() => {}, () => delete usual[3].elements[2], () => usual[3].elements[2] = "2.5", () => usual[5].elements[0] = { valueOf() { return 3; } }, () => usual[6].elements.length = 2, () => usual[7].elements[3] = 4n];
for (const change of changes) {
  change();
  let total;
  try { total = String(sum(usual, others)); } catch (error) { total = error.constructor.name; }
  console.log(total);
}
