"use strict";
const k = JSON.parse('"lay"');
class Ring { constructor(n) { this.n = n; } }
const T = {
  count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; },
  lay(r, v) { r.late = v; return r; },
};
function sumOf(list) { let s = 0; for (const r of list) s += r.n + (typeof r.late === "number" ? r.late : r.late.inner); return s + ":" + namesOf(list); }
function namesOf(list) { let s = 0; for (let i = 0; i < list.length; i += 7) s += Object.keys(list[i]).join().length + JSON.stringify(list[i]).length; return s; }
const kept = [];
for (let round = 0; round < 6; round++) {
  for (let i = 0; i < 20000; i++) { const r = T[k](new Ring(i), round % 2 ? { inner: i } : i); if (i % 16 === 0) kept.push(r); }
  Bun.gc(true);
  console.log(round, kept.length, sumOf(kept));
}
const old = []; for (let i = 0; i < 3000; i++) old.push(new Ring(i));
Bun.gc(true); Bun.gc(true);
for (let i = 0; i < old.length; i++) T[k](old[i], { inner: i * 2 });
for (let i = 0; i < 200000; i++) T[k](new Ring(i), { inner: i });
Bun.gc(false);
console.log(sumOf(old));
Bun.gc(true);
console.log(sumOf(old), sumOf(kept));
