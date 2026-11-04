// the variable that the loop reads through is assigned another list in a turn: shorter, longer, and of another kind of storage
function sum(list: number[], other: number[], at: number): number { let s = 0; for (let i = 0; i < list.length; i++) { s += list[i]; if (i === at) list = other; } return s; }
(globalThis as any).kept = sum;
const subject = (globalThis as any).kept as typeof sum;
function fresh(): number[] { return JSON.parse("[1,2,3,4,5,6]"); }
const others: number[][] = [JSON.parse("[0.5]"), JSON.parse("[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5,9.5,10.5,11.5]"), JSON.parse("[]"), JSON.parse("[10,20,30,40,50,60,70]")];
console.log(String(subject(fresh(), others[0], 99)));
let all = 0;
for (let turn = 0; turn < 400; turn++) all += subject(fresh(), others[turn & 3], turn % 7);
console.log(String(all));
console.log(String(subject(fresh(), others[1], 0)));
console.log(String(subject(fresh(), others[2], 3)));
