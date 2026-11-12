// row[j] += a[i][k] * b[k][j]: the rows summed into are made here and hold numbers; the factors come out of JSON.parse, are made here, hold holes, texts of digits, null.
"use strict";
function multiply(a, b, n) { const c = []; for (let i = 0; i < n; i++) { const row = new Array(n).fill(0); for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) row[j] += a[i][k] * b[k][j]; c.push(row); } return c; }
const N = 4;
const parsed = JSON.parse("[" + Array.from({ length: N }, (_, i) => "[" + Array.from({ length: N }, (_, j) => i + j / 2).join() + "]").join() + "]");
const whole = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => i * N + j));
const odd = [[1, , 3, 4], ["2", "3", null, true], [0.5, -0, 1e308, 1e308], [undefined, 1, 2, 3]];
const said = [];
for (let round = 0; round < 60; round++)
  for (const [a, b] of [[parsed, parsed], [whole, whole], [parsed, whole], [odd, whole], [whole, odd], [odd, odd]]) { const c = multiply(a, b, N); if (round === 59) said.push(c.map(row => row.join()).join(";")); }
console.log(said.join(" | "));
