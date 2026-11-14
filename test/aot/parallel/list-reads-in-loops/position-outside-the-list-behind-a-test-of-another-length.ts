// the test at the head asks the length of one list and the turn reads another, which is shorter: what lies behind its end is nothing of the list's
function count(list: string[], other: string[]): number { let n = 0; for (let i = 0; i < other.length; i++) n += list[i] === undefined ? 1 : 0; return n; }
function countFrom(list: string[], from: number): number { let n = 0; for (let i = from | 0; i < list.length; i++) n += list[i] === undefined ? 1 : 0; return n; }
(globalThis as any).kept = [count, countFrom];
const subject = (globalThis as any).kept[0] as typeof count;
const fromBelow = (globalThis as any).kept[1] as typeof countFrom;
function texts(length: number): string[] { const list: string[] = JSON.parse("[]"); for (let i = 0; i < length; i++) list.push("t" + i); return list; }
console.log(String(subject(texts(4), texts(4))));
let all = 0;
for (let turn = 0; turn < 400; turn++) all += subject(texts(turn % 5), texts(turn % 90)) + fromBelow(texts(turn % 5), -(turn % 6));
console.log(String(all));
console.log(String(subject(texts(1), texts(3000))));
console.log(String(subject(texts(0), texts(64))));
console.log(String(fromBelow(texts(3), -4)));
const same = texts(6);
console.log(String(subject(same, same)));
