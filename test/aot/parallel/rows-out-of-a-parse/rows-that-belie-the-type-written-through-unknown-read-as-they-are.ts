// A type written over a parse is not checked by anybody, through `unknown` or not. Of these rows one fits Row; the others have a text for a number, nothing for a text, a name too few, a name too many,
// another order, a list for a row. Each reads as it does in plain Bun, in the constructor that takes a Row too.
// COUNTER: ObjectsParsedIntoRecords >= 1
interface Row { id: number; name: string; score: number }
class User {
  id: number; name: string; score: number;
  constructor(row: Row) { this.id = row.id; this.name = row.name; this.score = row.score; }
}
const text = '[{"id":1,"name":"a","score":0.5},{"id":"two","name":"b","score":1},{"id":3,"name":null,"score":2},{"id":4,"name":"d"},{"id":5,"name":"e","score":3,"more":true},{"score":4,"name":"f","id":6},[7,"g",5]]';
const rows = JSON.parse(text) as unknown as Row[];
const said: string[] = [];
for (const row of rows) {
  const user = new User(row);
  said.push(typeof user.id + ":" + user.id + " " + typeof user.name + ":" + user.name + " " + typeof user.score + ":" + user.score + " " + Object.keys(row).join("") + " " + JSON.stringify(row));
}
console.log(said.join("\n"));
