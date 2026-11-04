// no call is written: a getter of an object that the turn reads cuts the list that the loop adds up
function sum(list: number[], holder: { more: number }): number { let s = 0; for (let i = 0; i < list.length; i++) { s += list[i]; s += holder.more; } return s; }
(globalThis as any).kept = sum;
const subject = (globalThis as any).kept as typeof sum;
function fresh(): number[] { return JSON.parse("[1,2,3,4,5,6]"); }
function deed(list: number[], when: number): { more: number } { let reads = 0; return { get more() { if (reads++ === when) list.length = 1; return 1000; } }; }
console.log(String(subject(fresh(), { more: 1 })));
let all = 0;
for (let turn = 0; turn < 400; turn++) { const list = fresh(); all += subject(list, turn & 1 ? deed(list, turn % 7) : { more: 1 }); }
console.log(String(all));
const last = fresh();
console.log(String(subject(last, deed(last, 2))));
console.log(String(last.length));
