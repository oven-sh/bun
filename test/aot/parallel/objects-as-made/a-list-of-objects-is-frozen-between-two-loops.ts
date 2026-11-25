type Row = { id: number; name: string };
const rows: Row[] = [];
for (let at = 0; at < 6; at++) rows.push({ id: at, name: "row" + at });
function names(): string { let text = ""; for (let at = 0; at < rows.length; at++) text += rows[at].name + rows[at].id; return text; }
let all = names();
Object.freeze(rows);
all += "|" + names() + "|" + rows.map(row => row.id).join() + "|" + rows.find(row => row.id === 4)!.name + "|" + rows.findIndex(row => row.name === "row2");
try { rows.push({ id: 9, name: "late" }); all += "|pushed"; } catch (error) { all += "|" + (error as Error).constructor.name; }
all += "|" + rows.length + "|" + names().length;
console.log(all);
