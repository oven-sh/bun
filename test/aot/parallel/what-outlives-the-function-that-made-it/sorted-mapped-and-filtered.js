function run(n) { const list = []; for (let i = 0; i < n; i++) list.push({ v: (i * 7) % 5 }); const sorted = list.slice().sort((a, b) => a.v - b.v); return [sorted.filter(o => o.v > 1), list.map(o => ({ w: o })), sorted.find(o => o.v === 3)]; }
const [big, wrapped, three] = run(5);
console.log(big.map(o => o.v).join(), wrapped[1].w.v, three.v);
