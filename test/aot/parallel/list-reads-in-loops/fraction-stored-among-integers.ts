// a fraction stored among integers gives the list storage of doubles in the loop that adds it up
function sum(list: number[], at: number): number { let s = 0; for (let i = 0; i < list.length; i++) { s += list[i]; if (i === at) list[i + 1] = 0.25; } return s; }
(globalThis as any).kept = sum;
const subject = (globalThis as any).kept as typeof sum;
function fresh(): number[] { return JSON.parse("[1,2,3,4,5,6]"); }
console.log(String(subject(fresh(), 99)));
let all = 0;
for (let turn = 0; turn < 400; turn++) all += subject(fresh(), turn % 7);
console.log(String(all));
console.log(String(subject(fresh(), 0)));
console.log(String(subject(fresh(), 4)));
