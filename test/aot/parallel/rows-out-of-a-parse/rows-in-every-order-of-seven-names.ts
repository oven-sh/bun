// 5,040 rows, each in an order of its own. As many get a plan as the order word of a cell can number, not 256.
// COUNTER: ObjectsParsedIntoRecords >= 4096
interface Wide { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number; g?: number; h?: number }
function sum(rows: Wide[]): number { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; let s = 0; for (const r of rows) s += (r.a ?? 0) + (r.h ?? 0); return s; }
const texts: string[] = []; (function walk(left: string[], done: string[]): void { if (!left.length) { texts.push("{" + done.map((k, i) => '"' + k + '":' + i).join() + "}"); return; } for (const k of left) walk(left.filter(x => x !== k), [...done, k]); })(["a", "b", "c", "d", "e", "f", "h"], []);
const rows: Wide[] = JSON.parse("[" + texts.join() + "]"); console.log("SAID " + rows.length + " " + sum(rows)); export {};
