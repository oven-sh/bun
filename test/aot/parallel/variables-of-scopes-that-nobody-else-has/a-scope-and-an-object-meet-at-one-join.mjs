function both(c, n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; let count = 0; const bump = () => { count += 1; }; let o; if (c) { count += 1; o = { a: n, b: 1 }; } else { count += 2; o = { a: n + 1, b: 2 }; } bump(); return o.a * 3 + o.b * 50 + count * 1000 + n * 7 + (n ^ 5) + (n & 3) + (n | 8) + work; }
const k = JSON.parse("4") | 0; let sum = 0; for (let i = 0; i < 300; i++) sum = (sum + both(i & 1, k)) | 0;
console.log(both(1, k), both(0, k), sum);
