const m = new Map([["a", "value-of-a"], ["b", "value-of-b"]]), ks = ["a", "b"]; let n = 0;
for (let i = 0; i < 200000; i++) { const v = m.get(ks[i & 1]!)!; if (i % 50000 === 0) Bun.gc(true); n += v.length + v.charCodeAt(9); }
console.log(n);
