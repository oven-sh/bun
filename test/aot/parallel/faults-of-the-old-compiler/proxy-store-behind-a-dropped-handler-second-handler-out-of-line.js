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
let asked = 0, accepted = 0;
const refuse = (t, k, d) => { asked++; return false; };
function put2(o, n) {
  switch (n) {
    case 0: o.defineProperty = refuse; break; case 1: o.b1 = 1; break; case 2: o.b2 = 1; break; case 3: o.b3 = 1; break;
    case 4: o.b4 = 1; break; case 5: o.b5 = 1; break; default: o.b6 = 1;
  }
}
function make2(r) {
  const o = {}, pool = [0, 1, 2, 3, 4, 5, 6];
  for (let n = 7; n > 0; n--) { put2(o, pool.splice(r % n, 1)[0]); r = Math.floor(r / n); }
  return o;
}
for (let r = 0; r < 5030; r++) sum += make2(r).b1;
const kept = [];
for (let i = 0; i < 5; i++) {
  Reflect.set(new Proxy({ x: 0 }, make(5039 - i)), 'x', 1);
  Bun.gc(true);
  kept.push(make2(5039 - i)); // an order that nobody has made yet: a Structure of its own
  if (Reflect.set(new Proxy({ x: 0 }, kept[i]), 'x', 1)) accepted++;
}
console.log('stores 5, refused', 5 - accepted, 'asked', asked, sum);
