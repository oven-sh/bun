function id(x) { return x; }
function weigh(v) { let t = 0; for (const key in v) t += v[key]; return t; }
let total = 0;
for (let i = 0; i < 200; i++) total += weigh(id(i % 3 === 0 ? { a: i } : i % 3 === 1 ? { b: i, c: 1 } : { d: i, e: 2, f: 3 }));
console.log(total);
