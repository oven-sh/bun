function each(list, f) { for (let i = 0; i < list.length; i++) f(list[i], i); }
const rows = []; for (let i = 0; i < 12; i++) rows.push({ id: i, name: "n" + i });
async function total(list) { let sum = 0; each(list, row => { sum += row.id; }); await null; each(list, row => { sum += row.id * 2; }); const half = sum; await 0; each(list, row => { sum -= 1; }); return [half, sum]; }
console.log((await Promise.all([total(rows), total(rows.slice(3)), total([])])).join("|"));
