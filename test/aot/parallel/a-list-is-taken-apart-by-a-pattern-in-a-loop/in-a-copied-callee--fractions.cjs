"use strict";
const log = [];
function dot(a, b) { const [x, y, z] = a, [u, v, w] = b; return x * u + y * v + z * w; }
const first = [1.5, 2.5, 3.5];
const other = [1.5, 2.5, 3.5];
const second = [0.5, 0.25, 4];
function f(a, b, t) {
  let s = t & 1;
  let last = "";
  for (let k = 0; k < 40; k++) {
    s = s + dot(a, b);
  }
  return s + "|" + last;
}
const n = 6;
const out = [];
for (let t = 0; t < n * 20; t++) {
  try {
    out.push(f(t % 1 === 1 - 1 ? other : first, second, t));
  } catch (error) {
    out.push(error.constructor.name);
  }
}
console.log(out[0], out[1], out[2], out[out.length - 1], log.length, log.slice(0, 6).join());
