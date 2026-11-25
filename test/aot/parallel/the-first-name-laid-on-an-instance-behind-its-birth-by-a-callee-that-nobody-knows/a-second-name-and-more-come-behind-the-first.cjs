"use strict";
const k = JSON.parse('"lay"'), more = JSON.parse('"more"'), other = JSON.parse('"other"');
class Ring { constructor(n) { this.n = n; } }
const T = {
  count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; },
  lay(r, v) { r.a = v; return r; },
  more(r, v) { r.b = v; r.c = v + 1; r.d = "d" + v; r.e = [v]; r.g = v / 2; return r; },
  other(r, v) { r.g = v; return r; },
};
const lines = [];
for (let i = 0; i < 40; i++) {
  const first = T[k](new Ring(i), i), both = T[more](T[k](new Ring(i), i), i), turned = T[k](T[more](new Ring(i), i), i), last = T[k](T[other](new Ring(i), i), i);
  if (i % 13 === 0) lines.push(JSON.stringify([first, both, turned, last]), Object.keys(turned).join(), Object.keys(last).join());
}
console.log(lines.join("\n"));
const r = T[k](new Ring(1), 1); delete r.a; console.log(JSON.stringify(r), "a" in r); T[k](r, 2); console.log(JSON.stringify(r)); T[more](r, 3); delete r.c; T[k](r, 4); console.log(JSON.stringify(r), Object.keys(r).join());
const s = new Ring(2); s.extra = 1; s["x-" + s.n] = 2; T[k](s, 5); console.log(JSON.stringify(s));
