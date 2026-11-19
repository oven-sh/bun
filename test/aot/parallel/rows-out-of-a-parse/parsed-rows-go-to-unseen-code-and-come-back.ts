// Parsed rows go to code that nobody has seen, which spoils them, and come back.
interface Row { id: number; name: string }
const rows: Row[] = JSON.parse('[{"id":1,"name":"a"},{"id":2,"name":"b"},{"id":3,"name":"c"},{"id":4,"name":"d"}]');
const spoil = new Function("rows", "rows[1].id = 'spoiled'; delete rows[2].id; rows[3].late = 1; return rows;");
function sum(all: Row[]): string { let s = ""; for (const row of all) s += typeof row.id + String(row.id) + row.name; return s; }
const before = sum(rows); const back: Row[] = spoil(rows);
console.log(before, sum(back), sum(rows), JSON.stringify(rows));
