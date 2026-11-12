"use strict";
const keys = JSON.parse('["a","b","c","d","e","g","h"]');
class Ring { constructor(n) { this.n = n; } }
const T = {
  count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; },
  a(r, v) { r.a = v; return r.n; }, b(r, v) { r.b = v; return r.n; }, c(r, v) { r.c = v; return r.n; }, d(r, v) { r.d = v; return r.n; }, e(r, v) { r.e = v; return r.n; }, g(r, v) { r.g = v; return r.n; }, h(r, v) { r.h = v; return r.n; },
};
function total(list) { let s = 0; for (const r of list) for (const name of Object.keys(r)) s += typeof r[name] === "number" ? r[name] : r[name].inner; return s; }
const old = []; for (let i = 0; i < 2000; i++) old.push(new Ring(i));
Bun.gc(true); Bun.gc(true);
for (let step = 0; step < keys.length; step++) {
  for (let i = 0; i < old.length; i++) if ((i + step) % 3) T[keys[(step * 3 + i) % keys.length]](old[i], { inner: i + step });
  for (let i = 0; i < 30000; i++) T[keys[step]](new Ring(i), { inner: i });
  Bun.gc(step % 2 === 0);
  console.log(step, total(old), Object.keys(old[step]).join(), Object.keys(old[1999 - step]).join());
}
