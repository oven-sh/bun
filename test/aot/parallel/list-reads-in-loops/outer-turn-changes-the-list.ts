// the inner loop only reads the list, and each outer turn changes it: it grows past its storage, is cut, takes a fraction, takes a text, loses an element, gets a name of its own
function sum(list: number[], rounds: number): string { let s: any = 0; for (let k = 0; k < rounds; k++) { for (let i = 0; i < list.length; i++) s += list[i] === undefined ? 1000 : list[i]; if (k === 0) list.push(7, 8, 9, 10, 11, 12, 13, 14, 15, 16); if (k === 1) list.length = 3; if (k === 2) list[1] = 0.5; if (k === 3) delete list[0]; if (k === 4) (list as any).extra = 1; if (k === 5) (list as unknown[])[2] = "text"; } return String(s); }
(globalThis as any).kept = sum;
const subject = (globalThis as any).kept as typeof sum;
function fresh(): number[] { return JSON.parse("[1,2,3,4,5,6]"); }
console.log(subject(fresh(), 1));
let all = 0;
for (let turn = 0; turn < 300; turn++) all += subject(fresh(), turn % 8).length;
console.log(String(all));
for (let rounds = 0; rounds < 8; rounds++) console.log(subject(fresh(), rounds));
