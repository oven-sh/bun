"use strict";
const log = [];

const first = (() => { const l = [1.5, 2.5, 3.5]; Object.defineProperty(l, 0, { get() { l.length = 1; return 6; }, configurable: true }); return l; })();
const other = (() => { const l = [1.5, 2.5, 3.5]; Object.defineProperty(l, 0, { get() { l.length = 1; return 6; }, configurable: true }); return l; })();
const second = [0.5, 0.25, 4];
function f(a, b, t) {
  let s = t & 1;
  let last = "";
  for (let k = 0; k < 40; k++) {
    const [x, y] = a; last = x + "|" + y;
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
