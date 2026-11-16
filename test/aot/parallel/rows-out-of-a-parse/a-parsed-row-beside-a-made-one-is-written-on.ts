// A row that the program makes stands beside rows out of a parse, and the parsed rows are written on: another type, a delete, a new name, an accessor, a freeze, another prototype.
interface Row { id: number; name: string }
const made: Row = { id: 0, name: "made" };
const rows: Row[] = JSON.parse('[{"id":1,"name":"a"},{"id":2,"name":"b"},{"id":3,"name":"c"},{"id":4,"name":"d"},{"id":5,"name":"e"},{"id":6,"name":"f"}]');
function one(row: Row): string { return typeof row.id + String(row.id) + String(row.name); }
function sum(all: Row[]): string { let s = one(made); for (const row of all) s += one(row); return s; }
const loose: any[] = rows; const told: string[] = [sum(rows)];
loose[0].id = "text"; told.push(sum(rows));
delete loose[1].name; told.push(sum(rows));
loose[2].more = 1; told.push(sum(rows) + Object.keys(rows[2]).join());
Object.defineProperty(loose[3], "id", { get() { return 44; } }); told.push(sum(rows));
Object.freeze(loose[4]); try { loose[4].id = 9; } catch {} told.push(sum(rows));
Object.setPrototypeOf(loose[5], { get extra() { return "above"; } }); told.push(sum(rows) + loose[5].extra);
console.log(told.join(" "));
