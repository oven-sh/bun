function make(seed) { return function sum(tag, x) { let s = seed; for (let i = 0; i < x.length; i++) s += x[i]; return s; }; }
console.log(make(1)("t", Buffer.from([1, 2, 3])), make(2)("u", Buffer.from([4])));
