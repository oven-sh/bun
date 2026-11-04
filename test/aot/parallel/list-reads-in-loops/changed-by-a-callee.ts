// a callee that is handed in cuts the list, fills it anew with fractions and lengthens it, in the loop that adds the list up
function sum(list: number[], change: (at: number) => void): number { let s = 0; for (let i = 0; i < list.length && i < 30; i++) { s += list[i]; change(i); } return s; }
(globalThis as any).kept = sum;
const subject = (globalThis as any).kept as typeof sum;
function fresh(): number[] { return JSON.parse("[1,2,3,4,5,6]"); }
function deed(list: number[], when: number): (at: number) => void { return at => { if (at !== when) return; list.length = 0; for (let k = 0; k < 20; k++) list.push(k + 0.5); }; }
console.log(String(subject(fresh(), () => { })));
let all = 0;
for (let turn = 0; turn < 400; turn++) { const list = fresh(); all += subject(list, deed(list, turn % 7)); }
console.log(String(all));
const last = fresh();
console.log(String(subject(last, deed(last, 3))));
console.log(String(last.length));
