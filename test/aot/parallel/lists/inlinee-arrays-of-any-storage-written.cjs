// Functions copied into a loop store int32s into an array of int32s: it keeps its storage.
"use strict";
const out = [];
function rotate(a, b) {
  return (a << b) | (a >>> (32 - b));
}
function quarter(x, a, b, c, d) {
  x[a] = (x[a] + x[b]) | 0;
  x[d] = rotate(x[d] ^ x[a], 16);
  x[c] = (x[c] + x[d]) | 0;
  x[b] = rotate(x[b] ^ x[c], 12);
}
function block(state) {
  const x = state.slice();
  for (let i = 0; i < 10; i++) {
    quarter(x, 0, 4, 8, 12);
    quarter(x, 1, 5, 9, 13);
    quarter(x, 2, 6, 10, 14);
    quarter(x, 3, 7, 11, 15);
    quarter(x, 0, 5, 10, 15);
    quarter(x, 1, 6, 11, 12);
    quarter(x, 2, 7, 8, 13);
    quarter(x, 3, 4, 9, 14);
  }
  return x;
}
function words(seed) {
  const list = [];
  for (let i = 0; i < 16; i++) list.push(Math.imul(i + seed, 0x9e3779b9) | 0);
  return list;
}
function scale(x) {
  for (let i = 0; i < x.length; i++) x[i] = x[i] * 0.5;
}
for (let round = 0; round < 6; round++) {
  const state = words(round);
  if (round === 2) scale(state);
  if (round === 3) state.length = 13;
  if (round === 4) delete state[5];
  const result = block(state);
  if (round === 5) result.push(0.25);
  out.push(result.map(x => (Object.is(x, -0) ? "-0" : String(x))).join());
}
for (const line of out) console.log(line);
