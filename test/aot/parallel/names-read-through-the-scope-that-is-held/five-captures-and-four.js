function many(a, b, c, d) { let at = 0; return () => (at += a + b + c + d); }
function few(a, b, c) { let at = 0; return () => (at += a + b + c); }
const m = many(1, 2, 3, 4), f = few(1, 2, 3);
console.log(m(), m(), f(), f());
function later(a, b, c, d) {
  let at = 0;
  const early = () => { at++; return [a, b, c, d, tail].join(); };
  let seen; try { seen = early(); } catch (e) { seen = e.constructor.name; }
  const tail = "t";
  return seen + "|" + early() + "|" + at;
}
console.log(later(1, 2, 3, 4));
