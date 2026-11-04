// both parameters are one list: the loop reads it under the one name and cuts, lengthens and changes it under the other
function sum(list: number[], other: number[], at: number): number { let s = 0; for (let i = 0; i < list.length && i < 30; i++) { s += list[i]; if (i === at) other.length = 2; if (i === at + 1) other.push(0.5, 7, 8, 9, 10, 11, 12, 13, 14, 15); } return s; }
(globalThis as any).kept = sum;
const subject = (globalThis as any).kept as typeof sum;
function fresh(): number[] { return JSON.parse("[1,2,3,4,5,6]"); }
console.log(String(subject(fresh(), fresh(), 1)));
let all = 0;
for (let turn = 0; turn < 400; turn++) { const list = fresh(); all += subject(list, turn & 1 ? list : fresh(), turn % 7); }
console.log(String(all));
const one = fresh();
console.log(String(subject(one, one, 0)));
console.log(String(one.length));
