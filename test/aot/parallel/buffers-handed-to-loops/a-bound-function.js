function sum(tag, x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; return s; } const bound = sum.bind(null, "t");
console.log(bound(Buffer.from([1, 2, 3])), sum.call(null, "u", Buffer.from([4])));
