function add(a) { return this.k + a; }
function run(n) { let t = 0; const self = { k: 1 }; for (let i = 0; i < n; i++) t += add.call(self, i) + add.apply(self, [i]); return t; }
console.log(run(5));
