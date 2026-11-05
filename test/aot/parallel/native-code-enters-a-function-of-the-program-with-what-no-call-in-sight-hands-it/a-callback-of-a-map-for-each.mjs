function take(a, b) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return work === 1 ? a + b : 0; }
let total = 0;
for (let i = 0; i < 300; i++) total = (total + take(i, i)) | 0;
console.log(total);
new Map([["a", "b"]]).forEach((v, k) => console.log(take(k, v)));
new Map([["a", "b"]]).forEach(take);
