const o = { m(a) { return this.k + a; } };
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += o.m.call({ k: 1 }, i); return t; }
console.log(run(5));
