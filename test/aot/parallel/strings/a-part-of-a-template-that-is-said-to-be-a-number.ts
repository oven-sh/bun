// `${row.id},${row.title},${row.cents}`: each part is made a text before the next part is read. A number has its text whenever it is asked, so it may wait; whatever else lies in a field that is said to hold a number is asked at once, in its turn.
interface Row { id: number; title: string; cents: number; more: number }
const said: string[] = [];
function lines(rows: Row[]): string {
  let text = "";
  for (const row of rows) text += `${row.id},${row.title},${row.cents}|${row.more}\n`;
  return text;
}
function sums(rows: Row[]): string {
  let text = "";
  for (const row of rows) text += row.id + ":" + row.cents + ";";
  return text;
}
const row = (id: unknown, title: unknown, cents: unknown, more: unknown = 0) => ({ id, title, cents, more }) as Row;
const numbers = [0, -0, 1, -1, 9, 10, 99999, 100000, 2147483647, 2147483648, -2147483648, 4294967296, 9007199254740991, 1e21, 1e-7, 0.1, -2.5, NaN, Infinity, -Infinity];
const plain: Row[] = [];
for (const number of numbers) plain.push(row(number, "t" + number, -number, number * 3));
said.push(lines(plain), sums(plain));

const speaks = (name: string, text: unknown) => ({ toString() { said.push(name + " is asked for its text"); return text; }, valueOf() { said.push(name + " is asked for its value"); return 7; } });
const odd: unknown[] = ["a text", "", true, false, null, undefined, 12n, [1, [2, 3]], {}, speaks("an object", "spoken"), speaks("an object that gives a number", 5), new Date(0).getTime(), new Number(8), new String("boxed")];
for (const first of odd) said.push(lines([row(first, "x", 1), row(2, first, 3), row(4, "y", first), row(5, "z", 6, first)]), sums([row(first, 0, 1), row(1, 0, first)]));

const watched = {
  get id() { said.push("id is read"); return speaks("id", "ID"); },
  get title() { said.push("title is read"); return speaks("title", "TITLE"); },
  get cents() { said.push("cents is read"); return 3; },
  get more() { said.push("more is read"); return speaks("more", "MORE"); },
} as unknown as Row;
said.push(lines([watched, row(1, "between", 2), watched]));

for (const refused of [Symbol("mark"), { toString() { throw new RangeError("no text"); } }, Object.create(null)]) {
  for (const place of [0, 1, 2, 3]) {
    const parts: unknown[] = [1, "t", 2, 3];
    parts[place] = refused;
    try { said.push(lines([row(0, "before", 0), row(parts[0], parts[1], parts[2], parts[3])])); } catch (error) { said.push(place + " " + (error as Error).name); }
  }
}
let length = 0;
for (let round = 0; round < 3000; round++) length += lines(plain).length + sums(plain).length;
said.push(String(length));
console.log(said.join("\n"));
