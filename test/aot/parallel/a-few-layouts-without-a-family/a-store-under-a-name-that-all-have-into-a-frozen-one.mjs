function one(i) { return { v: i, a: 1 }; }
function two(i) { return { v: i, b: 2, c: 3 }; }
function three(i) { return { v: i, d: 4, e: 5, f: 6 }; }
function store(i) {
  let work = 0;
  for (let k = 0; k < 2; k++) work = (work + k) | 0;
  const o = i % 3 === 0 ? one(i) : i % 3 === 1 ? two(i) : three(i);
  if (i % 4 === 0) Object.freeze(o);
  try { o.v = 100 + i; } catch (e) { work += e.name === "TypeError" ? 1000 : 9; }
  return o.v + work;
}
let total = 0;
for (let i = 0; i < 200; i++) total += store(i);
console.log(total);
