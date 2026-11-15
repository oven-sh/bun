class Acc { static sum(tag, x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; return s; } }
console.log(Acc.sum("t", Buffer.from([1, 2, 3])));
