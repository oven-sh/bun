// the loop only reads. The list has holes and stands below another list, below an object with a getter under an index, or below nothing: what a hole gives is asked of what stands above
let hits = 0;
function count(list: string[], turns: number): number { let n = 0; for (let i = 0; i < turns; i++) n += list[i] === undefined ? 1 : list[i] === "above" ? 100 : 0; return n; }
(globalThis as any).kept = count;
const subject = (globalThis as any).kept as typeof count;
function holed(): string[] { const list: string[] = JSON.parse("[\"a\",\"b\",\"c\",\"d\"]"); delete list[1]; delete list[3]; return list; }
function belowAList(): string[] { const above: string[] = []; above[1] = "above"; above[5] = "above"; return Object.setPrototypeOf(holed(), above); }
function belowAGetter(): string[] { const above = Object.create(Array.prototype, { 3: { get() { hits++; return "above"; } } }); return Object.setPrototypeOf(holed(), above); }
function belowNothing(): string[] { return Object.setPrototypeOf(holed(), null); }
console.log(String(subject(holed(), 8)));
let all = 0;
for (let turn = 0; turn < 400; turn++) all += subject(holed(), 8);
console.log(String(all));
console.log(String(subject(belowAList(), 8)));
console.log(String(subject(belowAGetter(), 8)));
console.log(String(hits));
console.log(String(subject(belowNothing(), 8)));
console.log(String(subject(holed(), 8)));
