// The rows' type is written over the parse through `any`. It says what `as Row[]` says: the parser makes the rows records of Row.
// COUNTER: ObjectsParsedIntoRecords >= 64
// COUNTER: ObjectsParsedIntoOrdinaryObjects <= 0
interface Row { id: number; name: string; score: number }
const text = "[" + Array.from({ length: 64 }, (_, i) => `{"id":${i},"name":"n${i}","score":${i * 0.5}}`).join() + "]";
const rows = JSON.parse(text) as any as Row[];
let sum = 0;
for (const row of rows) sum += row.id + row.score + row.name.length;
console.log(sum, Object.keys(rows[3]!).join());
