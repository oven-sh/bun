// The rows' type is written over the parse through `unknown`, the spelling that lint rules ask for. It says what `as Row[]` says: the parser makes the rows records of Row,
// and the constructor that takes a Row is entered by its typed version.
// COUNTER: ObjectsParsedIntoRecords >= 64
// COUNTER: ObjectsParsedIntoOrdinaryObjects <= 0
interface Row { id: number; name: string; score: number }
class User {
  id: number; name: string; score: number;
  constructor(row: Row) { this.id = row.id; this.name = row.name; this.score = row.score; }
}
const text = "[" + Array.from({ length: 64 }, (_, i) => `{"id":${i},"name":"n${i}","score":${i * 0.5}}`).join() + "]";
const rows = JSON.parse(text) as unknown as Row[];
let sum = 0;
for (const row of rows) { const user = new User(row); sum += user.id + user.score + user.name.length; }
console.log(sum, Object.keys(rows[3]!).join());
