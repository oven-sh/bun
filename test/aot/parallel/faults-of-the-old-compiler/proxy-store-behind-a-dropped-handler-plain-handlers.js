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
const kept = [];
for (let i = 0; i < 40; i++) {
  Reflect.set(new Proxy({ x: 0 }, JSON.parse('{"k' + i + '":1,"l' + i + '":2}')), 'x', 1); // an object of the host's, with Structures of its own, dropped at once
  Bun.gc(true);
  const handler = JSON.parse('{"c' + i + '":1}');
  handler.defineProperty = refuse;
  kept.push(handler);
  if (Reflect.set(new Proxy({ x: 0 }, handler), 'x', 1)) accepted++;
}
console.log('stores 40, refused', 40 - accepted, 'asked', asked, sum);
