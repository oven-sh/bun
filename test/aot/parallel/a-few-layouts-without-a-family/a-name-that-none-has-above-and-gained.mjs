const names = JSON.parse('["q"]');
function one(i) { return { v: i, a: 1 }; }
function two(i) { return { v: i, b: 2, c: 3 }; }
function three(i) { return { v: i, d: 4, e: 5, f: 6 }; }
function lacks(i) {
  let work = 0;
  for (let k = 0; k < 2; k++) work = (work + k) | 0;
  const o = i % 3 === 0 ? one(i) : i % 3 === 1 ? two(i) : three(i);
  if (i % 5 === 0) Object.setPrototypeOf(o, { q: 7 });
  if (i % 7 === 3) o[names[0]] = 9;
  return (o.q === undefined ? 1 : 0) + work - 1;
}
let total = 0;
for (let i = 0; i < 200; i++) total += lacks(i);
console.log(total);
