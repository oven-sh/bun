// the length is cut in the loop whose bound was read in front of it, so the positions behind the cut hold nothing
function count(list: string[], at: number): number { const end = list.length; let n = 0; for (let i = 0; i < end; i++) { n += list[i] === undefined ? 1 : 0; if (i === at) list.length = 2; } return n; }
(globalThis as any).kept = count;
const subject = (globalThis as any).kept as typeof count;
function fresh(): string[] { return JSON.parse("[\"a\",\"b\",\"c\",\"d\",\"e\",\"f\"]"); }
console.log(String(subject(fresh(), 99)));
let all = 0;
for (let turn = 0; turn < 400; turn++) all += subject(fresh(), turn % 7);
console.log(String(all));
console.log(String(subject(fresh(), 1)));
console.log(String(subject(fresh(), 99)));
