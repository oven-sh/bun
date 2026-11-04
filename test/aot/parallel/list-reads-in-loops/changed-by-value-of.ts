// no call is written: the product converts its operand, whose valueOf empties the list that the loop adds up
function sum(list: number[], factor: number): number { let s = 0; for (let i = 0; i < list.length; i++) s += list[i] * factor; return s; }
(globalThis as any).kept = sum;
const subject = (globalThis as any).kept as typeof sum;
function fresh(): number[] { return JSON.parse("[1,2,3,4,5,6]"); }
function deed(list: number[], when: number): number { let conversions = 0; return { valueOf() { if (conversions++ === when) list.length = 0; return 2; } } as any; }
console.log(String(subject(fresh(), 2)));
let all = 0;
for (let turn = 0; turn < 400; turn++) { const list = fresh(); all += subject(list, turn & 1 ? deed(list, turn % 7) : 2); }
console.log(String(all));
const last = fresh();
console.log(String(subject(last, deed(last, 2))));
console.log(String(last.length));
