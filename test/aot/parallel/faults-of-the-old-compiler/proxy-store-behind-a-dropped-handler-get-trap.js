function put(o, n) {
  switch (n) {
    case 0: o.a0 = 1; break; case 1: o.a1 = 1; break; case 2: o.a2 = 1; break; case 3: o.a3 = 1; break;
    case 4: o.a4 = 1; break; case 5: o.a5 = 1; break; default: o.a6 = 1;
  }
}
function make(r) { // the r-th of the 5,040 orders of seven keys
  const o = {}, pool = [0, 1, 2, 3, 4, 5, 6];
  for (let n = 7; n > 0; n--) { put(o, pool.splice(r % n, 1)[0]); r = Math.floor(r / n); }
  return o;
}
let sum = 0;
for (let r = 0; r < 5040; r++) sum += make(r).a0;
let asked = 0; const seen = [];
const trap = (t, k) => { asked++; return "trapped"; };
function fresh(i) {
  switch (i) {
    case 0: return { c0: 1, get: trap };
    case 1: return { c1: 1, get: trap };
    case 2: return { c2: 1, get: trap };
    case 3: return { c3: 1, get: trap };
    default: return { c4: 1, get: trap };
  }
}
const kept = [];
for (let i = 0; i < 5; i++) {
  { const p = new Proxy({ x: 0 }, make(5039 - i)); seen.push(String(p.x)); } // a handler without traps, dropped at once
  Bun.gc(true);
  kept.push(fresh(i));
  { const p = new Proxy({ x: 0 }, kept[i]); seen.push(String(p.x)); }
}
console.log(seen.join(), 'asked', asked, sum);
