// a delete makes a hole in front of the position, in a list that stands below another list which answers for that index
function count(list: string[], at: number): number { let n = 0; for (let i = 0; i < list.length; i++) { n += list[i] === "below" ? 100 : list[i] === undefined ? 1 : 0; if (i === at) delete list[i + 1]; } return n; }
(globalThis as any).kept = count;
const subject = (globalThis as any).kept as typeof count;
function fresh(): string[] { return JSON.parse("[\"a\",\"b\",\"c\",\"d\",\"e\",\"f\"]"); }
function below(): string[] { const list = fresh(); const above: string[] = []; above[3] = "below"; Object.setPrototypeOf(list, above); return list; }
console.log(String(subject(fresh(), 99)));
let all = 0;
for (let turn = 0; turn < 400; turn++) all += subject(fresh(), turn % 7) + subject(below(), turn % 7);
console.log(String(all));
console.log(String(subject(fresh(), 2)));
console.log(String(subject(below(), 2)));
console.log(String(subject(below(), 99)));
