'use strict';
const size = 6;
const left = JSON.parse('[' + Array.from({ length: size }, (_, r) => '[' + Array.from({ length: size }, (_, c) => r * 1.5 + c).join() + ']').join() + ']');
const right = JSON.parse('[' + Array.from({ length: size }, (_, r) => '[' + Array.from({ length: size }, (_, c) => (r === c ? 2 : 0.25)).join() + ']').join() + ']');
function product(a, b) {
  const out = [];
  for (let r = 0; r < a.length; r++) {
    const row = [];
    for (let c = 0; c < b[0].length; c++) {
      let sum = 0;
      for (let k = 0; k < b.length; k++) sum += a[r][k] * b[k][c];
      row.push(sum);
    }
    out.push(row);
  }
  return out;
}
let trace = 0;
for (let t = 0; t < 300; t++) { const p = product(left, right); for (let i = 0; i < size; i++) trace = (trace + p[i][i]) % 1000003; }
const holed = JSON.parse(JSON.stringify(left)); delete holed[2][3];
const texts = JSON.parse(JSON.stringify(left)); texts[1][1] = "7";
const short = JSON.parse(JSON.stringify(right)); short[4].length = 2;
console.log(trace, product(holed, right)[2].join(), product(texts, right)[1].join(), product(left, short)[0].join());
