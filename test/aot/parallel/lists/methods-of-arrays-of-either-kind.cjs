// STATISTIC: ArrayAccessesSplitByKind >= 4
// A built-in method is called on an array in some calls and on a typed array in others.
"use strict";
const out = [];
function list(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push((i * 37) & 63);
  return a;
}
function total(h, t) {
  return h.reduce((a, x) => (a + x) | 0, t);
}
function where(h, t) {
  return h.indexOf(t) * 100 + h.lastIndexOf(t) + (h.includes(t + 1) ? 0.5 : 0);
}
function next(h, t) {
  return h.map(x => (x + t) & 31);
}
function walk(h, t) {
  let s = t;
  h.forEach((x, i) => {
    s = (s + x * i) | 0;
  });
  return s + (h.every(x => x >= 0) ? 1 : 2) + (h.some(x => x > 60) ? 10 : 20) + h.findIndex(x => x === 5);
}
function change(h, t) {
  h.fill(t & 63, 1, 3);
  h.reverse();
  return h.slice(1, 5).join("-") + h.at(-1);
}
const a = list(16), b = new Int32Array(list(16));
let s = 0;
for (let t = 0; t < 40; t++) {
  const h = t & 1 ? b : a;
  s = (s + h.reduce((x, y) => (x + y) | 0, t) + h.indexOf(t) + h.lastIndexOf(t & 7)) | 0;
  if (h.includes(t & 31)) s += h.map(x => (x + t) & 31)[3];
  h.forEach(x => {
    s = (s ^ x) | 0;
  });
  if (t % 5 === 0) h.fill(t & 63, 1, 3);
  if (t % 7 === 0) h.reverse();
  out.push(s + " " + total(h, t) + " " + where(h, t) + " " + walk(h, t) + " " + change(h, t) + " " + String(next(h, t)));
}
out.push(a.join(), b.join());
for (const line of out) console.log(line);
