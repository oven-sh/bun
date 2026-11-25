type Note = { head?: string; kind: number; code: number; text: string; next?: Note[] };
type Report = { head: string; kind: number; code: number; text: string; next: Note[]; file: string; start: number };
const turns = +process.argv[2]! || 30;
function note(text: string, i: number): Note {
  return { text, kind: i & 3, code: i, next: undefined };
}
function report(i: number): Report {
  return { file: "f" + (i & 1), next: [], text: "t", start: i, code: i, kind: 1, head: "h" };
}
function again(given: Note): Note {
  return { ...given };
}
function marked(given: Note, i: number): Note {
  return { ...given, code: i + 1 };
}
let sum = 0;
const out: string[] = [];
const small = marked(again(note("n", 1)), 2);
out.push(Object.keys(small).join() + "|" + JSON.stringify(small));
for (let turn = 0; turn < turns; turn++) {
  for (let i = 0; i < 40; i++) {
    const made = marked(again(report(i)), turn);
    sum = (sum + made.code + made.kind + made.text.length) | 0;
    if (turn < 2 && i < 3) out.push(Object.keys(made).join() + "|" + JSON.stringify(made));
  }
}
console.log(out.join("\n"));
console.log(sum);
