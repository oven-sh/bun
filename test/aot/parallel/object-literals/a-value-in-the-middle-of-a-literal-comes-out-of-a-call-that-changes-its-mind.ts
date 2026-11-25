// The value in the middle of a literal comes out of a function that answers with numbers for a long time, and then with a text, an object and nothing.
const answers: unknown[] = JSON.parse('[1.5, 2.5, "text", {"deep": 1}, null, true]');
let turn = 0;
function next(): number { return (turn < 300 ? answers[turn++ & 1] : answers[turn++ % answers.length]) as number; }
function row() { return { id: 1, tag: next(), more: 2, last: "z" }; }
function tellOf(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o); }

function deed(): string {
  return tellOf(row());
}
console.log(deed(), deed());
let sum = 0;
while (turn < 300) sum += row().tag;
console.log(String(sum));
let said = "";
for (let i = 0; i < 12; i++) said += deed() + ";";
console.log(said);
const kept = row();
kept.tag = 7.5;
console.log(tellOf(kept), typeof row().tag, typeof row().tag);
