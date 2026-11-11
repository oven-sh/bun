function sum(b, passes) { let s = 0; for (let t = 0; t < passes; t++) for (let i = 0; i < b.length; i++) s = (s + b[i]) | 0; return s; }
console.log(sum(Buffer.alloc(4096, 7), 3), sum(Buffer.from("hello"), 2), sum(Buffer.alloc(0), 5), sum(Buffer.allocUnsafe(8).fill(1).subarray(2, 5), 4));
