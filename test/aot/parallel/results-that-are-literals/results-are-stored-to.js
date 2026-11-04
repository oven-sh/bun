function id(x) { return x; }
const p = id({ n: 1 }), q = id({ m: 2 });
p.m = "late"; q.n = 7; p.n += 1; delete q.m; q.z = [1];
console.log(JSON.stringify(p), JSON.stringify(q), p.m.length, q.m, q.z.length);
