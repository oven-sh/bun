'use strict';
const a = new Float64Array(JSON.parse('[1.5,2.5,3.5]')), short = new Float64Array(JSON.parse('[4,5]')), long = new Float64Array(JSON.parse('[4,5,6]')), none = new Float64Array(0);
function add(o, a, b) { for (let i = 0; i < 20; i++) { o[0] = a[0] + b[0] + i; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; } return o.join(); }
function fold(o, a, b, turns) { let sum = 0; for (let i = 0; i < turns; i++) { sum += a[0] * b[1] + a[2] * b[2]; o[1] = sum; } return sum + ':' + o.join(); }
globalThis.kept = [add, fold];
for (let turn = 0; turn < 4; turn++) {
  const b = [short, long, none, a][turn];
  console.log(add(new Float64Array(3), a, b), add(new Float64Array(2), b, a), add(new Float64Array(0), b, b));
  console.log(fold(new Float64Array(3), a, b, 5), fold(new Float64Array(1), b, a, 3), fold(new Float64Array(2), a, b, 0));
}
