// the loop yields in every turn, and whoever steps it cuts, lengthens and changes the list between two steps
function* sums(list: number[]): Generator<number, number, unknown> { let s = 0; for (let i = 0; i < list.length && i < 30; i++) { s += list[i]; yield s; } return s; }
(globalThis as any).kept = sums;
const subject = (globalThis as any).kept as typeof sums;
function fresh(): number[] { return JSON.parse("[1,2,3,4,5,6]"); }
function run(deedAt: number): number { const list = fresh(); const steps = subject(list); let turn = 0; let last = 0; for (;;) { const step = steps.next(); last = step.value; if (step.done) return last; if (turn++ === deedAt) { list.length = 2; for (let k = 0; k < 12; k++) list.push(k + 0.5); } } }
console.log(String(run(99)));
let all = 0;
for (let turn = 0; turn < 200; turn++) all += run(turn % 7);
console.log(String(all));
console.log(String(run(0)));
console.log(String(run(5)));
