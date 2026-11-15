// An object with a field that is added late is carried round a loop and replaced in a try.
const out = [];
function keysInTry() {
  function make(k) { const o = { a: 0.5 }; o.c = k; return o; }
  let o = make(0);
  for (let k = 0; k < 5; k++) { try { if (k & 1) o = make(k); out.push(Object.keys(o).join("/")); } catch {} }
  return o.c;
}
function sums(n) {
  function make(x, y) { const o = { x }; o.y = y; return o; }
  let p = make(0, 1);
  for (let i = 0; i < n; i++) p = make(p.x + i, p.y + 0.5);
  return p.x + p.y;
}
class Late { constructor(x) { this.x = x; } static of(x, y) { const l = new Late(x); l.y = y; return l; } }
function ofClass(n) { let p = Late.of(0, 1); for (let i = 0; i < n; i++) { p = Late.of(p.y, p.x + i); if (i === 5) out.push(JSON.stringify(p)); } return p.x + p.y; }
for (let round = 0; round < 3; round++) console.log(keysInTry(), sums(0), sums(9), ofClass(0), ofClass(9), out.splice(0).join());
