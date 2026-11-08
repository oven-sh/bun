function each(list, f) { for (let i = 0; i < list.length; i++) f(list[i], i); }
const rows = []; for (let i = 0; i < 12; i++) rows.push({ id: i, name: "n" + i });
function total(list) { let sum = 0; let box = { n: 1 }; each(list, (row, i) => { if (i === 4) Bun.gc(true); box = { n: box.n + row.id }; sum += box.n; }); return sum + box.n; }
let all = 0; for (let t = 0; t < 12; t++) all += total(rows); console.log(all);
