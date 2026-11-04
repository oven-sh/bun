function add(a) { return this.k + a; }
function run(n) { let t = 0; const bound = add.bind({ k: 1 }); for (let i = 0; i < n; i++) t += bound(i); return t; }
console.log(run(5));
