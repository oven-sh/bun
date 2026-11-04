// a literal of constants shares its storage with every other evaluation until it is stored into: the store in the loop gives it storage of its own, and the next evaluation is as written
function literal(): number[] { return [1, 2, 3, 4, 5, 6]; }
function sum(list: number[], at: number): number { let s = 0; for (let i = 0; i < list.length; i++) { s += list[i] + list[0]; if (i === at) list[0] = 50; } return s; }
function onlyReads(list: number[]): number { let s = 0; for (let i = 0; i < list.length; i++) s += list[i]; return s; }
(globalThis as any).kept = [sum, onlyReads, literal];
const subject = (globalThis as any).kept[0] as typeof sum;
const reader = (globalThis as any).kept[1] as typeof onlyReads;
console.log(String(subject(literal(), 99)));
console.log(String(reader(literal())));
let all = 0;
for (let turn = 0; turn < 400; turn++) all += subject(literal(), turn % 7) + reader(literal());
console.log(String(all));
const stored = literal();
console.log(String(subject(stored, 2)));
console.log(String(reader(stored)));
console.log(String(reader(literal())));
