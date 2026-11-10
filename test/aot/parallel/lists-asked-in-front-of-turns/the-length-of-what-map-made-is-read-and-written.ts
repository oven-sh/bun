interface Row { id: number; title: string; priceCents: number; stock: number }
const count = Number(process.argv[2] ?? 12);
const rows: Row[] = [];
function fill(n: number) { rows.length = 0; for (let i = 0; i < n; i++) rows.push({ id: i, title: "row " + i, priceCents: 100 + i, stock: i % 3 }); }
const tell = (list: any) => JSON.stringify(Array.from({ length: list.length }, (_, i) => (i in list ? list[i] : "HOLE"))) + " length " + list.length;
function listed() { const made = rows.map(row => ({ id: row.id })); const before = made.length; made.push({ id: -1 }); made.length += 2; return [before, made.length, tell(made)].join(" "); }
const table = { listed };
for (let k = 0; k < 3; k++) { fill(count); console.log(table[process.argv.length > 99 ? ("other" as "listed") : "listed"]()); }
