interface Row { id: number; title: string; priceCents: number; stock: number }
const count = Number(process.argv[2] ?? 12);
const rows: Row[] = [];
function fill(n: number) { rows.length = 0; for (let i = 0; i < n; i++) rows.push({ id: i, title: "row " + i, priceCents: 100 + i, stock: i % 3 }); }
const tell = (list: any) => JSON.stringify(Array.from({ length: list.length }, (_, i) => (i in list ? list[i] : "HOLE"))) + " length " + list.length;
function listed() { return rows.map(row => ({ id: row.id, title: row.title, priceCents: row.priceCents, inStock: row.stock > 0 })); }
const table = { listed };
fill(count * 4); let sum = 0; const kept: any[] = [];
for (let k = 0; k < 60000; k++) { const made = table[process.argv.length > 99 ? ("other" as "listed") : "listed"](); if (k % 5000 === 0) kept.push(made); sum += made[k % made.length].priceCents + made.length; }
Bun.gc(true);
console.log(sum, kept.length, kept.every(made => made.every((one: any, i: number) => one.id === i && one.title === "row " + i)));
