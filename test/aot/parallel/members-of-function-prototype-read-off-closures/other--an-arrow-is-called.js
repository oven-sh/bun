const f = (a) => a + 1;
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += f.call(null, i); return t; }
console.log(run(5));
