"use strict";
const keys = JSON.parse('["up","down","odd","even","inner","outer"]');
class Ring { constructor(n) { this.n = n; } }
const T = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; },
  up(r, v) { r.a = v + 0; r.b = v + 1; r.c = v + 2; r.d = v + 3; r.e = v + 4; r.f = v + 5; r.g = v + 6; r.h = v + 7; r.i = v + 8; r.j = v + 9; r.k = v + 10; r.l = v + 11; r.m = v + 12; r.n = v + 13; r.o = v + 14; r.p = v + 15; return r.n < 0 ? null : r; },
  down(r, v) { r.p = v + 15; r.o = v + 14; r.n = v + 13; r.m = v + 12; r.l = v + 11; r.k = v + 10; r.j = v + 9; r.i = v + 8; r.h = v + 7; r.g = v + 6; r.f = v + 5; r.e = v + 4; r.d = v + 3; r.c = v + 2; r.b = v + 1; r.a = v + 0; return r.n < 0 ? null : r; },
  odd(r, v) { r.a = v + 0; r.c = v + 2; r.e = v + 4; r.g = v + 6; r.i = v + 8; r.k = v + 10; r.m = v + 12; r.o = v + 14; return r.n < 0 ? null : r; },
  even(r, v) { r.b = v + 1; r.d = v + 3; r.f = v + 5; r.h = v + 7; r.j = v + 9; r.l = v + 11; r.n = v + 13; r.p = v + 15; return r.n < 0 ? null : r; },
  inner(r, v) { r.f = v + 5; r.g = v + 6; r.h = v + 7; r.i = v + 8; r.j = v + 9; r.k = v + 10; return r.n < 0 ? null : r; },
  outer(r, v) { r.e = v + 4; r.d = v + 3; r.c = v + 2; r.b = v + 1; r.a = v + 0; r.l = v + 11; r.m = v + 12; r.n = v + 13; r.o = v + 14; r.p = v + 15; return r.n < 0 ? null : r; },
};
function show(r) { return Object.keys(r).join("") + ":" + Object.values(r).join(); }
const kept = [];
for (let i = 0; i < 300; i++) {
  const made = [T[keys[0]](new Ring(i), i), T[keys[1]](new Ring(i), i), T[keys[3]](T[keys[2]](new Ring(i), i), i * 2), T[keys[2]](T[keys[3]](new Ring(i), i), i * 2), T[keys[5]](T[keys[4]](new Ring(i), i), i * 3), T[keys[4]](T[keys[5]](new Ring(i), i), i * 3), T[keys[0]](T[keys[4]](new Ring(i), i), i * 4), T[keys[1]](T[keys[2]](new Ring(i), i), i * 5)];
  if (i % 97 === 0) for (const r of made) console.log(show(r));
  if (i % 3 === 0) kept.push(...made);
  if (i % 100 === 99) Bun.gc(true);
}
let sum = 0, letters = 0; for (const r of kept) { for (const name in r) { sum += r[name]; letters += name.length; } } console.log(kept.length, sum, letters);
