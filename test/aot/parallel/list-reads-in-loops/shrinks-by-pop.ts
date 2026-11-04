// each turn behind a given one pops an element off the list that the loop adds up
function sum(list: number[], from: number): number { let s = 0; for (let i = 0; i < list.length; i++) { s += list[i]; if (i >= from) list.pop(); } return s; }
(globalThis as any).kept = sum;
const subject = (globalThis as any).kept as typeof sum;
function fresh(): number[] { return JSON.parse("[1,2,3,4,5,6,7,8]"); }
console.log(String(subject(fresh(), 99)));
let all = 0;
for (let turn = 0; turn < 400; turn++) all += subject(fresh(), turn % 9);
console.log(String(all));
console.log(String(subject(fresh(), 0)));
console.log(String(subject(fresh(), 99)));
