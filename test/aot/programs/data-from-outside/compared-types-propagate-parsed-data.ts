// What is parsed is held to one type. Values of that type are handed on where other types are expected, by arguments, returns, elements and spreads, and only the checker's comparison of the two types says so.
interface Wire { id: number; name: string; extra?: { note: string } }
interface Row { id: number; name: string }
interface Labeled { name: string }
interface Boxed<T> { value: T; history: T[] }
class Table {
  rows: Row[] = [];
  keep(row: Row): Row { this.rows.push(row); return row; }
}
function parse(text: string): Wire { return JSON.parse(text) as Wire; }
function box<T>(value: T): Boxed<T> { return { value, history: [value] }; }
function label(it: Labeled): string { return it.name + ":" + Object.keys(it).join("+"); }
function firstOf(boxed: Boxed<Row>): Labeled { return boxed.history[0]; }
const table = new Table();
const parsed = parse('{"id":1,"name":"a","extra":{"note":"n"},"more":true}');
const kept = table.keep(parsed);
table.keep({ id: 2, name: "b" });
const boxed: Boxed<Row> = box(kept);
boxed.history.push({ id: 3, name: "c" }, ...table.rows);
const labeled: Labeled[] = [firstOf(boxed), ...boxed.history, { name: "made" }];
const byName: Record<string, Labeled> = {};
for (const it of labeled) byName[it.name] = it;
kept.name = "renamed";
console.log(labeled.map(label).join(" "), Object.keys(byName).join(), byName.a === parsed, (byName.a as Wire).extra?.note);
console.log(JSON.stringify(table.rows), JSON.stringify(boxed.value), boxed.history.length, parsed.name);
