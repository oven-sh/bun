function sum(tag, x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; return s; }
console.log([Buffer.from([1, 2, 3]), Buffer.from([4])].map(b => sum("t", b)).join(), [Buffer.from([5])].reduce((a, b) => a + sum("u", b), 0));
