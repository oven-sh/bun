// a small callee holds the loop that reads the list, and its caller calls it in a loop of its own that changes the list between two calls: a copy of the callee stands in a turn of the caller
function sum(list: number[]): number { let s = 0; for (let i = 0; i < list.length; i++) s += list[i]; return s; }
function sumOfSums(list: number[], rounds: number): number { let all = 0; for (let k = 0; k < rounds; k++) { all += sum(list); if (k === 0) list.push(7, 8, 9, 10, 11, 12, 13, 14, 15, 16); if (k === 1) list.length = 2; if (k === 2) list[1] = 0.5; if (k === 3) list[9] = 1; } return all; }
(globalThis as any).kept = [sum, sumOfSums];
const subject = (globalThis as any).kept[1] as typeof sumOfSums;
function fresh(): number[] { return JSON.parse("[1,2,3,4,5,6]"); }
console.log(String(subject(fresh(), 1)));
let all = 0;
for (let turn = 0; turn < 300; turn++) { const sumOfTurn = subject(fresh(), turn % 4); all += sumOfTurn; }
console.log(String(all));
for (let rounds = 0; rounds < 6; rounds++) console.log(String(subject(fresh(), rounds)));
