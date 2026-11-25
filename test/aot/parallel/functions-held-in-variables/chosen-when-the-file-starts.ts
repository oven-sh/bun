// @ts-nocheck
// Functions chosen when the file starts, called in loops: in front of their declaration, replaced between and amid the turns, and by values that are no functions.
function said(value: unknown): string { return typeof value === "string" ? JSON.stringify(value) : String(value); }
function show(name: string, rounds: number, body: (round: number) => unknown): void {
  const lines: string[] = [];
  for (let round = 0; round < rounds; round++) {
    try { lines.push(said(body(round))); } catch (error) { lines.push((error as Error).name); }
  }
  console.log(name, lines.join(" "), steps);
}
var steps = 0;
const list: number[] = JSON.parse("[3,1,4,1,5,9,2,6]");
function twice(x: number) { return x * 2; }
function next(x: number) { return x + 1; }
function half(x: number) { return x / 2; }
function words(x: number): any { return "w" + x; }

function sumOfChosen() { let s = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; steps++; s = (s + chosen(x)) | 0; } return s; }
function sumBehindOthers() { let s = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; if (x > 3) s += chosen(x); else steps++; } return s; }
show("early", 2, sumOfChosen);
show("early, behind others", 2, sumBehindOthers);
const chosen: (x: number) => number = list.length > 5 ? twice : next;
show("const", 3, sumOfChosen);
show("const, behind others", 2, sumBehindOthers);

function sumOfStored() { let s: any = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; s = s + stored(x); } return s; }
show("early let", 1, sumOfStored);
let stored: any = next; if (list[0] === 3) stored = half;
show("let", 4, round => { if (round === 1) stored = twice; if (round === 2) stored = words; if (round === 3) stored = null; return sumOfStored(); });

function changes(x: number) { if (x === 9) changing = twice; return x + 100; }
let changing = list.length > 100 ? next : changes;
function sumOfChanging() { let s = 0; for (const x of list) s = s * 2 + changing(x); return s; }
show("changed by itself", 3, round => { if (round === 2) changing = changes; return sumOfChanging(); });

const table = { a: twice, b: next, c: half };
const picked = table[list.length > 5 ? "b" : "a"];
function sumOfPicked(f = picked) { let s = 0; let i = 0; while (i < list.length) { s += picked(f(list[i]!)); i++; } return s; }
show("picked", 2, round => sumOfPicked(round ? half : undefined));

let late: ((x: number) => number) | undefined;
function choose(first: boolean) { late = first ? twice : next; }
function sumOfLate() { let s = 0; for (let i = 0; i < list.length; i++) { s += late!(list[i]!); steps++; } return s; }
show("chosen later", 4, round => { if (round) choose(round === 2); if (round === 3) late = Math.sqrt as any; return sumOfLate(); });

function adder(by: number) { return (x: number) => x + by++; }
const made = list.length > 5 ? adder(1) : adder(10);
function sumOfMade() { let s = 0; for (let i = 0; i < list.length; i++) s += made(list[i]!); return s; }
show("made", 3, sumOfMade);

var hoisted = list.length > 5 ? half : next;
function sumOfHoisted() { const said: number[] = []; for (let i = 0; i < list.length; i++) { said[i] = hoisted(list[i]!); if (i === 5 && steps > 60) hoisted = next; } return said.join(); }
show("var", 3, sumOfHoisted);
