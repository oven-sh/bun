// Seven names come in all their 5,040 orders, which is more than a record has numbers for: the first orders get a plan, the late ones find no number and stay ordinary objects.
// The rows are kept, so every shape lives. Then all the orders come once more: an order that fitted is made a record again, and an order that found no number is not tried again.
// COUNTER: RecordPlanChoices <= 5100
// COUNTER: ObjectsParsedIntoRecords >= 8000
// COUNTER: ObjectsParsedIntoOrdinaryObjects >= 1000
// Env of the executable: BUN_JSC_verifyGC=1
interface Wide { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number; g?: number; h?: number }
function sum(rows: Wide[]): number { let s = 0; for (const r of rows) s += (r.a ?? 0) * 3 + (r.g ?? 0) + (r.h ?? 0); return s; }
const texts: string[] = [];
(function walk(left: string[], done: string[]): void { if (!left.length) { texts.push("{" + done.map((k, i) => '"' + k + '":' + i).join() + "}"); return; } for (const k of left) walk(left.filter(x => x !== k), [...done, k]); })(["a", "b", "c", "d", "e", "f", "g"], []);
const text = "[" + texts.join() + "]";
const first: Wide[] = JSON.parse(text);
Bun.gc(true);
const second: Wide[] = JSON.parse(text);
console.log(first.length + second.length, sum(first), sum(second)); export {};
