// a store far behind the end gives the list other storage, a longer length and holes, in the loop that counts what is absent
function count(list: number[], at: number): number { let n = 0; for (let i = 0; i < list.length && i < 60; i++) { n += list[i] === undefined ? 1 : 0; if (i === at) list[list.length + 30] = 5; } return n; }
(globalThis as any).kept = count;
const subject = (globalThis as any).kept as typeof count;
function fresh(): number[] { return JSON.parse("[1,2,3,4,5,6]"); }
console.log(String(subject(fresh(), 99)));
let all = 0;
for (let turn = 0; turn < 400; turn++) all += subject(fresh(), turn % 7);
console.log(String(all));
console.log(String(subject(fresh(), 0)));
const sparse = fresh();
sparse[1000000] = 1;
console.log(String(subject(sparse, 99)));
