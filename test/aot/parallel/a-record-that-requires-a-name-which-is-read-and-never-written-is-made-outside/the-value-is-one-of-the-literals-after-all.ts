// What is handed in under the record's type is, some of the time, a literal of the program that has the one field which somebody writes and lacks the others: the reads give undefined, and what is done with undefined throws, as in plain Bun.
interface Pair { kind: string; left: number[]; right: number[] }
const said: (string | number)[] = [];
function lengths(pair: Pair): number { return pair.left.length * 10 + pair.right.length; }
function first(pair: Pair): string { return pair.kind + ":" + String(pair.left) + ":" + typeof pair.right; }
const table: Record<string, (pair: Pair) => number | string> = { lengths, first };
const values: any[] = [JSON.parse('{"kind":"json","left":[1,2,3],"right":[4]}'), { kind: "literal", run() { return 1; } }, { kind: "bare" }, JSON.parse('{"kind":"half","left":[9]}'), Object.assign({ kind: "assigned" }, JSON.parse('{"left":[1],"right":[2,3]}'))];
for (let round = 0; round < 3; round++) {
  for (const name of JSON.parse('["lengths","first"]') as string[]) {
    for (const value of values) { try { said.push(table[name]!(value)); } catch (error) { said.push((error as Error).constructor.name); } }
  }
}
console.log(said.join(" "));
export {};
