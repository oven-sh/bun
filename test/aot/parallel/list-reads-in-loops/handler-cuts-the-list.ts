// a read off null throws in a turn, and the handler in the loop cuts the list that the rest of the turn reads
function sum(list: number[], box: { inner: { x: number } | null }, at: number): number { let s = 0; for (let i = 0; i < list.length; i++) { try { s += i === at ? box.inner!.x : 0; } catch { list.length = 2; s += 1000; } s += list[i] === undefined ? 7000 : list[i]; } return s; }
(globalThis as any).kept = sum;
const subject = (globalThis as any).kept as typeof sum;
function fresh(): number[] { return JSON.parse("[1,2,3,4,5,6]"); }
console.log(String(subject(fresh(), { inner: { x: 1 } }, 2)));
let all = 0;
for (let turn = 0; turn < 400; turn++) all += subject(fresh(), turn & 1 ? { inner: null } : { inner: { x: 1 } }, turn % 7);
console.log(String(all));
console.log(String(subject(fresh(), { inner: null }, 0)));
console.log(String(subject(fresh(), { inner: null }, 4)));
