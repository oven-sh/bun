function sum(tag, x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; return s; }
function run(f) { return f("t", Buffer.from([1, 2, 3])); }
console.log(run(sum));
