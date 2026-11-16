interface Row { id: number; title: string; priceCents: number; stock: number }
const count = Number(process.argv[2] ?? 12);
const rows: Row[] = [];
function fill(n: number) { rows.length = 0; for (let i = 0; i < n; i++) rows.push({ id: i, title: "row " + i, priceCents: 100 + i, stock: i % 3 }); }
const tell = (list: any) => JSON.stringify(Array.from({ length: list.length }, (_, i) => (i in list ? list[i] : "HOLE"))) + " length " + list.length;
function listed() { return rows.map(row => ({ id: row.id })); }
const table = { listed };
for (const n of [count, count * 20000, count]) { fill(n); const made = table[process.argv.length > 99 ? ("other" as "listed") : "listed"](); made.push({ id: -1 }); console.log(made.length, JSON.stringify(made[0]), JSON.stringify(made[made.length - 2]), made.every((one, i) => one.id === i || i === n)); }
